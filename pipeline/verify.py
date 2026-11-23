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

  A change can rename the row as well as change it, when its `_row_id` comes from the changed
  column, as a grouping key's does. The row is then looked for under its new id: the one new row
  with the same `_sources`. Only when there's none, or no single one, has it gone, as a filter or
  a join drops it.

A row cites entities, never metadata rows, so a replay reads the metadata of each entity it
cites, and changes it one key at a time, as if each key were a column of the entity: a value that
changes with it must name `entities.<key>`.

A job's output is checked as what it became: an entity's name and created_at, and each metadata
value as the text and value type it was written with. The replay goes through the same
conversion (`runner.metadata_select`), so a row reads as the entity it wrote.

It's a test, not a proof. A change the query absorbs, such as a value that isn't the largest in
a `max()`, hides that dependency.
"""

import argparse
import hashlib
import json
import os
import math
import sys
import tempfile
import time
import tomllib
from collections import OrderedDict
from collections.abc import Callable, Mapping
from dataclasses import dataclass
from datetime import date, datetime, timedelta, timezone
from decimal import Decimal
from pathlib import Path
from typing import Any

import duckdb
import pyarrow as pa
import pyarrow.compute as pc

import registry
import snapshot as snapshots
from runner import (
    CONTRACT_COLUMNS,
    ENTITIES,
    ENTITY_COLUMNS,
    METADATA,
    EXTRA_METADATA,
    RAW_ROW_ID,
    Job,
    Ref,
    build_order,
    connect,
    create_result,
    input_sources,
    is_raw,
    job_dirs,
    load_jobs,
    metadata_select,
    parse_ref,
    sql_string,
)
from snapshot import Snapshot

KINDS = ("shift", "replace", "null")
# Identity columns join rows to their sources; changing them tests the join, not the lineage.
UNPERTURBED = {*CONTRACT_COLUMNS, RAW_ROW_ID}
# The columns of a metadata row that are its value, changed together for `entities.<key>`.
METADATA_VALUE = ("value", "value_type")
# A metadata row's copies of its entity's columns, and the column of `entities` each answers to.
METADATA_ALIASES = {"entity_type": "type", "created_at": "created_at", "updated_at": "created_at"}
# The most JSON subtrees one narrowing tries before reporting what it has.
NARROW_LIMIT = 400
# What a null JSON leaf becomes. Shaped like a date, so it changes a field read as text and one
# cast to a timestamp alike.
JSON_SEED = "2000-01-01T00:00:00.000+0000"
# How many container outputs a replay keeps, keyed by its inputs.
CONTAINER_CACHE_SIZE = 256

Row = dict[str, Any]
Selector = Callable[[str], bool]
# Which rows of an input a perturbation changes; None for all of them.
Mask = list[bool] | None


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


def with_column(table: pa.Table, name: str, values: list[Any], only: Mask = None) -> pa.Table:
    """`table` with column `name` replaced by `values`, in the rows `only` picks."""
    index = table.schema.get_field_index(name)
    field = table.schema.field(index)
    if only is not None:
        original = table[name].to_pylist()
        values = [new if pick else old for new, old, pick in zip(values, original, only)]
    return table.set_column(index, field, pa.array(values, type=field.type))


def matching(rows: pa.Table, ref: Ref) -> list[bool]:
    """Which rows a reference reads: all of them, or those its filter matches."""
    if ref.where is None:
        return [True] * rows.num_rows
    column, value = ref.where
    return [v == value for v in rows[column].to_pylist()]


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


def outputs(row: Row) -> set[str]:
    return {column for column in row if column not in CONTRACT_COLUMNS}


def row_differences(actual: Row | None, expected: Row) -> list[str]:
    """How a replayed row differs from the stored one: its values (a value the stored row lacks
    is null), its `_sources`, and the references of each value the stored row has."""
    if actual is None:
        return ["the row is missing"]
    differences = sorted(
        column
        for column in outputs(actual) | outputs(expected)
        if not same(actual.get(column), expected.get(column))
    )
    if source_set(actual) != source_set(expected):
        differences.append("_sources")
    stored_fields, fields = expected["_fields"], actual["_fields"]
    extra = fields.get(EXTRA_METADATA) or []
    if any(sorted(refs) != sorted(fields.get(column, extra)) for column, refs in stored_fields.items()):
        differences.append("_fields")
    return differences


def as_views(con: duckdb.DuckDBPyConnection, job: Job, table: str) -> list[Row]:
    """Each row of a job's output as the entity values it becomes: name and created_at for a type
    it makes, and each metadata value as (value type, text), under its key. `_fields` is the
    row's own: a `_metadata` key reads what that column does. Rows are numbered first, since
    a change can leave two of them with one `_row_id`, or none."""
    con.execute(
        f"CREATE OR REPLACE TEMP TABLE view_rows AS SELECT row_number() OVER () AS _n, * FROM {table}"
    )
    entity = ", name, created_at" if job.entity_type else ""
    cursor = con.execute(f"SELECT _n, _row_id, _sources, _fields{entity} FROM view_rows ORDER BY _n")
    names = [d[0] for d in cursor.description]
    rows: dict[int, Row] = {}
    for values in cursor.fetchall():
        row = dict(zip(names[1:], values[1:]))
        row["_fields"] = dict(row["_fields"] or {})
        rows[values[0]] = row
    con.execute(
        "CREATE OR REPLACE TEMP TABLE view_numbered AS "
        "SELECT * EXCLUDE (_n) REPLACE (_n AS _row_id) FROM view_rows"
    )
    extra = con.execute(
        f'SELECT entity_id, "key", value_type, value FROM ({metadata_select(con, job, "view_numbered")})'
    ).fetchall()
    for n, key, value_type, value in extra:
        rows[n][key] = (value_type, value)
    return list(rows.values())


# ── Running a job on chosen inputs ────────────────────────────────────────────


def fingerprint(data: pa.Table | str) -> str:
    """Identifies an input's contents: a hash of the rows, or the expression that reads them."""
    if isinstance(data, str):
        return data
    sink = pa.BufferOutputStream()
    with pa.ipc.new_stream(sink, data.schema) as writer:
        writer.write_table(data)
    return hashlib.sha256(sink.getvalue().to_pybytes()).hexdigest()


