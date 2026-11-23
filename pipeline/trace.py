"""Trace a row of a snapshot's table back to the raw records it came from.

Follows `_sources` one hop at a time, as CONTRACT.md describes, and prints the rows reached at
each hop. The last hop is raw data. With --field, follows only what that one field reads: each
row reached carries the columns of it the field needs, and follows only the sources its own
`_fields` name for those columns (its table's column map, the union of every row's, only where a
row declares nothing). A filtered reference follows only its matching rows. It prints the raw
fields the value comes from.

Lineage names entities, never metadata rows: an entity needed for a metadata key, as
`entities.merged_at`, follows that one value's metadata row within the same hop. So --field on an
entity can name any of its metadata keys.
"""

import argparse
import json
import os
from collections.abc import Callable, Mapping
from dataclasses import dataclass, field as dataclass_field
from typing import Any

import duckdb

import snapshot as snapshots
from runner import (
    COLUMNS_METADATA_KEY,
    ENTITIES,
    ENTITY_TABLE_COLUMNS,
    METADATA,
    RAW_ROW_ID,
    Ref,
    is_raw,
    parse_ref,
    sql_string,
)
from snapshot import Snapshot

Hop = dict[str, set[str]]
# The column labels (`column` or `column:<json path>`) a trace needs from one row, or None for
# the whole row: every column, and so every source.
Needs = frozenset[str] | None
Frontier = dict[str, dict[str, Needs]]
# The references one column of one row reads, or None when nothing declares them.
RefsOf = Callable[[str, str, str], list[str] | None]


@dataclass
class Trace:
    """What tracing one row, or one field of it, reaches."""

    # The field's own references, one hop up; None when tracing the whole row.
    direct: list[str] | None
    # The rows reached at each hop, starting with the row itself. A row appears again at a later
    # hop only when the trace needs more of it than it already followed.
    hops: list[Hop]
    # Per table, each column label the field reads there and the rows it reads it in.
    columns: dict[str, dict[str, set[str]]] = dataclass_field(default_factory=dict)


def id_column(table: str) -> str:
    return RAW_ROW_ID if is_raw(table) else "_row_id"


def row_sources(
    con: duckdb.DuckDBPyConnection, snapshot: Snapshot, table: str, row_ids: set[str]
) -> dict[str, dict[str, set[str]]]:
    """Each row's `_sources`, grouped by source table."""
    rows = con.execute(
        f"""
        SELECT DISTINCT row_key, "table", row_id FROM (
          SELECT cast(_row_id AS VARCHAR) AS row_key, unnest(_sources, recursive := true)
          FROM {snapshot.source(table)}
          WHERE cast(_row_id AS VARCHAR) IN (SELECT unnest(?))
        )
        """,
        [sorted(row_ids)],
    ).fetchall()
    sources: dict[str, dict[str, set[str]]] = {}
    for row_key, source_table, row_id in rows:
        sources.setdefault(row_key, {}).setdefault(source_table, set()).add(row_id)
    return sources


def row_fields(
    con: duckdb.DuckDBPyConnection, snapshot: Snapshot, table: str, row_ids: set[str]
) -> dict[str, dict[str, list[str]]]:
    """Each row's own `_fields`: what each of its columns reads, in that row."""
    if not row_ids:
        return {}
    rows = con.execute(
        f"SELECT cast(_row_id AS VARCHAR), _fields FROM {snapshot.source(table)} "
        "WHERE cast(_row_id AS VARCHAR) IN (SELECT unnest(?))",
        [sorted(row_ids)],
    ).fetchall()
    return {row_id: dict(fields or {}) for row_id, fields in rows}


