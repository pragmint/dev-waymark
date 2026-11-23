"""Build a snapshot of a client's entities from one extract run, with jobs that follow CONTRACT.md.

Reads the raw files of the run's chain (its last full run and every run since). Every job writes
entities: one with `entity_type` makes a new type of them, and one with `adds_to` adds metadata to
an existing type. A job's output is never a table of its own. The runner checks it against the
contract, then writes it as the job's part of the two entity tables,
<bucket>/tables/<table>/<snapshot>.<job>.parquet, with its diff against the published snapshot
beside it (the layout is in snapshot.py). Each job runs after the jobs whose entities it reads, in
its own DuckDB connection that sees only its declared inputs, resolved to the snapshot's exact
files. A container job gets those inputs staged as local Parquet and runs locked down
(container.py). A failure skips everything downstream of it. A job whose version, parameters and
input files are all the same as in the published snapshot isn't run again: the new manifest
lists the published parts (`--rebuild` runs everything). Then verify.py checks each job it ran by
re-running it on a sample of the same files. The manifest is saved either way; latest.json moves
to it only if every job ran or was reused, and verified.
"""

import argparse
import hashlib
import json
import os
import re
import shutil
import sys
import tempfile
import tomllib
from dataclasses import dataclass
from datetime import UTC, datetime
from graphlib import CycleError, TopologicalSorter
from pathlib import Path
from typing import Any, Mapping

import duckdb

import container
import snapshot as snapshots
from container import ContainerError
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
# `<input>.<column>`, with `:<json path>` for a value inside a JSON text column, and
# `<input>[<column>=<value>].<column>` for only the rows of the input whose column holds value.
REF_PATTERN = re.compile(
    r"^((?:raw\.)?[a-z][a-z0-9_]*)"
    r"(?:\[([A-Za-z_][A-Za-z0-9_]*)=([^\[\]]+)\])?"
    r"\.([A-Za-z_][A-Za-z0-9_]*)"
    r"(?::(\$(?:\.[A-Za-z0-9_]+)+))?$"
)
# Columns that stand for a row's identity: a reference to one reads the whole row.
ROW_IDENTITY = frozenset({"_row_id", RAW_ROW_ID})
COLUMNS_METADATA_KEY = "waymark_columns"
CHANGE_KINDS = ("added", "changed", "removed")
CHANGES_SCHEMA = "_row_id BIGINT, change VARCHAR"
# A job's status in a snapshot. Only `built` and `reused` tables can be read downstream.
READY = ("built", "reused")
JSON_TYPES = {"VARCHAR", "JSON"}
JOB_KINDS = ("sql", "container")
# The tables every job writes its part of, and the column that holds each row's entity type. A
# job reads one type of them at a time, `entities[type=ticket]` (CONTRACT.md, "Inputs").
ENTITY_TABLES = {"entities": "type", "entity_metadata": "entity_type"}
ENTITIES = "entities"
METADATA = "entity_metadata"
# The columns of `entities`; any other column a reference names on it is a metadata key.
ENTITY_TABLE_COLUMNS = ("_row_id", "id", "type", "name", "created_at")
# An input: a raw table, or an entity table filtered to one type, `<table>[<column>=<type>]`.
INPUT_PATTERN = re.compile(r"^((?:raw\.)?[a-z][a-z0-9_]*)(?:\[([a-z_]+)=([a-z][a-z0-9_]*)\])?$")
# The columns of an `entity_type` job that Waymark reads as the entity itself; every other one is
# metadata.
ENTITY_COLUMNS = ("name", "created_at")
# Metadata whose keys the query can't name in advance, such as a client's custom fields: each
# entry is one more value of the row's entity.
EXTRA_METADATA = "_metadata"
EXTRA_METADATA_TYPE = "STRUCT(\"key\" VARCHAR, \"value\" VARCHAR, value_type VARCHAR)[]"
# Keys no metadata may have: the entity's own columns.
RESERVED_KEYS = ("id", "type", *ENTITY_COLUMNS)
ISO_UTC_PATTERN = r"^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}Z$"
NUMBER_TYPES = re.compile(
    r"^(TINYINT|SMALLINT|INTEGER|BIGINT|HUGEINT|UTINYINT|USMALLINT|UINTEGER|UBIGINT|UHUGEINT"
    r"|FLOAT|DOUBLE|DECIMAL\(\d+,\d+\))$"
)


class ContractError(Exception):
    pass


@dataclass(frozen=True)
class Job:
    name: str
    inputs: tuple[str, ...]
    # The query of a `sql` job; empty for a `container` job.
    sql: str
    description: str | None = None
    # A hash of the job's files, recorded in the manifest beside each table it builds. For a
    # container job it covers job.toml, so it changes with the pinned image.
    version: str = ""
    kind: str = "sql"
    # A container job's image, pinned by digest.
    image: str | None = None
    # Exactly one of these: the type of entity each row is, or the type whose entities each row
    # adds metadata to, by `_row_id` (CONTRACT.md, "What a job writes").
    entity_type: str | None = None
    adds_to: str | None = None

    @property
    def writes_type(self) -> str:
        """The type of entity the job's rows are, or add to."""
        type_ = self.entity_type or self.adds_to
        assert type_ is not None, f"{self.name} writes no entity type"
        return type_


def parse_input(text: str) -> tuple[str, str | None]:
    """An input's table and, for `entities[type=ticket]`, the entity type it reads. A raw table
    is read whole; an entity table only one type at a time."""
    match = INPUT_PATTERN.match(text)
    if not match:
        raise ValueError(f"invalid input {text!r}")
    table, column, value = match.groups()
    if column is None:
        if is_raw(table):
            return table, None
        if table in ENTITY_TABLES:
            raise ValueError(
                f"input {text!r} must name the type it reads, as {table}"
                f"[{ENTITY_TABLES[table]}=ticket]: every job adds to {table}"
            )
        raise ValueError(
            f"input {text!r} isn't a table: jobs write entities, so read "
            f"entities[type=...] or entity_metadata[entity_type=...]"
        )
    if ENTITY_TABLES.get(table) != column:
        allowed = ", ".join(f"{t}[{c}=...]" for t, c in ENTITY_TABLES.items())
        raise ValueError(f"input {text!r} can't be filtered: only {allowed} can")
    return table, value