class Replay:
    """One job, run against inputs swapped in one table at a time.

    A SQL job's query runs for the one row. A container job runs in full, and its output is
    kept by its inputs' contents: perturbing a column that is null in every row, say, leaves
    the inputs as they were, and doesn't start the container again."""

    def __init__(self, job: Job, client: Mapping[str, Any], spill_dir: str, snapshot: Snapshot):
        self.job = job
        self.client = client
        self.spill_dir = spill_dir
        self.con = connect(client, spill_dir, snapshot)
        self.con.execute("SET TimeZone = 'UTC'")
        if any(is_raw(t) for t in job.inputs):
            self.con.execute("CREATE SCHEMA raw")
        self.loaded: dict[str, pa.Table | str] = {}
        self.outputs: OrderedDict[tuple[tuple[str, str], ...], list[Row]] = OrderedDict()
        self.container_runs = 0

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

    def rows(self) -> list[Row]:
        """Every row the job writes for the loaded inputs, as entity values (`as_views`). A
        change can give two rows one `_row_id`, so they aren't keyed by it."""
        if self.job.kind == "container":
            return self.container_rows()
        self.con.execute(f"CREATE OR REPLACE TEMP TABLE replay_out AS SELECT * FROM (\n{self.job.sql}\n)")
        return as_views(self.con, self.job, "replay_out")

    def row(self, row_id: int) -> Row | None:
        if self.job.kind == "container":
            return next((r for r in self.container_rows() if r["_row_id"] == row_id), None)
        self.con.execute(
            "CREATE OR REPLACE TEMP TABLE replay_out AS "
            f"SELECT * FROM (\n{self.job.sql}\n) WHERE _row_id = {int(row_id)}"
        )
        views = as_views(self.con, self.job, "replay_out")
        return views[0] if len(views) == 1 else None

    def container_rows(self) -> list[Row]:
        """Every row the container writes for the loaded inputs."""
        key = tuple(sorted((table, fingerprint(data)) for table, data in self.loaded.items()))
        if key in self.outputs:
            self.outputs.move_to_end(key)
            return self.outputs[key]
        create_result(self.con, self.job, self.client, self.spill_dir, table="replay_result")
        self.container_runs += 1
        rows = as_views(self.con, self.job, "replay_result")
        self.outputs[key] = rows
        if len(self.outputs) > CONTAINER_CACHE_SIZE:
            self.outputs.popitem(last=False)
        return rows

    def row_with(
        self, row_id: int, table: str, data: pa.Table, renamed: Callable[[], Row | None]
    ) -> tuple[Row | None, bool]:
        """The row with one input swapped for `data`, leaving the other inputs as they were, and
        whether it lost its `_row_id`. `renamed` finds it, with `data` still loaded, when it did."""
        previous = self.loaded[table]
        self.load(table, data)
        try:
            row = self.row(row_id)
            return (row, False) if row is not None else (renamed(), True)
        finally:
            self.load(table, previous)

    def close(self) -> None:
        self.con.close()


