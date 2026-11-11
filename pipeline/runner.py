"""Build a snapshot of a client's tables from one extract run, with jobs that follow CONTRACT.md.

Reads the run's raw files and writes each table once, to <bucket>/tables/<name>/<snapshot>.parquet
(the layout is in snapshot.py). Each job runs after the jobs it reads, in its own DuckDB connection
that sees only its declared inputs, resolved to the snapshot's exact files. A table is written only
if it passes the contract checks, and a failure skips everything downstream of it. Then verify.py
checks each table's lineage by re-running its job on a sample of the same files. The manifest is
saved either way; latest.json moves to it only if every job built and verified.
"""

import argparse
import hashlib
import json
import os
import re
import sys
import tempfile
import tomllib
from dataclasses import dataclass
from datetime import UTC, datetime
from graphlib import CycleError, TopologicalSorter
from pathlib import Path
from typing import Any, Mapping

import duckdb

import snapshot as snapshots
from snapshot import RAW_PREFIX, Snapshot, sql_string

JOBS_DIR = Path(__file__).parent / "jobs"
CLIENTS_DIR = Path(__file__).parent / "clients"
NAME_PATTERN = re.compile(r"^[a-z][a-z0-9_]*$")
FIELD_KEY_PATTERN = re.compile(r"^[a-z][a-z0-9_]*$")
JSON_PATH_PATTERN = re.compile(r"^\$(\.[A-Za-z0-9_]+)+$")
VALUE_TYPES = {"string", "number", "date", "boolean"}
RAW_ROW_ID = "_dlt_id"
SOURCES_TYPE = 'STRUCT("table" VARCHAR, row_id VARCHAR)[]'
FIELDS_TYPE = "MAP(VARCHAR, VARCHAR[])"
CONTRACT_COLUMNS = ("_row_id", "_sources", "_fields")
# `<input>.<column>`, with `:<json path>` for a value inside a JSON text column.
REF_PATTERN = re.compile(
    r"^((?:raw\.)?[a-z][a-z0-9_]*)\.([A-Za-z_][A-Za-z0-9_]*)(?::(\$(?:\.[A-Za-z0-9_]+)+))?$"
)
COLUMNS_METADATA_KEY = "waymark_columns"
JSON_TYPES = {"VARCHAR", "JSON"}


class ContractError(Exception):
    pass


@dataclass(frozen=True)
class Job:
    name: str
    inputs: tuple[str, ...]
    sql: str
    description: str | None = None
    # A hash of the job's files, recorded in the manifest beside each table it builds.
    version: str = ""


def is_raw(table: str) -> bool:
    return table.startswith(RAW_PREFIX)


def parse_ref(ref: str) -> tuple[str, str, str | None]:
    """Split a column reference into (table, column, json path or None)."""
    match = REF_PATTERN.match(ref)
    if not match:
        raise ValueError(f"Invalid column reference: {ref!r}")
    table, column, path = match.groups()
    return table, column, path


def load_job(directory: Path) -> Job:
    name = directory.name
    if not NAME_PATTERN.match(name):
        raise ValueError(f"Invalid job name: {name!r}")
    spec = tomllib.loads((directory / "job.toml").read_text())
    if spec.get("kind", "sql") != "sql":
        raise ValueError(f"{name}: only sql jobs are supported")
    inputs = tuple(spec["inputs"])
    for table in inputs:
        if not NAME_PATTERN.match(table.removeprefix(RAW_PREFIX)):
            raise ValueError(f"{name}: invalid input {table!r}")
    if "columns" in spec:
        raise ValueError(f"{name}: [columns] is gone; the query returns _fields instead")
    sql = (directory / "query.sql").read_text().strip().removesuffix(";")
    return Job(name, inputs, sql, spec.get("description"), job_version(directory))


def job_version(directory: Path) -> str:
    digest = hashlib.sha256()
    for path in sorted(p for p in directory.iterdir() if p.is_file()):
        digest.update(path.name.encode() + b"\0" + path.read_bytes() + b"\0")
    return digest.hexdigest()[:16]


def load_jobs(directories: list[Path]) -> list[Job]:
    """Every job in the given folders. A later folder's job replaces an earlier one by name."""
    jobs: dict[str, Job] = {}
    for directory in directories:
        for path in sorted(directory.iterdir()):
            if (path / "job.toml").exists():
                jobs[path.name] = load_job(path)
    return list(jobs.values())