def input_tables(job: Job) -> dict[str, frozenset[str] | None]:
    """Each table the job reads, by the name its query uses, and the entity types it reads of
    it, or None for a raw table."""
    tables: dict[str, frozenset[str] | None] = {}
    for text in job.inputs:
        table, type_ = parse_input(text)
        tables[table] = None if type_ is None else (tables.get(table) or frozenset()) | {type_}
    return tables


def is_raw(table: str) -> bool:
    return table.startswith(RAW_PREFIX)


@dataclass(frozen=True)
class Ref:
    """One column reference in `_fields` (CONTRACT.md, "Column lineage")."""

    table: str
    column: str
    path: str | None = None
    # (column, value): the reference reads only the rows of `table` whose column holds value.
    where: tuple[str, str] | None = None

    @property
    def label(self) -> str:
        """The column as it reads within its table: `column` or `column:<json path>`."""
        return f"{self.column}:{self.path}" if self.path else self.column

    @property
    def is_identity(self) -> bool:
        return self.column in ROW_IDENTITY

    def matches(self, value: str | None) -> bool:
        """Whether a row whose filter column holds `value` is one this reference reads."""
        return self.where is None or value == self.where[1]


def parse_ref(ref: str) -> Ref:
    match = REF_PATTERN.match(ref)
    if not match:
        raise ValueError(f"Invalid column reference: {ref!r}")
    table, where_column, where_value, column, path = match.groups()
    where = (where_column, where_value) if where_column else None
    return Ref(table, column, path, where)


def load_job(directory: Path) -> Job:
    name = directory.name
    if not NAME_PATTERN.match(name):
        raise ValueError(f"Invalid job name: {name!r}")
    spec = tomllib.loads((directory / "job.toml").read_text())
    kind = spec.get("kind", "sql")
    if kind not in JOB_KINDS:
        raise ValueError(f"{name}: kind must be one of {', '.join(JOB_KINDS)}, got {kind!r}")
    inputs = tuple(spec["inputs"])
    for text in inputs:
        try:
            parse_input(text)
        except ValueError as error:
            raise ValueError(f"{name}: {error}") from error
    entity_type, adds_to = spec.get("entity_type"), spec.get("adds_to")
    if (entity_type is None) == (adds_to is None):
        raise ValueError(
            f"{name}: every job writes entities; set entity_type to make a new type of them, or"
            f" adds_to to add metadata to an existing type"
        )
    for setting, value in (("entity_type", entity_type), ("adds_to", adds_to)):
        if value is not None and not NAME_PATTERN.match(str(value)):
            raise ValueError(f"{name}: invalid {setting} {value!r}")
    if "columns" in spec:
        raise ValueError(f"{name}: [columns] is gone; the query returns _fields instead")
    version = job_version(directory)
    if kind == "container":
        if (directory / "query.sql").exists():
            raise ValueError(f"{name}: a container job has no query.sql")
        try:
            image = container.check_image(spec.get("image"))
        except ValueError as error:
            raise ValueError(f"{name}: {error}") from error
        return Job(
            name, inputs, "", spec.get("description"), version, kind, image, entity_type, adds_to
        )
    if "image" in spec:
        raise ValueError(f"{name}: image is only for container jobs")
    sql = (directory / "query.sql").read_text().strip().removesuffix(";")
    return Job(
        name, inputs, sql, spec.get("description"), version,
        entity_type=entity_type, adds_to=adds_to,
    )  # fmt: skip


def job_version(directory: Path) -> str:
    digest = hashlib.sha256()
    for path in sorted(p for p in directory.iterdir() if p.is_file()):
        digest.update(path.name.encode() + b"\0" + path.read_bytes() + b"\0")
    return digest.hexdigest()[:16]


def job_dirs(client: Mapping[str, Any], extra: list[Path]) -> list[Path]:
    """The shared jobs, then the client's, then any extra folders, in order of precedence."""
    for directory in extra:
        if not directory.is_dir():
            raise ValueError(f"No such job folder: {directory}")
    shared = [JOBS_DIR, CLIENTS_DIR / client["client"] / "jobs"]
    return [d for d in shared if d.is_dir()] + extra


def load_jobs(directories: list[Path]) -> list[Job]:
    """Every job in the given folders. A later folder's job replaces an earlier one by name."""
    jobs: dict[str, Job] = {}
    for directory in directories:
        for path in sorted(directory.iterdir()):
            if (path / "job.toml").exists():
                jobs[path.name] = load_job(path)
    return list(jobs.values())


def entity_types(jobs: list[Job]) -> dict[str, str]:
    """Each entity type a job makes, and the job that makes it."""
    makers: dict[str, str] = {}
    for job in jobs:
        if job.entity_type is None:
            continue
        if job.entity_type in makers:
            raise ValueError(
                f"{makers[job.entity_type]} and {job.name} both make entity type {job.entity_type}"
            )
        makers[job.entity_type] = job.name
    return makers


def reaches(graph: Mapping[str, set[str]], start: str, goal: str) -> bool:
    """Whether `start` depends on `goal`, directly or not."""
    seen, stack = set(), [start]
    while stack:
        name = stack.pop()
        if name == goal:
            return True
        if name not in seen:
            seen.add(name)
            stack.extend(graph.get(name, ()))
    return False