def filter_values(
    con: duckdb.DuckDBPyConnection, snapshot: Snapshot, wanted: Mapping[tuple[str, str], set[str]]
) -> dict[tuple[str, str], dict[str, str | None]]:
    """For each (table, column) a filtered reference tests, that column's value in each row."""
    values = {}
    for (table, column), row_ids in wanted.items():
        id_name = id_column(table)
        rows = con.execute(
            f'SELECT cast({id_name} AS VARCHAR), cast("{column}" AS VARCHAR) '
            f"FROM {snapshot.source(table)} WHERE cast({id_name} AS VARCHAR) IN (SELECT unnest(?))",
            [sorted(row_ids)],
        ).fetchall()
        values[(table, column)] = dict(rows)
    return values


def metadata_rows(
    con: duckdb.DuckDBPyConnection, snapshot: Snapshot, wanted: Mapping[str, set[str]]
) -> dict[tuple[str, str], str]:
    """The metadata row that holds each (entity id, key) asked for, where the entity has one."""
    if not wanted:
        return {}
    keys = sorted({key for keys in wanted.values() for key in keys})
    rows = con.execute(
        f"""
        SELECT cast(entity_id AS VARCHAR), "key", cast(_row_id AS VARCHAR)
        FROM {snapshot.source(METADATA)}
        WHERE cast(entity_id AS VARCHAR) IN (SELECT unnest(?)) AND "key" IN (SELECT unnest(?))
        """,
        [sorted(wanted), keys],
    ).fetchall()
    return {(entity_id, key): row_id for entity_id, key, row_id in rows if key in wanted[entity_id]}


def through_metadata(
    con: duckdb.DuckDBPyConnection, snapshot: Snapshot, frontier: Frontier
) -> Frontier:
    """`frontier` with each metadata key an entity is needed for swapped for the metadata row
    that holds it, needed for its value: lineage names the entity, and the value's own row says
    what it was built from. The swap happens within a hop, so a hop never shows a metadata row."""
    entities = frontier.get(ENTITIES, {})
    wanted = {
        row_id: {label for label in needs if label not in ENTITY_TABLE_COLUMNS}
        for row_id, needs in entities.items()
        if needs is not None
    }
    wanted = {row_id: keys for row_id, keys in wanted.items() if keys}
    if not wanted:
        return frontier
    found = metadata_rows(con, snapshot, wanted)
    swapped: Frontier = {t: dict(rows) for t, rows in frontier.items() if t != ENTITIES}
    own: dict[str, Needs] = {}
    for row_id, needs in entities.items():
        if row_id not in wanted:
            own[row_id] = needs
            continue
        assert needs is not None
        rest = needs - wanted[row_id]
        if rest:
            own[row_id] = rest
        for key in wanted[row_id]:
            # An entity without the key has no value for it, so nothing to follow.
            if (row_id, key) in found:
                swapped.setdefault(METADATA, {})[found[(row_id, key)]] = frozenset({"value"})
    if own:
        swapped[ENTITIES] = own
    return swapped


def step(
    con: duckdb.DuckDBPyConnection,
    snapshot: Snapshot,
    frontier: Frontier,
    refs_of: RefsOf,
    columns: dict[str, dict[str, set[str]]],
) -> Frontier:
    """The sources one hop up from every derived row in `frontier`, each with what it's needed for.
    Records each column label reached in `columns`."""
    reached: Frontier = {}
    frontier = through_metadata(con, snapshot, frontier)

    def add(table: str, row_id: str, needs: Needs) -> None:
        rows = reached.setdefault(table, {})
        if row_id in rows:
            before = rows[row_id]
            rows[row_id] = None if before is None or needs is None else before | needs
        else:
            rows[row_id] = needs

    for table, rows in frontier.items():
        if is_raw(table):
            continue
        sources = row_sources(con, snapshot, table, set(rows))
        fields = row_fields(con, snapshot, table, {r for r, needs in rows.items() if needs})
        # Each reference a row's needs make, with the source rows it may read.
        pending: list[tuple[Ref, set[str]]] = []
        for row_id, needs in rows.items():
            parents = sources.get(row_id, {})
            if needs is None:
                for source_table, ids in parents.items():
                    for source_id in ids:
                        add(source_table, source_id, None)
                continue
            for label in needs:
                column = label.partition(":")[0]
                refs = fields.get(row_id, {}).get(column)
                if refs is None:
                    refs = refs_of(table, row_id, column)
                if refs is None:
                    # Nothing says what this column reads, so it may read any source.
                    for source_table, ids in parents.items():
                        for source_id in ids:
                            add(source_table, source_id, None)
                    continue
                for ref in map(parse_ref, refs):
                    if parents.get(ref.table):
                        pending.append((ref, parents[ref.table]))

        wanted: dict[tuple[str, str], set[str]] = {}
        for ref, ids in pending:
            if ref.where:
                wanted.setdefault((ref.table, ref.where[0]), set()).update(ids)
        values = filter_values(con, snapshot, wanted)
        for ref, ids in pending:
            if ref.where:
                tested = values[(ref.table, ref.where[0])]
                ids = {i for i in ids if ref.matches(tested.get(i))}
            for source_id in ids:
                add(ref.table, source_id, None if ref.is_identity else frozenset({ref.label}))
                columns.setdefault(ref.table, {}).setdefault(ref.label, set()).add(source_id)
    return reached