def id_column(table: str) -> str:
    return RAW_ROW_ID if is_raw(table) else "_row_id"


def row_key(table: str) -> str:
    """The column that ties an input's rows to the `_sources` that cite them. A row cites an
    entity, never its metadata rows, so it reads all of that entity's metadata."""
    return "entity_id" if table == METADATA else id_column(table)


def load_sources(snapshot: Snapshot, table: str, source: str, row_ids: set[str]) -> pa.Table:
    """The rows of one input, as the job's query reads it, that the given ids cite."""
    with snapshot.connect() as con:
        return con.execute(
            f"SELECT * FROM ({source}) "
            f"WHERE cast({row_key(table)} AS VARCHAR) IN (SELECT unnest(?))",
            [sorted(row_ids)],
        ).to_arrow_table()


def only_rows(table: pa.Table, id_name: str, row_ids: set[str]) -> pa.Table:
    ids = pc.cast(table[id_name], pa.string())
    return table.filter(pc.is_in(ids, value_set=pa.array(sorted(row_ids), pa.string())))


# ── Checking one row ──────────────────────────────────────────────────────────


class RowCheck:
    def __init__(
        self,
        replay: Replay,
        stored: Row,
        inputs: dict[str, pa.Table],
        sources: Mapping[str, str],
    ):
        self.replay = replay
        self.stored = stored
        self.row_id = stored["_row_id"]
        self.inputs = inputs
        # Each input in full, as the job read it.
        self.sources = sources
        self.outputs: list[str] = []
        self.baseline: Row = {}
        # The ids of every row the replay writes before any change, to tell a renamed row apart.
        self.baseline_ids: set[Any] = set()
        # What this row says each of its values is computed from: the replay's own `_fields`,
        # once it reproduced the stored row, since a null value stored nothing to read them from.
        self.refs: dict[str, list[str]] = {}

    def run(self) -> list[Finding]:
        for table, rows in self.inputs.items():
            self.replay.load(table, rows)
        baseline = self.replay.row(self.row_id)
        differences = row_differences(baseline, self.stored)
        if differences or baseline is None:
            return [Finding("error", "replay", None, self.replay_failure(differences))]
        self.baseline = baseline
        self.baseline_ids = {row["_row_id"] for row in self.replay.rows()}
        self.refs = dict(baseline["_fields"])
        self.outputs = sorted(outputs(baseline) | outputs(self.stored))
        return self.perturb()

    def refs_of(self, output: str) -> list[str]:
        """The references of one output column."""
        return self.refs.get(output, [])

    def replay_failure(self, differences: list[str]) -> str:
        detail = f"not reproduced from its _sources ({', '.join(differences)})"
        culprits = []
        for table in sorted(self.inputs):
            self.replay.load(table, f"({self.sources[table]})")
            if not row_differences(self.replay.row(self.row_id), self.stored):
                culprits.append(table)
            self.replay.load(table, self.inputs[table])
        # A row cites an entity to read its metadata, so missing metadata is a missing entity.
        culprits = [f"{t} (the metadata of entities it doesn't cite)" if t == METADATA else t
                    for t in culprits]  # fmt: skip
        if culprits:
            return f"{detail}; reproduced with all of {' or '.join(culprits)}, so it reads rows it doesn't list"
        return f"{detail}; no single input table in full reproduces it"

    def changed(self, table: str, perturbed: Callable[[str], pa.Table]) -> tuple[set[str], bool]:
        """The output columns that change, over every kind, and whether the row ever lost its id.

        A row that loses its id depends on the input for its identity, or for its existence when
        it's gone altogether, as a filter or join drops it. One that was renamed still has values
        to compare."""
        changed: set[str] = set()
        vanished = False
        for kind in KINDS:
            row, lost_id = self.replay.row_with(self.row_id, table, perturbed(kind), self.renamed)
            vanished |= lost_id
            if row is not None:
                compared = set(self.outputs) | outputs(row)
                changed |= {o for o in compared if not same(row.get(o), self.baseline.get(o))}
        # A key the query names at run time is one of `_metadata`'s, whatever the change made it.
        return {o if o in self.refs else EXTRA_METADATA for o in changed}, vanished

    def renamed(self) -> Row | None:
        """The row under a new `_row_id`: the one new row built from the same input rows, and
        failing that, the one of those that also reads the same columns. None when it's gone."""
        sources = source_set(self.baseline)
        candidates = [
            row
            for row in self.replay.rows()
            if row["_row_id"] not in self.baseline_ids and source_set(row) == sources
        ]
        if len(candidates) > 1:
            candidates = [r for r in candidates if same(r["_fields"], self.baseline["_fields"])]
        return candidates[0] if len(candidates) == 1 else None

    def json_changed(
        self,
        table: str,
        column: str,
        documents: list[Any],
        selected: Selector,
        grow: str | None = None,
        only: Mask = None,
    ) -> tuple[set[str], bool]:
        def perturbed(kind: str) -> pa.Table:
            values = [
                None if d is None else json.dumps(perturb_json(d, kind, selected, grow=grow))
                for d in documents
            ]
            return with_column(self.inputs[table], column, values, only)

        return self.changed(table, perturbed)

    def declared(self, output: str, table: str, column: str) -> tuple[Mask, list[str], list[str]]:
        """What `output` declares of table.column: the rows not declared in full (None when
        none is, all of them when no reference names the column in full), the JSON paths it
        declares, and the filters that declare some rows in full."""
        rows = self.inputs[table]
        undeclared = [True] * rows.num_rows
        paths, filters = [], []
        for ref in map(parse_ref, self.refs_of(output)):
            if ref.table != table:
                continue
            if ref.is_identity or (ref.column == column and ref.path is None):
                if ref.where is None:
                    return None, [], []
                filters.append(f"{table}[{ref.where[0]}={ref.where[1]}]")
                undeclared = [u and not m for u, m in zip(undeclared, matching(rows, ref))]
            elif ref.column == column and ref.path is not None:
                paths.append(ref.path)
        return (undeclared if any(undeclared) else None), paths, filters

    def narrow(
        self,
        table: str,
        column: str,
        documents: list[Any],
        output: str,
        keep: list[str],
        only: Mask = None,
    ):
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
                if output in self.json_changed(table, column, documents, selector, only=only)[0]:
                    hits.extend(search(child) or [child])
            return hits

        return search("$")

    def perturb(self) -> list[Finding]:
        findings: list[Finding] = []
        effects: dict[tuple[str, str], tuple[set[str], bool]] = {}
        for table, rows in sorted(self.inputs.items()):
            if rows.num_rows == 0:
                continue
            if table == METADATA:
                findings += self.perturb_metadata(effects)
                continue
            for column in rows.column_names:
                if column in UNPERTURBED:
                    continue
                documents = json_documents(rows[column])
                if documents is not None:
                    effect = self.json_changed(table, column, documents, lambda _: True)
                else:
                    effect = self.scalar_changed(table, column)
                effects[(table, column)] = effect
                for output in sorted(effect[0]):
                    findings.extend(self.undeclared(output, table, column, documents))
        return findings + self.unused(effects)

    # ── Metadata values ──────────────────────────────────────────────────────
    # A job cites the entity and names its metadata value as `entities.<key>`, so each key of
    # the metadata it read is changed on its own, value and value type together, as if it were a
    # column of the entity. A metadata row's copies of its entity's columns answer to those
    # columns. What ties a value to its entity (entity_id, key, the row's own id) isn't changed.

    def metadata_mask(self, key: str | None, entity_ids: set[str] | None = None) -> list[bool]:
        """The metadata rows of the given entities (all of them by default) that hold `key`, or
        any key when it's None."""
        rows = self.inputs[METADATA]
        keys = rows["key"].to_pylist()
        owners = [str(e) for e in rows["entity_id"].to_pylist()]
        return [
            (key is None or k == key) and (entity_ids is None or e in entity_ids)
            for k, e in zip(keys, owners)
        ]

    def metadata_changed(
        self, key: str | None, columns: tuple[str, ...], entity_ids: set[str] | None = None
    ) -> tuple[set[str], bool]:
        mask = self.metadata_mask(key, entity_ids)
        changed: set[str] = set()
        vanished = False
        for column in columns:
            if column in self.inputs[METADATA].column_names:
                effect = self.scalar_changed(METADATA, column, mask)
                changed |= effect[0]
                vanished |= effect[1]
        return changed, vanished

    def matched_entities(self, ref: Ref) -> set[str]:
        """The entities a reference to `entities` reads: those its filter matches."""
        rows = self.inputs.get(ENTITIES)
        if rows is None:
            return set()
        ids = [str(i) for i in rows["_row_id"].to_pylist()]
        return {i for i, m in zip(ids, matching(rows, ref)) if m}

    def is_metadata_ref(self, ref: Ref) -> bool:
        entities = self.inputs.get(ENTITIES)
        columns = entities.column_names if entities is not None else []
        return ref.table == ENTITIES and ref.column not in columns and not ref.is_identity

    def perturb_metadata(self, effects: dict) -> list[Finding]:
        findings = []
        # (name it answers to, key it holds or None for any, metadata columns changed)
        targets = [
            (key, key, METADATA_VALUE)
            for key in sorted({k for k in self.inputs[METADATA]["key"].to_pylist() if k})
        ] + [(alias, None, (column,)) for column, alias in METADATA_ALIASES.items()]
        for name, key, columns in targets:
            changed, vanished = self.metadata_changed(key, columns)
            before = effects.get((ENTITIES, name), (set(), False))
            effects[(ENTITIES, name)] = (before[0] | changed, before[1] or vanished)
            for output in sorted(changed):
                findings.extend(self.undeclared_metadata(output, name, key, columns))
        return findings

    def undeclared_metadata(
        self, output: str, name: str, key: str | None, columns: tuple[str, ...]
    ) -> list[Finding]:
        """A finding if `output` changes with metadata of an entity it doesn't declare reading
        `entities.<name>` of."""
        mask = self.metadata_mask(key)
        owners = {str(e) for e, m in zip(self.inputs[METADATA]["entity_id"].to_pylist(), mask) if m}
        filters = []
        for ref in map(parse_ref, self.refs_of(output)):
            if ref.table != ENTITIES or ref.column != name:
                continue
            if ref.where is None:
                return []
            filters.append(f"{ENTITIES}[{ref.where[0]}={ref.where[1]}]")
            owners -= self.matched_entities(ref)
        if not owners:
            return []
        if filters and output not in self.metadata_changed(key, columns, owners)[0]:
            return []
        outside = f" outside {', '.join(filters)}" if filters else ""
        return [Finding("error", "undeclared", output, f"changes with {ENTITIES}.{name}{outside}")]

    def undeclared(
        self, output: str, table: str, column: str, documents: list[Any] | None
    ) -> list[Finding]:
        only, paths, filters = self.declared(output, table, column)
        if only is None:
            return []
        # The change seen was to every row; a filter declares some of them, so try the rest.
        outside = f" outside {', '.join(filters)}" if filters else ""
        if documents is None:
            if filters and output not in self.scalar_changed(table, column, only)[0]:
                return []
            detail = f"changes with {table}.{column}{outside}"
            return [Finding("error", "undeclared", output, detail)]
        if filters and output not in self.json_changed(
            table, column, documents, lambda _: True, only=only
        )[0]:
            return []
        if paths:
            rest = self.json_changed(
                table, column, documents, lambda p: not any(within(p, k) for k in paths), only=only
            )
            if output not in rest[0]:
                return []
        found = self.narrow(table, column, documents, output, paths, only)
        refs = [f"{table}.{column}:{p}" for p in found] or [f"{table}.{column}"]
        return [Finding("error", "undeclared", output, f"changes with {r}{outside}") for r in refs]

    def scalar_changed(self, table: str, column: str, only: Mask = None) -> tuple[set[str], bool]:
        rows = self.inputs[table]
        values = rows[column].to_pylist()
        type_ = rows.schema.field(column).type
        return self.changed(
            table,
            lambda kind: with_column(
                rows, column, [perturb_value(x, type_, kind) for x in values], only
            ),
        )

    def unused(self, effects: Mapping[tuple[str, str], tuple[set[str], bool]]) -> list[Finding]:
        findings = []
        for output, refs in sorted(self.refs.items()):
            for text in refs:
                ref = parse_ref(text)
                table, column, path = ref.table, ref.column, ref.path
                if ref.is_identity or (table, column) not in effects:
                    continue
                changed, vanished = effects[(table, column)]
                if self.is_metadata_ref(ref) and ref.where is not None:
                    entity_ids = self.matched_entities(ref)
                    if not any(self.metadata_mask(column, entity_ids)):
                        continue
                    changed, vanished = self.metadata_changed(column, METADATA_VALUE, entity_ids)
                elif ref.where is not None:
                    only = matching(self.inputs[table], ref)
                    if not any(only):
                        # This row has no source the filter matches; other rows may.
                        continue
                    documents = json_documents(self.inputs[table][column])
                    if documents is None:
                        changed, vanished = self.scalar_changed(table, column, only)
                    else:
                        changed, vanished = self.json_changed(
                            table, column, documents, lambda _: True, only=only
                        )
                if path is not None:
                    documents = json_documents(self.inputs[table][column])
                    if documents is None:
                        continue
                    changed, vanished = self.json_changed(
                        table, column, documents, lambda p, prefix=path: within(p, prefix), path
                    )
                if not vanished and output not in changed:
                    detail = f"never changed by {text}"
                    findings.append(Finding("warning", "unused", output, detail))
        return findings