def plan(jobs: list[Job]) -> dict[str, dict[str, list[str]]]:
    """For each job, the jobs whose parts each of its inputs reads, in name order; none for a raw
    table. `entities[type=x]` reads the job that makes x. `entity_metadata[entity_type=x]` reads
    that job and every job that adds to x, except one that reads the job itself, directly or not:
    a job can't see metadata computed from its own entities."""
    by_name = {job.name: job for job in jobs}
    makers = entity_types(jobs)
    adders: dict[str, list[str]] = {}
    for job in sorted(jobs, key=lambda j: j.name):
        if job.adds_to is not None:
            adders.setdefault(job.adds_to, []).append(job.name)
    graph: dict[str, set[str]] = {}
    reads: dict[str, dict[str, list[str]]] = {}
    for job in jobs:
        graph[job.name] = set()
        reads[job.name] = {}
        if job.adds_to is not None:
            if job.adds_to not in makers:
                raise ValueError(f"{job.name}: no job makes entity type {job.adds_to} to add to")
            graph[job.name].add(makers[job.adds_to])
        for text in job.inputs:
            table, type_ = parse_input(text)
            reads[job.name][text] = []
            if type_ is None:
                continue
            if type_ not in makers:
                raise ValueError(f"{job.name}: no job makes entity type {type_}, read by {text}")
            if makers[type_] == job.name:
                raise ValueError(f"{job.name} makes entity type {type_}, so it can't read it")
            reads[job.name][text].append(makers[type_])
            graph[job.name].add(makers[type_])
    # Then each job that adds to a type whose metadata a job reads, unless it depends on that job.
    for job in sorted(jobs, key=lambda j: j.name):
        for text in job.inputs:
            table, type_ = parse_input(text)
            if table != "entity_metadata" or type_ is None:
                continue
            for adder in adders.get(type_, []):
                if adder != job.name and not reaches(graph, adder, job.name):
                    graph[job.name].add(adder)
                    reads[job.name][text].append(adder)
            reads[job.name][text].sort()
    assert set(graph) == set(by_name)
    return reads


def dependencies(jobs: list[Job]) -> dict[str, list[str]]:
    """The jobs each job must run after: the ones whose parts it reads (`plan`), and for a job
    that adds to a type, the job that makes it."""
    makers = entity_types(jobs)
    reads = plan(jobs)
    needs = {}
    for job in jobs:
        names = [name for names in reads[job.name].values() for name in names]
        if job.adds_to is not None:
            names.append(makers[job.adds_to])
        needs[job.name] = sorted(set(names))
    return needs


def build_order(jobs: list[Job]) -> list[Job]:
    by_name = {job.name: job for job in jobs}
    try:
        return [by_name[name] for name in TopologicalSorter(dependencies(jobs)).static_order()]
    except CycleError as error:
        raise ValueError(f"Jobs read each other in a cycle: {error.args[1]}") from error


def validate_jira_field(field: Mapping[str, str]) -> None:
    if not FIELD_KEY_PATTERN.match(field["key"]):
        raise ValueError(f"Invalid metadata key: {field['key']!r}")
    if not JSON_PATH_PATTERN.match(field["path"]):
        raise ValueError(f"Invalid Jira field path: {field['path']!r}")
    if field["value_type"] not in VALUE_TYPES:
        raise ValueError(f"Invalid value type: {field['value_type']!r}")


def job_params(client: Mapping[str, Any]) -> dict[str, Any]:
    """The client's parameters every job sees: SQL jobs as variables and `params` tables,
    container jobs as `WAYMARK_PARAMS`."""
    mapping = client["mapping"]
    re.compile(mapping["ticket_key_pattern"])
    jira_fields = mapping.get("jira_fields", [])
    for field in jira_fields:
        validate_jira_field(field)
    return {
        "client": client["client"],
        "jira_base_url": client["jira"]["base_url"].rstrip("/"),
        "ticket_key_pattern": mapping["ticket_key_pattern"],
        "statuses": dict(mapping.get("statuses", {})),
        "jira_fields": [
            {name: field[name] for name in ("key", "path", "value_type")} for field in jira_fields
        ],
    }


def params_version(client: Mapping[str, Any]) -> str:
    """A hash of the parameters every job sees: a change rebuilds every table, like a new job
    version would."""
    text = json.dumps(job_params(client), sort_keys=True)
    return hashlib.sha256(text.encode()).hexdigest()[:16]


def connect(
    client: Mapping[str, Any], spill_dir: str | None = None, snapshot: Snapshot | None = None
) -> duckdb.DuckDBPyConnection:
    """A connection with the contract helpers and the client's parameters installed, able to
    read the snapshot's storage."""
    params = job_params(client)
    con = snapshot.connect() if snapshot else duckdb.connect()
    if spill_dir:
        con.execute(f"SET temp_directory = {sql_string(spill_dir)}")
    for name in ("client", "jira_base_url", "ticket_key_pattern"):
        con.execute(f"SET VARIABLE {name} = {sql_string(params[name])}")
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
        "status_map (status VARCHAR, status_group VARCHAR)": list(params["statuses"].items()),
        "jira_fields (key VARCHAR, path VARCHAR, value_type VARCHAR)": [
            (f["key"], f["path"], f["value_type"]) for f in params["jira_fields"]
        ],
    }
    for definition, rows in tables.items():
        con.execute(f"CREATE TABLE params.{definition}")
        if rows:
            placeholders = ", ".join("?" * len(rows[0]))
            name = definition.split(" ")[0]
            con.executemany(f"INSERT INTO params.{name} VALUES ({placeholders})", rows)
    return con