def build_order(jobs: list[Job]) -> list[Job]:
    by_name = {job.name: job for job in jobs}
    for job in jobs:
        unknown = [t for t in job.inputs if not is_raw(t) and t not in by_name]
        if unknown:
            raise ValueError(f"{job.name}: unknown inputs {unknown}")
    graph = {job.name: [t for t in job.inputs if not is_raw(t)] for job in jobs}
    try:
        return [by_name[name] for name in TopologicalSorter(graph).static_order()]
    except CycleError as error:
        raise ValueError(f"Jobs read each other in a cycle: {error.args[1]}") from error


def validate_jira_field(field: Mapping[str, str]) -> None:
    if not FIELD_KEY_PATTERN.match(field["key"]):
        raise ValueError(f"Invalid metadata key: {field['key']!r}")
    if not JSON_PATH_PATTERN.match(field["path"]):
        raise ValueError(f"Invalid Jira field path: {field['path']!r}")
    if field["value_type"] not in VALUE_TYPES:
        raise ValueError(f"Invalid value type: {field['value_type']!r}")


def connect(
    client: Mapping[str, Any], spill_dir: str | None = None, snapshot: Snapshot | None = None
) -> duckdb.DuckDBPyConnection:
    """A connection with the contract helpers and the client's parameters installed, able to
    read the snapshot's storage."""
    mapping = client["mapping"]
    re.compile(mapping["ticket_key_pattern"])
    jira_fields = mapping.get("jira_fields", [])
    for field in jira_fields:
        validate_jira_field(field)

    con = snapshot.connect() if snapshot else duckdb.connect()
    if spill_dir:
        con.execute(f"SET temp_directory = {sql_string(spill_dir)}")
    variables = {
        "client": client["client"],
        "jira_base_url": client["jira"]["base_url"].rstrip("/"),
        "ticket_key_pattern": mapping["ticket_key_pattern"],
    }
    for name, value in variables.items():
        con.execute(f"SET VARIABLE {name} = {sql_string(value)}")
    # md5 because DuckDB's hash() can change between versions; 53 bits to survive a JS number.
    con.execute(f"""
        CREATE MACRO stable_id(kind, key) AS cast(
          cast('0x' || left(md5({sql_string(client["client"])} || ':' || kind || ':'
            || cast(key AS VARCHAR)), 14) AS UBIGINT) & 9007199254740991
        AS BIGINT)
    """)
    con.execute("CREATE MACRO source_ref(tbl, id) AS {'table': tbl, 'row_id': cast(id AS VARCHAR)}")
    con.execute("CREATE MACRO iso_utc(ts) AS strftime(ts AT TIME ZONE 'UTC', '%Y-%m-%dT%H:%M:%SZ')")
    con.execute("CREATE SCHEMA params")
    tables = {
        "status_map (status VARCHAR, status_group VARCHAR)": list(
            mapping.get("statuses", {}).items()
        ),
        "jira_fields (key VARCHAR, path VARCHAR, value_type VARCHAR)": [
            (f["key"], f["path"], f["value_type"]) for f in jira_fields
        ],
    }
    for definition, rows in tables.items():
        con.execute(f"CREATE TABLE params.{definition}")
        if rows:
            placeholders = ", ".join("?" * len(rows[0]))
            name = definition.split(" ")[0]
            con.executemany(f"INSERT INTO params.{name} VALUES ({placeholders})", rows)
    return con


def register_inputs(con: duckdb.DuckDBPyConnection, job: Job, snapshot: Snapshot) -> None:
    for table in job.inputs:
        if is_raw(table):
            con.execute("CREATE SCHEMA IF NOT EXISTS raw")
        con.execute(f"CREATE VIEW {table} AS SELECT * FROM {snapshot.source(table)}")