# ── Checking a job ────────────────────────────────────────────────────────────


def part_source(snapshot: Snapshot, job: Job, table: str) -> str | None:
    key = snapshot.part(job.name, table)
    return snapshots.read_parquet([snapshot.url(key)]) if key else None


def sample_ids(snapshot: Snapshot, job: Job, per_branch: int) -> list[Any]:
    """A few entities for each distinct `_fields` of each metadata key, and of the entities the
    job made, picked by a hash of the entity id so runs agree and branches share rows. Values that
    read different columns took different branches of the query, so each branch gets checked."""
    branches = [
        f"SELECT entity_id, \"key\" || cast(_fields AS VARCHAR) AS branch "
        f"FROM {part_source(snapshot, job, 'entity_metadata')}"
    ]
    made = part_source(snapshot, job, "entities")
    if made:
        branches.append(f"SELECT _row_id, cast(_fields AS VARCHAR) FROM {made}")
    with snapshot.connect() as con:
        ids = con.execute(f"""
            SELECT DISTINCT entity_id FROM (
              SELECT entity_id, row_number() OVER (
                PARTITION BY md5(branch) ORDER BY md5(cast(entity_id AS VARCHAR))
              ) AS _rank
              FROM ({' UNION ALL '.join(branches)})
            )
            WHERE _rank <= {int(per_branch)}
            ORDER BY entity_id
        """).fetchall()
    return [entity_id for (entity_id,) in ids]


