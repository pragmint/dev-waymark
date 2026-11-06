"""Build a run's tables from its raw Parquet with jobs that follow CONTRACT.md.

Reads <bucket>/runs/<run_id>/raw/ and writes <bucket>/runs/<run_id>/tables/<name>.parquet. Each
job runs after the jobs it reads, in its own DuckDB connection that sees only its declared inputs.
A table is written only if it passes the contract checks, and a failure skips everything
downstream of it.
"""

import argparse
import re
import sys
import tempfile
import tomllib
from dataclasses import dataclass
from graphlib import CycleError, TopologicalSorter
from pathlib import Path
from typing import Any, Mapping

import duckdb

from extract import run_url

JOBS_DIR = Path(__file__).parent / "jobs"
CLIENTS_DIR = Path(__file__).parent / "clients"
NAME_PATTERN = re.compile(r"^[a-z][a-z0-9_]*$")
FIELD_KEY_PATTERN = re.compile(r"^[a-z][a-z0-9_]*$")
JSON_PATH_PATTERN = re.compile(r"^\$(\.[A-Za-z0-9_]+)+$")
VALUE_TYPES = {"string", "number", "date", "boolean"}
RAW_PREFIX = "raw."
RAW_ROW_ID = "_dlt_id"
SOURCES_TYPE = 'STRUCT("table" VARCHAR, row_id VARCHAR)[]'


class ContractError(Exception):
    pass


@dataclass(frozen=True)
class Job:
    name: str
    inputs: tuple[str, ...]
    sql: str
    description: str | None = None


def duckdb_path(url: str) -> str:
    return url.removeprefix("file://")


def sql_string(value: str) -> str:
    return "'" + value.replace("'", "''") + "'"


def is_raw(table: str) -> bool:
    return table.startswith(RAW_PREFIX)


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
    sql = (directory / "query.sql").read_text().strip().removesuffix(";")
    return Job(name, inputs, sql, spec.get("description"))


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


def connect(client: Mapping[str, Any], spill_dir: str | None = None) -> duckdb.DuckDBPyConnection:
    """A connection with the contract helpers and the client's parameters installed."""
    mapping = client["mapping"]
    re.compile(mapping["ticket_key_pattern"])
    jira_fields = mapping.get("jira_fields", [])
    for field in jira_fields:
        validate_jira_field(field)

    con = duckdb.connect()
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


def register_inputs(con: duckdb.DuckDBPyConnection, job: Job, run_root: Path) -> None:
    for table in job.inputs:
        if is_raw(table):
            con.execute("CREATE SCHEMA IF NOT EXISTS raw")
            files = run_root / "raw" / table.removeprefix(RAW_PREFIX) / "*.parquet"
            source = f"read_parquet({sql_string(str(files))}, union_by_name = true)"
        else:
            source = f"read_parquet({sql_string(str(run_root / 'tables' / f'{table}.parquet'))})"
        con.execute(f"CREATE VIEW {table} AS SELECT * FROM {source}")


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


def run_job(job: Job, client: Mapping[str, Any], run_root: Path) -> int:
    """Build one job's table and return its row count. Raises if it breaks the contract."""
    out = run_root / "tables" / f"{job.name}.parquet"
    with (
        tempfile.TemporaryDirectory(prefix="waymark-job-") as spill_dir,
        connect(client, spill_dir) as con,
    ):
        register_inputs(con, job, run_root)
        con.execute(f"CREATE TEMP TABLE result AS {job.sql}")
        errors = contract_errors(con, job.inputs)
        if errors:
            raise ContractError("; ".join(errors))
        partial = out.with_suffix(".parquet.partial")
        con.execute(f"COPY result TO {sql_string(str(partial))} (FORMAT parquet, COMPRESSION zstd)")
        (rows,) = con.sql("SELECT count(*) FROM result").fetchone()
    partial.replace(out)
    return rows


def run_jobs(jobs: list[Job], client: Mapping[str, Any], run_root: Path) -> dict[str, str]:
    """Run every job in dependency order. Returns each job's status: built, failed or skipped."""
    (run_root / "tables").mkdir(parents=True, exist_ok=True)
    statuses: dict[str, str] = {}
    for job in build_order(jobs):
        blocked = [t for t in job.inputs if statuses.get(t, "built") != "built"]
        if blocked:
            statuses[job.name] = "skipped"
            print(f"{job.name}: skipped, {', '.join(blocked)} did not build", file=sys.stderr)
        else:
            try:
                rows = run_job(job, client, run_root)
                statuses[job.name] = "built"
                print(f"{job.name}: {rows} rows")
                continue
            except (duckdb.Error, ContractError) as error:
                statuses[job.name] = "failed"
                print(f"{job.name}: failed: {error}", file=sys.stderr)
        # An older file would otherwise pass for this run's output.
        (run_root / "tables" / f"{job.name}.parquet").unlink(missing_ok=True)
    return statuses


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--client", required=True, type=Path, help="Client config TOML")
    parser.add_argument("--bucket-url", required=True, help="file:// base URL")
    parser.add_argument("--run-id", required=True, help="The run extract.py wrote")
    args = parser.parse_args()

    client = tomllib.loads(args.client.read_text())
    job_dirs = [JOBS_DIR, CLIENTS_DIR / client["client"] / "jobs"]
    jobs = load_jobs([d for d in job_dirs if d.is_dir()])
    run_root = Path(duckdb_path(run_url(args.bucket_url, args.run_id)))
    statuses = run_jobs(jobs, client, run_root)
    if any(status != "built" for status in statuses.values()):
        sys.exit(1)


if __name__ == "__main__":
    main()