def resolve_inputs(
    job: Job, reads: Mapping[str, list[str]], snapshot: Snapshot
) -> dict[str, list[str]]:
    """The exact files each of the job's inputs reads in this snapshot, as keys: a raw table's
    files, or the parts of an entity table that the jobs `reads` names wrote."""
    resolved = {}
    for text in job.inputs:
        table, type_ = parse_input(text)
        if type_ is None:
            entry = snapshot.tables.get(table)
            if entry is None:
                raise ValueError(f"Snapshot {snapshot.id} has no files for {table}")
            resolved[text] = list(entry["files"])
            continue
        keys = [snapshot.part(name, table) for name in reads[text]]
        if any(key is None for key in keys):
            missing = [n for n, k in zip(reads[text], keys) if k is None]
            raise ValueError(f"Snapshot {snapshot.id} has no {table} from {', '.join(missing)}")
        resolved[text] = [key for key in keys if key is not None]
    return resolved


def input_sources(job: Job, resolved: Mapping[str, list[str]], snapshot: Snapshot) -> dict[str, str]:
    """A query for each table the job reads, by the name its query uses: a raw table whole, an
    entity table only the types it names, from exactly the files `resolve_inputs` found."""
    keys: dict[str, list[str]] = {}
    for text, files in resolved.items():
        table, _ = parse_input(text)
        keys.setdefault(table, [])
        keys[table] += [key for key in files if key not in keys[table]]
    sources = {}
    for table, types in input_tables(job).items():
        source = snapshots.read_parquet([snapshot.url(key) for key in keys[table]])
        if types is None:
            sources[table] = f"SELECT * FROM {source}"
        else:
            listed = ", ".join(sql_string(t) for t in sorted(types))
            sources[table] = f"SELECT * FROM {source} WHERE {ENTITY_TABLES[table]} IN ({listed})"
    return sources


def register_inputs(con: duckdb.DuckDBPyConnection, sources: Mapping[str, str]) -> None:
    for table, source in sources.items():
        if is_raw(table):
            con.execute("CREATE SCHEMA IF NOT EXISTS raw")
        con.execute(f"CREATE VIEW {table} AS {source}")


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
    named = [t for (t,) in con.sql("SELECT DISTINCT \"table\" FROM refs ORDER BY 1").fetchall()]
    if METADATA in named:
        errors.append(
            f"_sources names {METADATA} rows: cite the entity they belong to, "
            f"source_ref('{ENTITIES}', entity_id), and read {ENTITIES}[type=...] for it"
        )
    undeclared = [t for t in named if t not in inputs and t != METADATA]
    if undeclared:
        errors.append(f"_sources names tables that are not inputs: {undeclared}")
    for table in inputs:
        if table == METADATA:
            continue
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
    # A reference to an entity's metadata value is `entities.<key>`: the keys the job can see.
    keys = (
        {k for (k,) in con.sql(f'SELECT DISTINCT "key" FROM {METADATA}').fetchall()}
        if METADATA in inputs
        else set()
    )
    for ref, columns in refs:
        where = f"_fields[{', '.join(columns)}]"
        if ref is None:
            errors.append(f"{where} holds a null reference")
            continue
        try:
            parsed = parse_ref(ref)
        except ValueError as error:
            errors.append(f"{where}: {error}")
            continue
        table, column, path = parsed.table, parsed.column, parsed.path
        if table == METADATA:
            errors.append(
                f"{where}: {ref} names a {METADATA} row; name the entity's value instead, "
                f"{ENTITIES}.<key>"
            )
            continue
        if table not in inputs:
            errors.append(f"{where} reads {table}, which is not an input")
            continue
        if table not in input_types:
            input_types[table] = {n: t for n, t, *_ in con.sql(f"DESCRIBE {table}").fetchall()}
        type_ = input_types[table].get(column)
        if table == ENTITIES and type_ is None:
            if column not in keys:
                errors.append(
                    f"{where}: {ENTITIES} has no column {column}, and no metadata key {column} "
                    f"in the {METADATA} it reads"
                )
            elif path:
                errors.append(f"{where}: {ref} has a JSON path on a metadata value")
        elif type_ is None:
            errors.append(f"{where}: {table} has no column {column}")
        elif path and type_ not in JSON_TYPES:
            errors.append(f"{where}: {ref} has a JSON path on a {type_} column")
        if parsed.where:
            filter_type = input_types[table].get(parsed.where[0])
            if filter_type is None:
                errors.append(f"{where}: {table} has no column {parsed.where[0]} to filter on")
            elif filter_type != "VARCHAR":
                errors.append(f"{where}: {ref} filters on a {filter_type} column, not text")
            if path:
                errors.append(f"{where}: {ref} has both a filter and a JSON path")
    return errors


def column_map(con: duckdb.DuckDBPyConnection, table: str = "result") -> dict[str, list[str]]:
    """Each output column's references over every row: the table's column map."""
    rows = con.sql(f"""
        SELECT column_name, list_sort(list_distinct(flatten(list(refs)))) FROM (
          SELECT unnest(map_keys(f)) AS column_name, unnest(map_values(f)) AS refs
          FROM (SELECT DISTINCT _fields AS f FROM {table})
        )
        GROUP BY column_name
    """).fetchall()
    return {column: refs for column, refs in sorted(rows)}


def describe_changes(changes: Mapping[str, Any] | None) -> str:
    if changes is None:
        return "no base to compare"
    counts = ", ".join(f"{changes[kind]} {kind}" for kind in CHANGE_KINDS)
    return f"{counts} since {changes['base']}"


def create_result(
    con: duckdb.DuckDBPyConnection,
    job: Job,
    client: Mapping[str, Any],
    work_dir: str,
    changes: Mapping[str, str] | None = None,
    table: str = "result",
) -> None:
    """Run the job on the inputs `con` sees, into a temp table. A container job gets an empty
    folder under `work_dir` and the change files of its inputs in `changes`."""
    if job.kind == "sql":
        con.execute(f"CREATE TEMP TABLE {table} AS {job.sql}")
        return
    assert job.image is not None
    work = Path(tempfile.mkdtemp(prefix="container-", dir=work_dir))
    try:
        tables = tuple(input_tables(job))
        output = container.run(con, job.image, tables, job_params(client), work, changes)
        source = f"read_parquet({sql_string(str(output))})"
        # Replaced, because a replay builds its result once per set of inputs it tries.
        con.execute(f"CREATE OR REPLACE TEMP TABLE {table} AS SELECT * FROM {source}")
    finally:
        # The staged inputs are copies, as large as the inputs themselves.
        shutil.rmtree(work, ignore_errors=True)