def stored_rows(snapshot: Snapshot, job: Job, ids: list[Any]) -> list[Row]:
    """The entities' values as the job's parts store them, shaped like `as_views`."""
    rows: dict[Any, Row] = {}
    with snapshot.connect() as con:
        con.execute("SET TimeZone = 'UTC'")
        made = part_source(snapshot, job, "entities")
        if made:
            cursor = con.execute(
                f"SELECT _row_id, _sources, _fields, name, created_at FROM {made} "
                "WHERE _row_id IN (SELECT unnest(?))",
                [ids],
            )
            for row_id, sources, fields, name, created_at in cursor.fetchall():
                fields = dict(fields)
                rows[row_id] = {
                    "_row_id": row_id,
                    "_sources": sources,
                    "_fields": {c: fields[c] for c in ENTITY_COLUMNS},
                    "name": name,
                    "created_at": created_at,
                }
        cursor = con.execute(
            f'SELECT entity_id, _sources, _fields, "key", value_type, value '
            f"FROM {part_source(snapshot, job, 'entity_metadata')} "
            "WHERE entity_id IN (SELECT unnest(?))",
            [ids],
        )
        for entity_id, sources, fields, key, value_type, value in cursor.fetchall():
            row = rows.setdefault(
                entity_id, {"_row_id": entity_id, "_sources": sources, "_fields": {}}
            )
            row[key] = (value_type, value)
            row["_fields"][key] = dict(fields)["value"]
    return [rows[row_id] for row_id in ids if row_id in rows]