def contract_errors(con: duckdb.DuckDBPyConnection, inputs: tuple[str, ...]) -> list[str]:
    """What is wrong with the `result` table under CONTRACT.md, given the job's inputs."""
    types = {name: type_ for name, type_, *_ in con.sql("DESCRIBE result").fetchall()}
    errors = []
    if types.get("_row_id") != "BIGINT":
        errors.append(f"_row_id must be BIGINT, got {types.get('_row_id')}")
    if types.get("_sources") != SOURCES_TYPE:
        errors.append(f"_sources must be {SOURCES_TYPE}, got {types.get('_sources')}")
    if errors:
        return errors

    null_ids, repeated_ids, unsourced = con.sql("""
        SELECT
          count(*) FILTER (_row_id IS NULL),
          count(_row_id) - count(DISTINCT _row_id),
          count(*) FILTER (coalesce(len(_sources), 0) = 0)
        FROM result
    """).fetchone()
    for count, problem in [
        (null_ids, "have a null _row_id"),
        (repeated_ids, "repeat another row's _row_id"),
        (unsourced, "have no _sources"),
    ]:
        if count:
            errors.append(f"{count} rows {problem}")

    con.execute("""
        CREATE TEMP TABLE refs AS
        SELECT DISTINCT unnest(_sources, recursive := true) FROM result
    """)
    undeclared = [t for (t,) in con.sql("SELECT DISTINCT \"table\" FROM refs ORDER BY 1").fetchall()
                  if t not in inputs]  # fmt: skip
    if undeclared:
        errors.append(f"_sources names tables that are not inputs: {undeclared}")
    for table in inputs:
        id_column = RAW_ROW_ID if is_raw(table) else "_row_id"
        (dangling,) = con.sql(f"""
            SELECT count(*) FROM refs
            ANTI JOIN (SELECT cast({id_column} AS VARCHAR) AS row_id FROM {table}) USING (row_id)
            WHERE "table" = {sql_string(table)}
        """).fetchone()
        if dangling:
            errors.append(f"{dangling} _sources entries point at rows missing from {table}")
    return errors


def field_errors(con: duckdb.DuckDBPyConnection, inputs: tuple[str, ...]) -> list[str]:
    """What is wrong with the `result` table's `_fields` (CONTRACT.md, "Column lineage")."""
    types = {name: type_ for name, type_, *_ in con.sql("DESCRIBE result").fetchall()}
    if types.get("_fields") != FIELDS_TYPE:
        return [f"_fields must be {FIELDS_TYPE}, got {types.get('_fields')}"]
    output = sorted(set(types) - set(CONTRACT_COLUMNS))
    errors = []
    (wrong_keys,) = con.execute(
        "SELECT count(*) FROM result "
        "WHERE _fields IS NULL OR list_sort(map_keys(_fields)) IS DISTINCT FROM ?",
        [output],
    ).fetchone()
    if wrong_keys:
        errors.append(f"{wrong_keys} rows have _fields whose keys are not the output columns {output}")
    # Every reference any row makes, once, with the columns it's made for.
    refs = con.sql("""
        SELECT ref, list_sort(list(DISTINCT column_name)) FROM (
          SELECT column_name, unnest(refs) AS ref FROM (
            SELECT unnest(map_keys(f)) AS column_name, unnest(map_values(f)) AS refs
            FROM (SELECT DISTINCT _fields AS f FROM result)
          )
        )
        GROUP BY ref ORDER BY ref NULLS FIRST
    """).fetchall()
    input_types: dict[str, dict[str, str]] = {}
    for ref, columns in refs:
        where = f"_fields[{', '.join(columns)}]"
        if ref is None:
            errors.append(f"{where} holds a null reference")
            continue
        try:
            table, column, path = parse_ref(ref)
        except ValueError as error:
            errors.append(f"{where}: {error}")
            continue
        if table not in inputs:
            errors.append(f"{where} reads {table}, which is not an input")
            continue
        if table not in input_types:
            input_types[table] = {n: t for n, t, *_ in con.sql(f"DESCRIBE {table}").fetchall()}
        type_ = input_types[table].get(column)
        if type_ is None:
            errors.append(f"{where}: {table} has no column {column}")
        elif path and type_ not in JSON_TYPES:
            errors.append(f"{where}: {ref} has a JSON path on a {type_} column")
    return errors


def column_map(con: duckdb.DuckDBPyConnection) -> dict[str, list[str]]:
    """Each output column's references over every row: the table's column map."""
    rows = con.sql("""
        SELECT column_name, list_sort(list_distinct(flatten(list(refs)))) FROM (
          SELECT unnest(map_keys(f)) AS column_name, unnest(map_values(f)) AS refs
          FROM (SELECT DISTINCT _fields AS f FROM result)
        )
        GROUP BY column_name
    """).fetchall()
    return {column: refs for column, refs in sorted(rows)}