def trace(
    snapshot: Snapshot,
    table: str,
    row_id: str,
    field: str | None = None,
    maps: Mapping[str, Mapping[str, list[str]]] | None = None,
) -> Trace | None:
    """Trace one row, or with `field` one of its values, back to raw. None if neither the row's
    `_fields` nor its table's column map declares the field.

    The same walk as `traceFieldToRaw` in Waymark's src/domain/columnLineage.ts."""
    maps = column_maps(snapshot) if maps is None and field else (maps or {})
    own: Mapping[str, list[str]] = {}
    direct = None
    start: Needs = None
    if field is not None:
        own = row_values(snapshot, table, row_id).get("_fields") or {}
        direct = own.get(field, maps.get(table, {}).get(field))
        if direct is None and table == ENTITIES:
            direct = metadata_refs(snapshot, row_id, field)
        if direct is None:
            return None
        start = frozenset({field})

    def refs_of(at_table: str, at_row: str, column: str) -> list[str] | None:
        # A row that declares nothing for the column falls back to its table's column map.
        if (at_table, at_row) == (table, row_id) and column in own:
            return own[column]
        return maps.get(at_table, {}).get(column)

    result = Trace(direct, [{table: {row_id}}])
    followed: dict[tuple[str, str], Needs] = {(table, row_id): start}
    frontier: Frontier = {table: {row_id: start}}
    with snapshot.connect() as con:
        while frontier:
            reached = step(con, snapshot, frontier, refs_of, result.columns)
            # Follow each row only for what it wasn't already followed for.
            frontier = {}
            for reached_table, rows in reached.items():
                for reached_id, needs in rows.items():
                    key = (reached_table, reached_id)
                    if key in followed:
                        before = followed[key]
                        if before is None:
                            continue
                        if needs is not None:
                            needs = needs - before
                            if not needs:
                                continue
                        followed[key] = None if needs is None else before | needs
                    else:
                        followed[key] = needs
                    frontier.setdefault(reached_table, {})[reached_id] = needs
            if frontier:
                result.hops.append({t: set(rows) for t, rows in frontier.items()})
    return result


def column_maps(snapshot: Snapshot) -> dict[str, Any]:
    """Each entity table's column map: the union of its parts' maps, read from their Parquet
    metadata. Each part is one job's, so a column reads whatever any job's values of it read."""
    maps: dict[str, dict[str, list[str]]] = {}
    with snapshot.connect() as con:
        for table in sorted(t for t in snapshot.tables if not is_raw(t)):
            merged: dict[str, set[str]] = {}
            for url in snapshot.files(table):
                row = con.execute(
                    f"SELECT decode(value) FROM parquet_kv_metadata({sql_string(url)}) "
                    "WHERE decode(key) = ?",
                    [COLUMNS_METADATA_KEY],
                ).fetchone()
                for column, refs in json.loads(row[0]).items() if row else ():
                    merged.setdefault(column, set()).update(refs)
            if merged:
                maps[table] = {column: sorted(refs) for column, refs in sorted(merged.items())}
    return maps