def maker_of(snapshot: Snapshot, key: str) -> str | None:
    """The job whose part of `entities` a file is."""
    return next(
        (name for name, entry in snapshot.jobs.items() if entry["files"].get("entities") == key),
        None,
    )


def input_changes(
    job: Job, resolved: Mapping[str, list[str]], snapshot: Snapshot
) -> dict[str, str]:
    """The change files a container job gets: for `entities`, when every type it reads of it was
    made by a job this snapshot compared with its base. They list entity ids, the `_row_id`s of
    `entities`. Metadata and raw tables get none."""
    files: list[str] = []
    for text in job.inputs:
        table, type_ = parse_input(text)
        if table != "entities" or type_ is None:
            continue
        for part in resolved[text]:
            changes = snapshot.jobs.get(maker_of(snapshot, part) or "", {}).get("changes")
            if not changes:
                return {}
            files.append(snapshot.url(changes["file"]))
    return {"entities": snapshots.read_parquet(files)} if files else {}


def metadata_value(column: str, type_: str) -> tuple[str, str] | None:
    """How an entity-type job's column becomes a metadata value: its value type and the SQL for
    the value as text, the way the shared entity_metadata job writes it. None if it can't."""
    quoted = f'"{column}"'
    if type_ == "VARCHAR":
        return "string", quoted
    if type_ == "BOOLEAN":
        return "boolean", f"cast({quoted} AS VARCHAR)"
    if NUMBER_TYPES.match(type_):
        return "number", f"cast({quoted} AS VARCHAR)"
    if type_ == "DATE":
        return "date", f"strftime({quoted}, '%Y-%m-%dT00:00:00Z')"
    if type_ == "TIMESTAMP WITH TIME ZONE":
        return "date", f"iso_utc({quoted})"
    if type_.startswith("TIMESTAMP"):
        # A timestamp without a zone is taken to be UTC already.
        return "date", f"strftime(cast({quoted} AS TIMESTAMP), '%Y-%m-%dT%H:%M:%SZ')"
    return None


def column_types(con: duckdb.DuckDBPyConnection, table: str = "result") -> dict[str, str]:
    return {name: type_ for name, type_, *_ in con.sql(f"DESCRIBE {table}").fetchall()}


def metadata_columns(types: Mapping[str, str], job: Job) -> dict[str, str]:
    """The output columns that become metadata, with their DuckDB types."""
    skip = (*CONTRACT_COLUMNS, EXTRA_METADATA, *(ENTITY_COLUMNS if job.entity_type else ()))
    return {name: type_ for name, type_ in types.items() if name not in skip}


def metadata_select(con: duckdb.DuckDBPyConnection, job: Job, table: str = "result") -> str:
    """A query over a job's output for the metadata it becomes: one row per non-null column value
    and `_metadata` entry, with the entity it belongs to (`entity_id`), the value as text, its
    type, the references that value reads (`refs`), and the row's `_sources`. Verify converts a
    replay with the same query, so the two always agree."""
    types = column_types(con, table)
    selects = []
    for column, type_ in metadata_columns(types, job).items():
        value_type, value = metadata_value(column, type_) or ("string", "NULL")
        selects.append(f"""
            SELECT _row_id AS entity_id, {sql_string(column)} AS "key", {value} AS value,
              {sql_string(value_type)} AS value_type,
              map_extract_value(_fields, {sql_string(column)}) AS refs, _sources
            FROM {table} WHERE "{column}" IS NOT NULL
        """)
    if EXTRA_METADATA in types:
        selects.append(f"""
            SELECT _row_id AS entity_id, "key", value, value_type,
              map_extract_value(_fields, '{EXTRA_METADATA}') AS refs, _sources
            FROM (
              SELECT _row_id, _fields, _sources, unnest({EXTRA_METADATA}, recursive := true)
              FROM {table}
            )
            WHERE value IS NOT NULL AND "key" IS NOT NULL
        """)
    selects.append(f"""
        SELECT _row_id AS entity_id, NULL::VARCHAR AS "key", NULL::VARCHAR AS value,
          NULL::VARCHAR AS value_type, NULL::VARCHAR[] AS refs, _sources
        FROM {table} WHERE false
    """)
    return " UNION ALL ".join(selects)


def extra_metadata_errors(
    con: duckdb.DuckDBPyConnection, types: Mapping[str, str], job: Job
) -> list[str]:
    """What is wrong with the `_metadata` column, if the `result` table has one."""
    if EXTRA_METADATA not in types:
        return []
    if types[EXTRA_METADATA] != EXTRA_METADATA_TYPE:
        return [f"{EXTRA_METADATA} must be {EXTRA_METADATA_TYPE}, got {types[EXTRA_METADATA]}"]
    taken = [*RESERVED_KEYS, *metadata_columns(types, job)]
    (bad_keys, bad_types, repeated) = con.execute(
        f"""
        SELECT
          count(*) FILTER (NOT regexp_full_match(coalesce("key", ''), ?)
            OR "key" IN (SELECT unnest(?::VARCHAR[]))),
          count(*) FILTER (value_type IS NULL OR value_type NOT IN (SELECT unnest(?::VARCHAR[]))),
          count(*) - count(DISTINCT (_row_id, "key"))
        FROM (SELECT _row_id, unnest({EXTRA_METADATA}, recursive := true) FROM result)
        """,
        [FIELD_KEY_PATTERN.pattern, taken, sorted(VALUE_TYPES)],
    ).fetchone()
    errors = []
    if bad_keys:
        errors.append(
            f"{bad_keys} {EXTRA_METADATA} entries have a key that isn't a valid metadata key or"
            " is already a column"
        )
    if bad_types:
        errors.append(f"{bad_types} {EXTRA_METADATA} entries have an unknown value_type")
    if repeated:
        errors.append(f"{repeated} {EXTRA_METADATA} entries repeat a key in their row")
    return errors


