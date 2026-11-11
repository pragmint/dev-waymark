"""Check that a run's tables keep the lineage they declare, by re-running each job on small inputs.

For a sample of each table's rows, a few per distinct `_fields`:

- **replay**: re-run the job on only the input rows in the row's `_sources`. It must reproduce the
  row. If it doesn't, the row depends on input rows it doesn't list, and the check names the input
  table that, given in full, does reproduce it.
- **perturb**: change one input column of those rows at a time, three ways, and re-run. An output
  column that changes must name that input column in the row's `_fields`. For a JSON column
  everything except the declared paths changes, and any undeclared path that matters is narrowed
  down. A declared reference that no change affects is a warning: thresholds and `CASE` buckets
  can hide a real dependency, so it may be listed correctly.

It's a test, not a proof. A change the query absorbs, such as a value that isn't the largest in
a `max()`, hides that dependency.
"""

import argparse
import json
import os
import math
import sys
import tempfile
import time
import tomllib
from collections.abc import Callable, Mapping
from dataclasses import dataclass
from datetime import date, datetime, timedelta, timezone
from decimal import Decimal
from pathlib import Path
from typing import Any

import duckdb
import pyarrow as pa
import pyarrow.compute as pc

import snapshot as snapshots
from runner import (
    CLIENTS_DIR,
    CONTRACT_COLUMNS,
    JOBS_DIR,
    RAW_ROW_ID,
    Job,
    build_order,
    connect,
    is_raw,
    load_jobs,
    parse_ref,
    sql_string,
)
from snapshot import Snapshot
from trace import ROW_IDENTITY

KINDS = ("shift", "replace", "null")
# Identity columns join rows to their sources; changing them tests the join, not the lineage.
UNPERTURBED = {*CONTRACT_COLUMNS, RAW_ROW_ID}
# The most JSON subtrees one narrowing tries before reporting what it has.
NARROW_LIMIT = 400
# What a null JSON leaf becomes. Shaped like a date, so it changes a field read as text and one
# cast to a timestamp alike.
JSON_SEED = "2000-01-01T00:00:00.000+0000"

Row = dict[str, Any]
Selector = Callable[[str], bool]


@dataclass(frozen=True)
class Finding:
    level: str  # "error" or "warning"
    check: str  # "replay", "undeclared" or "unused"
    column: str | None
    detail: str


# ── Changing values ───────────────────────────────────────────────────────────


def is_text(type_: pa.DataType) -> bool:
    return pa.types.is_string(type_) or pa.types.is_large_string(type_)


def seed(type_: pa.DataType) -> Any:
    """A value for a null to become, or None for a type that has no simple one."""
    if is_text(type_):
        return "~"
    if pa.types.is_boolean(type_):
        return True
    if pa.types.is_integer(type_) or pa.types.is_floating(type_):
        return 1
    if pa.types.is_decimal(type_):
        return Decimal(1)
    if pa.types.is_timestamp(type_):
        return datetime(2000, 1, 1, tzinfo=timezone.utc if type_.tz else None)
    if pa.types.is_date(type_):
        return date(2000, 1, 1)
    return None


def perturb_value(value: Any, type_: pa.DataType, kind: str) -> Any:
    """`value` changed one way: `shift` nudges it, `replace` swaps it, `null` swaps null and not."""
    if kind == "null":
        return seed(type_) if value is None else None
    if value is None:
        return None
    if pa.types.is_map(type_):
        return [(key, perturb_value(item, type_.item_type, kind)) for key, item in value]
    if pa.types.is_struct(type_):
        return {f.name: perturb_value(value.get(f.name), f.type, kind) for f in type_}
    if pa.types.is_list(type_) or pa.types.is_large_list(type_):
        return [perturb_value(item, type_.value_type, kind) for item in value]
    if pa.types.is_boolean(type_):
        return not value
    shift = kind == "shift"
    if pa.types.is_integer(type_) or pa.types.is_decimal(type_):
        return value + (1 if shift else 1_000_003)
    if pa.types.is_floating(type_):
        return value + (1.5 if shift else 1_000_003.5)
    if pa.types.is_timestamp(type_) or pa.types.is_date(type_):
        return value + timedelta(hours=1 if shift else 96_000)
    if is_text(type_):
        return value + "~" if shift else "~perturbed~"
    return value