def metadata_refs(snapshot: Snapshot, entity_id: str, key: str) -> list[str] | None:
    """What an entity's metadata value for `key` reads, or None if it has no such value."""
    with snapshot.connect() as con:
        row = con.execute(
            f"SELECT map_extract_value(_fields, 'value') FROM {snapshot.source(METADATA)} "
            'WHERE cast(entity_id AS VARCHAR) = ? AND "key" = ?',
            [entity_id, key],
        ).fetchone()
    return list(row[0]) if row and row[0] is not None else None


def metadata_value(snapshot: Snapshot, entity_id: str, key: str) -> str | None:
    with snapshot.connect() as con:
        row = con.execute(
            f"SELECT value FROM {snapshot.source(METADATA)} "
            'WHERE cast(entity_id AS VARCHAR) = ? AND "key" = ?',
            [entity_id, key],
        ).fetchone()
    return row[0] if row else None


def row_values(snapshot: Snapshot, table: str, row_id: str) -> dict[str, Any]:
    with snapshot.connect() as con:
        cursor = con.execute(
            f"SELECT * EXCLUDE (_sources) FROM {snapshot.source(table)} "
            "WHERE cast(_row_id AS VARCHAR) = ?",
            [row_id],
        )
        row = cursor.fetchone()
        names = [d[0] for d in cursor.description]
    return dict(zip(names, row)) if row else {}


def raw_values(
    snapshot: Snapshot, table: str, label: str, row_ids: set[str], limit: int = 3
) -> list:
    """Up to `limit` values of one raw field (`column` or `column:<json path>`) for some rows."""
    column, _, path = label.partition(":")
    value = f'json_extract_string("{column}", {sql_string(path)})' if path else f'"{column}"'
    with snapshot.connect() as con:
        # Show timestamps in UTC, as Waymark does, whatever the host's zone.
        con.execute("SET TimeZone = 'UTC'")
        rows = con.execute(
            f"SELECT {value} FROM {snapshot.source(table)} "
            f"WHERE {RAW_ROW_ID} IN (SELECT unnest(?)) ORDER BY {RAW_ROW_ID} LIMIT {int(limit)}",
            [sorted(row_ids)],
        ).fetchall()
    return [v for (v,) in rows]


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--bucket-url", required=True, help="file://, s3:// or az:// base URL")
    parser.add_argument("--snapshot-id", help="Defaults to the published (latest) snapshot")
    parser.add_argument("--table", required=True)
    parser.add_argument("--row-id", required=True)
    parser.add_argument("--field", help="Trace only this column of the row")
    args = parser.parse_args()

    snapshot = snapshots.load(args.bucket_url, args.snapshot_id, os.environ)

    result = trace(snapshot, args.table, args.row_id, args.field)
    if result is None:
        parser.error(f"{args.table} has no column lineage for {args.field!r}")
    if args.field:
        value = row_values(snapshot, args.table, args.row_id).get(args.field)
        if value is None and args.table == ENTITIES:
            value = metadata_value(snapshot, args.row_id, args.field)
        print(f"{args.field} = {value!r}")
        print(f"  computed from: {', '.join(result.direct or []) or '(a constant)'}")

    for depth, hop in enumerate(result.hops):
        for table, row_ids in sorted(hop.items()):
            sample = ", ".join(sorted(row_ids)[:3])
            ids = f"({id_column(table)} {sample}, ...)"
            print(f"hop {depth}: {table:<24} {len(row_ids):>6} rows  {ids}")

    if args.field:
        for table, labels in sorted(result.columns.items()):
            if not is_raw(table):
                continue
            for label, row_ids in sorted(labels.items()):
                sample = raw_values(snapshot, table, label, row_ids)
                print(f"raw field: {table}.{label}  e.g. {', '.join(map(str, sample))}")


if __name__ == "__main__":
    main()