def shape_errors(
    con: duckdb.DuckDBPyConnection, job: Job, snapshot: Snapshot, makers: Mapping[str, str]
) -> list[str]:
    """What stops the `result` table from becoming entities and metadata (CONTRACT.md, "What a
    job writes")."""
    types = column_types(con)
    errors = []
    if job.entity_type is not None:
        for column in ENTITY_COLUMNS:
            if types.get(column) != "VARCHAR":
                errors.append(f"an entity needs a text {column} column, got {types.get(column)}")
        if not errors:
            (no_name, bad_date) = con.execute(
                "SELECT count(*) FILTER (name IS NULL OR name = ''),"
                " count(*) FILTER (NOT regexp_full_match(coalesce(created_at, ''), ?)) FROM result",
                [ISO_UTC_PATTERN],
            ).fetchone()
            if no_name:
                errors.append(f"{no_name} rows have no name")
            if bad_date:
                errors.append(f"{bad_date} rows have a created_at that isn't iso_utc text")
    for column, type_ in metadata_columns(types, job).items():
        if column in RESERVED_KEYS:
            errors.append(f"{column} is the entity's own, so it can't be metadata")
        elif not FIELD_KEY_PATTERN.match(column):
            errors.append(f"{column!r} can't be a metadata key: use lowercase, digits and _")
        elif metadata_value(column, type_) is None:
            errors.append(f"{column} is a {type_}, which can't be metadata")
    errors += extra_metadata_errors(con, types, job)
    if errors:
        return errors
    entities = snapshot.tables.get("entities", {}).get("files", [])
    if job.entity_type is not None and entities:
        every = snapshots.read_parquet([snapshot.url(k) for k in entities])
        (clashes,) = con.sql(
            f"SELECT count(*) FROM result SEMI JOIN {every} AS e USING (_row_id)"
        ).fetchone()
        if clashes:
            errors.append(f"{clashes} rows have the _row_id of an entity that already exists")
    if job.adds_to is not None:
        made = snapshot.part(makers[job.adds_to], "entities")
        assert made is not None
        (strangers,) = con.sql(
            f"SELECT count(*) FROM result ANTI JOIN "
            f"{snapshots.read_parquet([snapshot.url(made)])} AS e USING (_row_id)"
        ).fetchone()
        if strangers:
            errors.append(f"{strangers} rows have a _row_id that isn't a {job.adds_to}'s id")
    others = [
        entry["files"]["entity_metadata"]
        for name, entry in snapshot.jobs.items()
        if name != job.name and entry.get("type") == job.writes_type
    ]
    if others:
        written = snapshots.read_parquet([snapshot.url(k) for k in others])
        taken = con.sql(f"""
            SELECT DISTINCT "key" FROM ({metadata_select(con, job)})
            WHERE "key" IN (SELECT DISTINCT "key" FROM {written})
            ORDER BY 1
        """).fetchall()
        if taken:
            listed = ", ".join(name for (name,) in taken)
            errors.append(f"another job already writes {job.writes_type} metadata {listed}")
    return errors


def write_parts(
    con: duckdb.DuckDBPyConnection, job: Job, snapshot: Snapshot, makers: Mapping[str, str]
) -> dict[str, str]:
    """Write the `result` table as the job's parts of the entity tables, and return their keys.
    An entity's name and created_at, and each metadata value, keep the `_sources` and `_fields`
    of the job's row: lineage goes straight from them to what the job read."""
    name, type_ = job.name, sql_string(job.writes_type)
    temps = {}
    if job.entity_type is not None:
        con.execute(f"""
            CREATE OR REPLACE TEMP TABLE part_entities AS
            SELECT _row_id, _sources,
              cast(map {{
                'id': [], 'name': map_extract_value(_fields, 'name'), 'type': [],
                'created_at': map_extract_value(_fields, 'created_at')
              }} AS {FIELDS_TYPE}) AS _fields,
              _row_id AS id, name, {type_} AS type, created_at
            FROM result ORDER BY _row_id
        """)
        temps["entities"] = "part_entities"
        dated = (
            "SELECT _row_id AS entity_id, created_at AS entity_created_at, "
            "map_extract_value(_fields, 'created_at') AS created_refs FROM result"
        )
    else:
        made = snapshot.part(makers[job.writes_type], "entities")
        assert made is not None
        # Metadata added to an entity is dated like the entity.
        dated = (
            "SELECT _row_id AS entity_id, created_at AS entity_created_at, "
            f"[]::VARCHAR[] AS created_refs FROM {snapshots.read_parquet([snapshot.url(made)])}"
        )
    metadata_id = "stable_id('metadata', concat_ws(':', entity_id, \"key\"))"
    con.execute(f"""
        CREATE OR REPLACE TEMP TABLE part_entity_metadata AS
        SELECT {metadata_id} AS _row_id, _sources,
          cast(map {{
            'id': [], 'entity_id': [], 'entity_type': [], 'key': [], 'value': refs,
            'value_type': [], 'created_at': created_refs, 'updated_at': created_refs
          }} AS {FIELDS_TYPE}) AS _fields,
          {metadata_id} AS id, entity_id, {type_} AS entity_type, "key", value, value_type,
          entity_created_at AS created_at, entity_created_at AS updated_at
        FROM ({metadata_select(con, job)}) INNER JOIN ({dated}) USING (entity_id)
        -- Sorted by key so a chart reading a few keys can skip the other row groups.
        ORDER BY "key", entity_id
    """)
    temps["entity_metadata"] = "part_entity_metadata"
    keys = {}
    for table, temp in temps.items():
        key = snapshot.part_key(name, table)
        out = snapshot.url(key)
        snapshots.make_parent(out)
        # The union of every row's _fields travels in the file's own metadata, so a reader can
        # trace a column across the whole part without scanning it.
        columns = sql_string(json.dumps(column_map(con, temp), sort_keys=True))
        con.execute(f"""
            COPY {temp} TO {sql_string(out)} (FORMAT parquet, COMPRESSION zstd,
              KV_METADATA {{{COLUMNS_METADATA_KEY}: {columns}}})
        """)
        keys[table] = key
    return keys