def within(path: str, prefix: str) -> bool:
    return path == prefix or path.startswith(prefix + ".")


def perturb_json(
    node: Any, kind: str, selected: Selector, path: str = "$", grow: str | None = None
) -> Any:
    """A JSON document with the leaves `selected` picks changed. List items share their list's path,
    because column references can't index into a list.

    With `grow`, a null on the way to that path becomes the objects that reach it, so a declared
    path that's null in this document, like `$.assignee.displayName` under a null assignee, still
    gets a value."""
    if isinstance(node, dict):
        return {k: perturb_json(v, kind, selected, f"{path}.{k}", grow) for k, v in node.items()}
    if isinstance(node, list):
        return [perturb_json(item, kind, selected, path, grow) for item in node]
    if kind == "null" and node is None and grow and grow != path and within(grow, path):
        value: Any = JSON_SEED
        for key in reversed(grow[len(path) + 1 :].split(".")):
            value = {key: value}
        return value
    if not selected(path):
        return node
    if kind == "null":
        return JSON_SEED if node is None else None
    if node is None:
        return None
    if isinstance(node, bool):
        return not node
    if isinstance(node, (int, float)):
        return node + (1 if kind == "shift" else 1_000_003)
    return node + "~" if kind == "shift" else "~perturbed~"


def json_documents(column: pa.ChunkedArray) -> list[Any] | None:
    """The column's values parsed as JSON objects or arrays, or None if it isn't a JSON column."""
    if not is_text(column.type):
        return None
    documents = []
    for text in column.to_pylist():
        if text is None:
            documents.append(None)
            continue
        try:
            document = json.loads(text)
        except ValueError:
            return None
        if not isinstance(document, (dict, list)):
            return None
        documents.append(document)
    return documents if any(d is not None for d in documents) else None


def child_paths(documents: list[Any], path: str) -> set[str]:
    """The paths one level below `path` in any of the documents."""
    nodes = [d for d in documents if d is not None]
    for key in path.split(".")[1:]:
        nodes = [n.get(key) for n in flatten(nodes) if isinstance(n, dict)]
    return {f"{path}.{key}" for n in flatten(nodes) if isinstance(n, dict) for key in n}


def flatten(nodes: list[Any]) -> list[Any]:
    flat: list[Any] = []
    for node in nodes:
        flat.extend(flatten(node) if isinstance(node, list) else [node])
    return flat


def with_column(table: pa.Table, name: str, values: list[Any]) -> pa.Table:
    index = table.schema.get_field_index(name)
    field = table.schema.field(index)
    return table.set_column(index, field, pa.array(values, type=field.type))


# ── Comparing rows ────────────────────────────────────────────────────────────


def same(a: Any, b: Any) -> bool:
    """Equal, allowing for float rounding from summing in a different order."""
    if isinstance(a, float) and isinstance(b, float):
        return math.isclose(a, b, rel_tol=1e-9, abs_tol=1e-9) or (math.isnan(a) and math.isnan(b))
    if isinstance(a, dict) and isinstance(b, dict):
        return a.keys() == b.keys() and all(same(a[k], b[k]) for k in a)
    if isinstance(a, (list, tuple)) and isinstance(b, (list, tuple)):
        return len(a) == len(b) and all(same(x, y) for x, y in zip(a, b))
    return a == b


def source_set(row: Row) -> set[tuple[str, str]]:
    return {(s["table"], s["row_id"]) for s in row["_sources"]}


def row_differences(actual: Row | None, expected: Row) -> list[str]:
    if actual is None:
        return ["the row is missing"]
    differences = [
        column
        for column in expected
        if column != "_sources" and not same(actual.get(column), expected[column])
    ]
    if source_set(actual) != source_set(expected):
        differences.append("_sources")
    return differences


# ── Running a job on chosen inputs ────────────────────────────────────────────