def run_job(job: Job, client: Mapping[str, Any], snapshot: Snapshot) -> int:
    """Build one job's table into the snapshot and return its row count. Raises if it breaks
    the contract, before writing anything."""
    key = snapshot.output_key(job.name)
    out = snapshot.url(key)
    with (
        tempfile.TemporaryDirectory(prefix="waymark-job-") as spill_dir,
        connect(client, spill_dir, snapshot) as con,
    ):
        register_inputs(con, job, snapshot)
        con.execute(f"CREATE TEMP TABLE result AS {job.sql}")
        errors = contract_errors(con, job.inputs)
        errors += [] if errors else field_errors(con, job.inputs)
        if errors:
            raise ContractError("; ".join(errors))
        # The union of every row's _fields travels in the file's own metadata, so a reader can
        # trace a column across the whole table without scanning it.
        columns = sql_string(json.dumps(column_map(con), sort_keys=True))
        # Written once, under a name no manifest lists yet, so no reader can see it half done.
        snapshots.make_parent(out)
        con.execute(f"""
            COPY result TO {sql_string(out)} (FORMAT parquet, COMPRESSION zstd,
              KV_METADATA {{{COLUMNS_METADATA_KEY}: {columns}}})
        """)
        (rows,) = con.sql("SELECT count(*) FROM result").fetchone()
    snapshot.tables[job.name] = {
        "files": [key],
        "rows": rows,
        "job": job.version,
        "inputs": list(job.inputs),
    }
    return rows


def run_jobs(jobs: list[Job], client: Mapping[str, Any], snapshot: Snapshot) -> dict[str, str]:
    """Run every job in dependency order. Returns each job's status: built, failed or skipped."""
    statuses = snapshot.status
    for job in build_order(jobs):
        blocked = [t for t in job.inputs if statuses.get(t, "built") != "built"]
        if blocked:
            statuses[job.name] = "skipped"
            print(f"{job.name}: skipped, {', '.join(blocked)} did not build", file=sys.stderr)
        else:
            try:
                rows = run_job(job, client, snapshot)
                statuses[job.name] = "built"
                print(f"{job.name}: {rows} rows")
                continue
            except (duckdb.Error, ContractError) as error:
                statuses[job.name] = "failed"
                print(f"{job.name}: failed: {error}", file=sys.stderr)
    return statuses


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--client", required=True, type=Path, help="Client config TOML")
    parser.add_argument("--bucket-url", required=True, help="file://, s3:// or az:// base URL")
    parser.add_argument("--run-id", required=True, help="The extract run whose raw files to read")
    parser.add_argument("--snapshot-id", help="Defaults to the current UTC time")
    parser.add_argument("--no-verify", action="store_true", help="Skip the lineage check")
    parser.add_argument("--no-publish", action="store_true", help="Don't move latest.json")
    args = parser.parse_args()

    client = tomllib.loads(args.client.read_text())
    job_dirs = [JOBS_DIR, CLIENTS_DIR / client["client"] / "jobs"]
    jobs = load_jobs([d for d in job_dirs if d.is_dir()])
    snapshot_id = args.snapshot_id or snapshots.new_snapshot_id(datetime.now(UTC))
    snapshot = snapshots.start(args.bucket_url, args.run_id, snapshot_id, os.environ)
    statuses = run_jobs(jobs, client, snapshot)
    failed = any(status != "built" for status in statuses.values())
    if not args.no_verify:
        # Imported here because verify.py imports this module.
        from verify import verify_jobs

        built = [job for job in build_order(jobs) if statuses[job.name] == "built"]
        snapshot.verified = verify_jobs(built, client, snapshot)
        failed |= not snapshot.verified
    print(f"manifest_url={snapshots.save(snapshot)}")
    if failed:
        print(f"snapshot {snapshot.id} not published", file=sys.stderr)
        sys.exit(1)
    if not args.no_publish:
        snapshots.publish(snapshot)
        print(f"published snapshot {snapshot.id}")


if __name__ == "__main__":
    main()