def verify_job(
    job: Job, client: Mapping[str, Any], snapshot: Snapshot, per_branch: int
) -> tuple[int, dict[Finding, list[int]]]:
    """Check a sample of one job's entities. Returns how many it checked and what it found, with
    the entities each finding came from."""
    rows = stored_rows(snapshot, job, sample_ids(snapshot, job, per_branch))
    sources = input_sources(job, snapshot.jobs[job.name]["read"], snapshot)
    wanted: dict[str, set[str]] = {table: set() for table in sources}
    for row in rows:
        for table, row_id in source_set(row):
            wanted.setdefault(table, set()).add(row_id)
    if METADATA in wanted:
        wanted[METADATA] = set(wanted.get(ENTITIES, set()))
    loaded = {
        table: load_sources(snapshot, table, sources[table], ids) for table, ids in wanted.items()
    }

    found: dict[Finding, list[int]] = {}
    with tempfile.TemporaryDirectory(prefix="waymark-verify-") as spill_dir:
        replay = Replay(job, client, spill_dir, snapshot)
        try:
            for row in rows:
                ids = source_set(row)
                cited = {t: {i for s, i in ids if s == t} for t in loaded}
                if METADATA in cited:
                    cited[METADATA] = cited.get(ENTITIES, set())
                inputs = {
                    table: only_rows(data, row_key(table), cited[table])
                    for table, data in loaded.items()
                }
                for finding in RowCheck(replay, row, inputs, sources).run():
                    found.setdefault(finding, []).append(row["_row_id"])
        finally:
            replay.close()
    return len(rows), found