class Replay:
    """One job's query, run against inputs swapped in one table at a time."""

    def __init__(self, job: Job, client: Mapping[str, Any], spill_dir: str, snapshot: Snapshot):
        self.job = job
        self.con = connect(client, spill_dir, snapshot)
        self.con.execute("SET TimeZone = 'UTC'")
        if any(is_raw(t) for t in job.inputs):
            self.con.execute("CREATE SCHEMA raw")
        self.loaded: dict[str, pa.Table | str] = {}

    def load(self, table: str, data: pa.Table | str) -> None:
        """Make `table` read `data`: rows in memory, or a `read_parquet(...)` expression."""
        if self.loaded.get(table) is data:
            return
        name = "__input_" + table.replace(".", "_")
        if isinstance(data, str):
            source = data
        else:
            self.con.register(name, data)
            source = name
        self.con.execute(f"CREATE OR REPLACE VIEW {table} AS SELECT * FROM {source}")
        self.loaded[table] = data

    def row(self, row_id: int) -> Row | None:
        cursor = self.con.execute(f"SELECT * FROM (\n{self.job.sql}\n) WHERE _row_id = ?", [row_id])
        values = cursor.fetchone()
        return dict(zip([d[0] for d in cursor.description], values)) if values else None

    def row_with(self, row_id: int, table: str, data: pa.Table) -> Row | None:
        """The row with one input swapped for `data`, leaving the other inputs as they were."""
        previous = self.loaded[table]
        self.load(table, data)
        try:
            return self.row(row_id)
        finally:
            self.load(table, previous)

    def close(self) -> None:
        self.con.close()


def id_column(table: str) -> str:
    return RAW_ROW_ID if is_raw(table) else "_row_id"


def load_sources(snapshot: Snapshot, table: str, row_ids: set[str]) -> pa.Table:
    with snapshot.connect() as con:
        return con.execute(
            f"SELECT * FROM {snapshot.source(table)} "
            f"WHERE cast({id_column(table)} AS VARCHAR) IN (SELECT unnest(?))",
            [sorted(row_ids)],
        ).to_arrow_table()


def only_rows(table: pa.Table, id_name: str, row_ids: set[str]) -> pa.Table:
    ids = pc.cast(table[id_name], pa.string())
    return table.filter(pc.is_in(ids, value_set=pa.array(sorted(row_ids), pa.string())))


# ── Checking one row ──────────────────────────────────────────────────────────