def part_hashes(sources: Mapping[str, str]) -> str:
    """A query for a hash of each entity's values in a job's parts, given as table → source: its
    name and created_at if the job made it, and its metadata. Lineage isn't hashed: a record
    fetched again unchanged gets new raw ids but the same values."""
    values = [
        f"SELECT _row_id AS entity_id, '{column}' AS \"key\", {column} AS value, "
        f"'entity' AS value_type FROM {sources['entities']}"
        for column in ENTITY_COLUMNS
        if "entities" in sources
    ]
    values.append(f"SELECT entity_id, \"key\", value, value_type FROM {sources['entity_metadata']}")
    return f"""
        SELECT entity_id AS _row_id,
          md5(string_agg(to_json(["key", value, value_type]), ',' ORDER BY "key")) AS row_hash
        FROM ({' UNION ALL '.join(values)}) GROUP BY entity_id
    """


def write_changes(
    con: duckdb.DuckDBPyConnection, job: Job, snapshot: Snapshot, files: Mapping[str, str]
) -> dict[str, Any] | None:
    """Compare the job's parts with the base snapshot's, entity by entity, and write the ids of
    the entities that were added, changed or removed. Returns the manifest's `changes` entry, or
    None when the base has no parts from the job."""
    base = snapshot.base
    entry = base.jobs.get(job.name) if base else None
    if base is None or entry is None or set(entry["files"]) != set(files):
        return None
    now = {table: f"part_{table}" for table in files}
    then = {table: snapshots.read_parquet([base.url(k)]) for table, k in entry["files"].items()}
    con.execute(f"CREATE OR REPLACE TEMP TABLE now_hashes AS {part_hashes(now)}")
    con.execute(f"CREATE OR REPLACE TEMP TABLE base_hashes AS {part_hashes(then)}")
    con.execute("""
        CREATE OR REPLACE TEMP TABLE changes AS
        SELECT coalesce(now._row_id, base._row_id) AS _row_id,
          CASE WHEN base._row_id IS NULL THEN 'added'
               WHEN now._row_id IS NULL THEN 'removed'
               ELSE 'changed' END AS change
        FROM now_hashes AS now FULL JOIN base_hashes AS base USING (_row_id)
        WHERE now.row_hash IS DISTINCT FROM base.row_hash
        ORDER BY _row_id
    """)
    key = snapshot.changes_key(job.name)
    out = snapshot.url(key)
    snapshots.make_parent(out)
    con.execute(f"COPY changes TO {sql_string(out)} (FORMAT parquet, COMPRESSION zstd)")
    counts = dict(con.sql("SELECT change, count(*) FROM changes GROUP BY change").fetchall())
    return {"file": key, "base": base.id, **{kind: counts.get(kind, 0) for kind in CHANGE_KINDS}}


# What a job's manifest entry must match for its parts to be reused.
REUSE_KEYS = ("job", "params", "inputs", "read", "type")


def job_entry(
    job: Job, client: Mapping[str, Any], resolved: Mapping[str, list[str]]
) -> dict[str, Any]:
    """What the manifest records of how a job ran: its version, parameters, inputs, the exact
    files each input read, and the type it makes or adds to."""
    return {
        "job": job.version,
        "params": params_version(client),
        "inputs": list(job.inputs),
        "read": {text: list(keys) for text, keys in resolved.items()},
        "type": job.writes_type,
        "adds": job.adds_to is not None,
    }


def run_job(
    job: Job,
    client: Mapping[str, Any],
    snapshot: Snapshot,
    reads: Mapping[str, list[str]],
    makers: Mapping[str, str],
) -> int:
    """Run one job and write its parts into the snapshot; return how many rows it wrote. Raises
    if its output breaks the contract, before writing anything."""
    resolved = resolve_inputs(job, reads, snapshot)
    tables = tuple(input_tables(job))
    with (
        tempfile.TemporaryDirectory(prefix="waymark-job-") as spill_dir,
        connect(client, spill_dir, snapshot) as con,
    ):
        register_inputs(con, input_sources(job, resolved, snapshot))
        create_result(con, job, client, spill_dir, input_changes(job, resolved, snapshot))
        errors = contract_errors(con, tables)
        errors += [] if errors else field_errors(con, tables)
        errors += [] if errors else shape_errors(con, job, snapshot, makers)
        if errors:
            raise ContractError("; ".join(errors))
        (rows,) = con.sql("SELECT count(*) FROM result").fetchone()
        # Each written once, under a name no manifest lists yet, so no reader sees it half done.
        files = write_parts(con, job, snapshot, makers)
        changes = write_changes(con, job, snapshot, files)
    snapshot.jobs[job.name] = {
        **job_entry(job, client, resolved),
        "files": files,
        "rows": rows,
        "changes": changes,
    }
    snapshot.add_parts(job.name, files)
    return rows