def report(job: Job, checked: int, found: dict[Finding, list[int]], seconds: float) -> None:
    errors = sum(1 for f in found if f.level == "error")
    status = f"{errors} errors" if errors else "ok"
    print(f"{job.name}: {checked} entities checked in {seconds:.1f}s, {status}")
    for finding, row_ids in sorted(found.items(), key=lambda item: (item[0].level, item[0].check)):
        where = f"{finding.column}: " if finding.column else ""
        rows = f"{len(row_ids)} rows, e.g. _row_id {row_ids[0]}"
        print(f"  {finding.level:<7} {finding.check:<10} {where}{finding.detail}  ({rows})")


def version_mismatch(job: Job, snapshot: Snapshot) -> str | None:
    """Why the job's current files can't check this snapshot's table, or None if they can."""
    entry = snapshot.jobs.get(job.name)
    if entry is None:
        return f"snapshot {snapshot.id} has nothing from {job.name}"
    built_with = entry.get("job")
    if built_with != job.version:
        return (
            f"its files changed since snapshot {snapshot.id} was built "
            f"(built with {built_with or 'unknown'}, now {job.version}); "
            f"check out the job as it was to verify this snapshot"
        )
    return None


def verify_jobs(
    jobs: list[Job], client: Mapping[str, Any], snapshot: Snapshot, per_branch: int = 2
) -> bool:
    """Check each job and print what it finds. True if no job has an error.

    A replay runs the job's current code, so a job whose files changed since the snapshot was built
    isn't checked: new SQL against old output would fail for reasons that aren't the snapshot's.
    That counts as an error."""
    passed = True
    for job in jobs:
        mismatch = version_mismatch(job, snapshot)
        if mismatch:
            print(f"{job.name}: not checked, {mismatch}")
            passed = False
            continue
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
    parser.add_argument(
        "--job-dir",
        action="append",
        type=Path,
        default=[],
        help="Another folder of jobs, as the snapshot was built with (runner.py --job-dir)",
    )
    parser.add_argument(
        "--registry",
        action="store_true",
        help="Check each table with the job version that built it, from the bucket's job registry",
    )
    parser.add_argument("--shared-url", help="With --registry, the shared registry's root too")
    parser.add_argument("--rows-per-branch", type=int, default=2)
    args = parser.parse_args()

    client = tomllib.loads(args.client.read_text())
    snapshot = snapshots.load(args.bucket_url, args.snapshot_id, os.environ)
    with registry.Registries(registry.registry_roots(args.bucket_url, args.shared_url)) as found:
        if args.registry:
            jobs = build_order(built_jobs(snapshot, found))
        else:
            jobs = build_order(load_jobs(job_dirs(client, args.job_dir)))
        if args.job:
            jobs = [job for job in jobs if job.name in args.job]
        if not verify_jobs(jobs, client, snapshot, args.rows_per_branch):
            sys.exit(1)


def built_jobs(snapshot: Snapshot, found: registry.Registries) -> list[Job]:
    """The job version that wrote each of the snapshot's parts, from the registries."""
    return [found.job(name, entry["job"]) for name, entry in snapshot.jobs.items()]


if __name__ == "__main__":
    main()