class RowCheck:
    def __init__(self, replay: Replay, snapshot: Snapshot, stored: Row, inputs: dict[str, pa.Table]):
        self.replay = replay
        self.snapshot = snapshot
        self.stored = stored
        self.row_id = stored["_row_id"]
        self.inputs = inputs
        self.outputs = [c for c in stored if c not in CONTRACT_COLUMNS]
        self.baseline: Row = {}
        # What this row says each of its values is computed from.
        self.refs: dict[str, list[str]] = dict(stored.get("_fields") or {})

    def run(self) -> list[Finding]:
        for table, rows in self.inputs.items():
            self.replay.load(table, rows)
        baseline = self.replay.row(self.row_id)
        differences = row_differences(baseline, self.stored)
        if differences or baseline is None:
            return [Finding("error", "replay", None, self.replay_failure(differences))]
        self.baseline = baseline
        return self.perturb()

    def replay_failure(self, differences: list[str]) -> str:
        detail = f"not reproduced from its _sources ({', '.join(differences)})"
        culprits = []
        for table in sorted(self.inputs):
            self.replay.load(table, self.snapshot.source(table))
            if not row_differences(self.replay.row(self.row_id), self.stored):
                culprits.append(table)
            self.replay.load(table, self.inputs[table])
        if culprits:
            return f"{detail}; reproduced with all of {' or '.join(culprits)}, so it reads rows it doesn't list"
        return f"{detail}; no single input table in full reproduces it"

    def changed(self, table: str, perturbed: Callable[[str], pa.Table]) -> tuple[set[str], bool]:
        """The output columns that change, over every kind, and whether the row ever disappeared.

        A row that disappears depends on the input for its existence, as a filter or join does."""
        changed: set[str] = set()
        vanished = False
        for kind in KINDS:
            row = self.replay.row_with(self.row_id, table, perturbed(kind))
            if row is None:
                vanished = True
                continue
            changed |= {o for o in self.outputs if not same(row[o], self.baseline[o])}
        return changed, vanished

    def json_changed(
        self,
        table: str,
        column: str,
        documents: list[Any],
        selected: Selector,
        grow: str | None = None,
    ) -> tuple[set[str], bool]:
        def perturbed(kind: str) -> pa.Table:
            values = [
                None if d is None else json.dumps(perturb_json(d, kind, selected, grow=grow))
                for d in documents
            ]
            return with_column(self.inputs[table], column, values)

        return self.changed(table, perturbed)

    def declared(self, output: str, table: str, column: str) -> tuple[bool, list[str]]:
        """Whether `output` declares all of table.column, and else the JSON paths it declares."""
        whole, paths = False, []
        for ref in self.refs.get(output, []):
            ref_table, ref_column, path = parse_ref(ref)
            if ref_table != table:
                continue
            if ref_column in ROW_IDENTITY or (ref_column == column and path is None):
                whole = True
            elif ref_column == column:
                paths.append(path)
        return whole, paths

    def narrow(self, table: str, column: str, documents: list[Any], output: str, keep: list[str]):
        """The undeclared JSON paths that change `output`, as deep as they can be pinned down."""
        budget = [NARROW_LIMIT]

        def kept(path: str) -> bool:
            return any(within(path, k) for k in keep)

        def search(path: str) -> list[str]:
            hits = []
            for child in sorted(child_paths(documents, path)):
                if kept(child) or budget[0] <= 0:
                    continue
                budget[0] -= 1
                selector = lambda p, c=child: within(p, c) and not kept(p)  # noqa: E731
                if output in self.json_changed(table, column, documents, selector)[0]:
                    hits.extend(search(child) or [child])
            return hits

        return search("$")

    def perturb(self) -> list[Finding]:
        findings: list[Finding] = []
        effects: dict[tuple[str, str], tuple[set[str], bool]] = {}
        for table, rows in sorted(self.inputs.items()):
            if rows.num_rows == 0:
                continue
            for column in rows.column_names:
                if column in UNPERTURBED:
                    continue
                documents = json_documents(rows[column])
                if documents is not None:
                    effect = self.json_changed(table, column, documents, lambda _: True)
                else:
                    values = rows[column].to_pylist()
                    type_ = rows.schema.field(column).type
                    effect = self.changed(
                        table,
                        lambda kind, c=column, v=values, t=type_: with_column(
                            rows, c, [perturb_value(x, t, kind) for x in v]
                        ),
                    )
                effects[(table, column)] = effect
                for output in sorted(effect[0]):
                    findings.extend(self.undeclared(output, table, column, documents))
        return findings + self.unused(effects)

    def undeclared(
        self, output: str, table: str, column: str, documents: list[Any] | None
    ) -> list[Finding]:
        whole, paths = self.declared(output, table, column)
        if whole:
            return []
        if documents is None:
            return [Finding("error", "undeclared", output, f"changes with {table}.{column}")]
        if paths:
            rest = self.json_changed(
                table, column, documents, lambda p: not any(within(p, k) for k in paths)
            )
            if output not in rest[0]:
                return []
        found = self.narrow(table, column, documents, output, paths)
        refs = [f"{table}.{column}:{p}" for p in found] or [f"{table}.{column}"]
        return [Finding("error", "undeclared", output, f"changes with {r}") for r in refs]

    def unused(self, effects: Mapping[tuple[str, str], tuple[set[str], bool]]) -> list[Finding]:
        findings = []
        for output, refs in sorted(self.refs.items()):
            for ref in refs:
                table, column, path = parse_ref(ref)
                if column in ROW_IDENTITY or (table, column) not in effects:
                    continue
                changed, vanished = effects[(table, column)]
                if path is not None:
                    documents = json_documents(self.inputs[table][column])
                    if documents is None:
                        continue
                    changed, vanished = self.json_changed(
                        table, column, documents, lambda p, prefix=path: within(p, prefix), path
                    )
                if not vanished and output not in changed:
                    findings.append(Finding("warning", "unused", output, f"never changed by {ref}"))
        return findings


# ── Checking a job ────────────────────────────────────────────────────────────