def reusable(
    job: Job, client: Mapping[str, Any], snapshot: Snapshot, reads: Mapping[str, list[str]]
) -> dict[str, Any] | None:
    """The base snapshot's entry for the job, if running it again would write the same parts:
    the base was verified, and ran it with the same version and parameters on exactly the files
    this snapshot has for each input. None otherwise."""
    base = snapshot.base
    if base is None or base.verified is not True:
        return None
    entry = base.jobs.get(job.name)
    if entry is None or base.status.get(job.name, "built") not in READY:
        return None
    try:
        now = job_entry(job, client, resolve_inputs(job, reads, snapshot))
    except ValueError:
        return None
    if any(entry.get(key) != now[key] for key in REUSE_KEYS):
        return None
    return entry


def reuse_job(job: Job, entry: Mapping[str, Any], snapshot: Snapshot) -> None:
    """List the base's parts in this snapshot, with an empty change file: nothing changed."""
    assert snapshot.base is not None
    key = snapshot.changes_key(job.name)
    out = snapshot.url(key)
    snapshots.make_parent(out)
    with snapshot.connect() as con:
        con.execute(f"CREATE TABLE changes ({CHANGES_SCHEMA})")
        con.execute(f"COPY changes TO {sql_string(out)} (FORMAT parquet, COMPRESSION zstd)")
    snapshot.jobs[job.name] = {
        **entry,
        # The snapshot that wrote the parts, which a chain of reuses carries along unchanged.
        "built_in": entry.get("built_in", snapshot.base.id),
        "changes": {"file": key, "base": snapshot.base.id, **dict.fromkeys(CHANGE_KINDS, 0)},
    }
    snapshot.add_parts(job.name, entry["files"])


def run_jobs(
    jobs: list[Job], client: Mapping[str, Any], snapshot: Snapshot, reuse: bool = False
) -> dict[str, str]:
    """Run every job in dependency order. With `reuse`, a job whose parts would come out the same
    as the base snapshot's isn't run (see `reusable`). Returns each job's status: built, reused,
    failed or skipped."""
    statuses = snapshot.status
    needs = dependencies(jobs)
    reads = plan(jobs)
    makers = entity_types(jobs)
    for job in build_order(jobs):
        blocked = [t for t in needs[job.name] if statuses.get(t, "built") not in READY]
        if blocked:
            statuses[job.name] = "skipped"
            print(f"{job.name}: skipped, {', '.join(blocked)} did not build", file=sys.stderr)
            continue
        entry = reusable(job, client, snapshot, reads[job.name]) if reuse else None
        if entry is not None:
            reuse_job(job, entry, snapshot)
            statuses[job.name] = "reused"
            built_in = snapshot.jobs[job.name]["built_in"]
            print(f"{job.name}: {entry['rows']} rows (unchanged, built in {built_in})")
            continue
        try:
            rows = run_job(job, client, snapshot, reads[job.name], makers)
            statuses[job.name] = "built"
            changes = describe_changes(snapshot.jobs[job.name]["changes"])
            print(f"{job.name}: {rows} rows ({changes})")
        except (duckdb.Error, ContractError, ContainerError) as error:
            statuses[job.name] = "failed"
            print(f"{job.name}: failed: {error}", file=sys.stderr)
    return statuses


def build_snapshot(
    jobs: list[Job],
    client: Mapping[str, Any],
    snapshot: Snapshot,
    verify: bool = True,
    reuse: bool = True,
) -> bool:
    """Run and verify every job, then save the manifest. True if every job ran or was reused and
    every job that ran verified: the snapshot can be published."""
    statuses = run_jobs(jobs, client, snapshot, reuse)
    ok = all(status in READY for status in statuses.values())
    if verify:
        # Imported here because verify.py imports this module.
        from verify import verify_jobs

        # A reused job was verified in the snapshot that ran it, on the same files.
        built = [job for job in build_order(jobs) if statuses[job.name] == "built"]
        snapshot.verified = verify_jobs(built, client, snapshot)
        ok &= snapshot.verified
    print(f"manifest_url={snapshots.save(snapshot)}")
    return ok


def publish(snapshot: Snapshot) -> None:
    newer = snapshots.publish(snapshot)
    if newer:
        # Not a failure: this build is good, and newer data is already live.
        print(f"snapshot {snapshot.id} not published: {newer} is newer", file=sys.stderr)
    else:
        print(f"published snapshot {snapshot.id}")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--client", required=True, type=Path, help="Client config TOML")
    parser.add_argument("--bucket-url", required=True, help="file://, s3:// or az:// base URL")
    parser.add_argument("--run-id", required=True, help="The extract run whose raw files to read")
    parser.add_argument("--snapshot-id", help="Defaults to the current UTC time")
    parser.add_argument(
        "--job-dir",
        action="append",
        type=Path,
        default=[],
        help="Another folder of jobs, read after the client's; its jobs replace theirs by name",
    )
    parser.add_argument("--no-verify", action="store_true", help="Skip the lineage check")
    parser.add_argument("--no-publish", action="store_true", help="Don't move latest.json")
    parser.add_argument(
        "--rebuild",
        action="store_true",
        help="Build every table, even one the published snapshot already has as it would come out",
    )
    args = parser.parse_args()

    client = tomllib.loads(args.client.read_text())
    jobs = load_jobs(job_dirs(client, args.job_dir))
    snapshot_id = args.snapshot_id or snapshots.new_snapshot_id(datetime.now(UTC))
    run = snapshots.load_run(args.bucket_url, args.run_id)
    base = snapshots.published(args.bucket_url, os.environ)
    snapshot = snapshots.start(args.bucket_url, run.chain, snapshot_id, os.environ, base)
    print(f"run {run.id} ({run.kind}) reads runs {', '.join(run.chain)}")
    if not build_snapshot(jobs, client, snapshot, not args.no_verify, not args.rebuild):
        print(f"snapshot {snapshot.id} not published", file=sys.stderr)
        sys.exit(1)
    if not args.no_publish:
        publish(snapshot)


if __name__ == "__main__":
    main()