def sample_rows(snapshot: Snapshot, job: Job, per_branch: int) -> list[Row]:
    """A few rows per distinct `_fields`, picked by a hash of `_row_id` so runs agree. Rows that
    read different columns took different branches of the query, so each branch gets checked."""
    with snapshot.connect() as con:
        con.execute("SET TimeZone = 'UTC'")
        cursor = con.execute(f"""
            SELECT * EXCLUDE (_rank) FROM (
              SELECT *, row_number() OVER (
                PARTITION BY md5(cast(_fields AS VARCHAR))
                ORDER BY md5(cast(_row_id AS VARCHAR))
              ) AS _rank
              FROM {snapshot.source(job.name)}
            )
            WHERE _rank <= {int(per_branch)}
            ORDER BY _row_id
        """)
        names = [d[0] for d in cursor.description]
        return [dict(zip(names, values)) for values in cursor.fetchall()]


def verify_job(
    job: Job, client: Mapping[str, Any], snapshot: Snapshot, per_branch: int
) -> tuple[int, dict[Finding, list[int]]]:
    """Check a sample of one job's rows. Returns how many rows it checked and what it found,
    with the rows each finding came from."""
    rows = sample_rows(snapshot, job, per_branch)
    wanted: dict[str, set[str]] = {table: set() for table in job.inputs}
    for row in rows:
        for table, row_id in source_set(row):
            wanted.setdefault(table, set()).add(row_id)
    loaded = {table: load_sources(snapshot, table, ids) for table, ids in wanted.items()}

    found: dict[Finding, list[int]] = {}
    with tempfile.TemporaryDirectory(prefix="waymark-verify-") as spill_dir:
        replay = Replay(job, client, spill_dir, snapshot)
        try:
            for row in rows:
                ids = source_set(row)
                inputs = {
                    table: only_rows(data, id_column(table), {i for t, i in ids if t == table})
                    for table, data in loaded.items()
                }
                for finding in RowCheck(replay, snapshot, row, inputs).run():
                    found.setdefault(finding, []).append(row["_row_id"])
        finally:
            replay.close()
    return len(rows), found


def report(job: Job, checked: int, found: dict[Finding, list[int]], seconds: float) -> None:
    errors = sum(1 for f in found if f.level == "error")
    status = f"{errors} errors" if errors else "ok"
    print(f"{job.name}: {checked} rows checked in {seconds:.1f}s, {status}")
    for finding, row_ids in sorted(found.items(), key=lambda item: (item[0].level, item[0].check)):
        where = f"{finding.column}: " if finding.column else ""
        rows = f"{len(row_ids)} rows, e.g. _row_id {row_ids[0]}"
        print(f"  {finding.level:<7} {finding.check:<10} {where}{finding.detail}  ({rows})")


def verify_jobs(
    jobs: list[Job], client: Mapping[str, Any], snapshot: Snapshot, per_branch: int = 2
) -> bool:
    """Check each job and print what it finds. True if no job has an error."""
    passed = True
    for job in jobs:
        started = time.monotonic()
        checked, found = verify_job(job, client, snapshot, per_branch)
        report(job, checked, found, time.monotonic() - started)
        passed &= not any(f.level == "error" for f in found)
    return passed


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--client", required=True, type=Path, help="Client config TOML")
    parser.add_argument("--bucket-url", required=True, help="file://, s3:// or az:// base URL")
    parser.add_argument("--snapshot-id", help="A snapshot runner.py saved; defaults to latest")
    parser.add_argument("--job", action="append", help="Only check this job; repeatable")
    parser.add_argument("--rows-per-branch", type=int, default=2)
    args = parser.parse_args()

    client = tomllib.loads(args.client.read_text())
    job_dirs = [JOBS_DIR, CLIENTS_DIR / client["client"] / "jobs"]
    jobs = build_order(load_jobs([d for d in job_dirs if d.is_dir()]))
    snapshot = snapshots.load(args.bucket_url, args.snapshot_id, os.environ)

    if args.job:
        jobs = [job for job in jobs if job.name in args.job]
    if not verify_jobs(jobs, client, snapshot, args.rows_per_branch):
        sys.exit(1)


if __name__ == "__main__":
    main()
