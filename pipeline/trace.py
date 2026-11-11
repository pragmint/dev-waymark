"""Trace a row of a snapshot's table back to the raw records it came from.

Follows `_sources` one hop at a time, as CONTRACT.md describes, and prints the rows reached at
each hop. The last hop is raw data. With --field, follows only the sources that one field reads:
the row's own `_fields` for the first hop, then each table's column map (the union of its rows'
`_fields`), and prints the raw fields the value comes from.
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
    RAW_ROW_ID,
    is_raw,
    parse_ref,
    sql_string,
)
from snapshot import Snapshot

Hop = dict[str, set[str]]
Follow = Callable[[str, str], bool]
ROW_IDENTITY = {"_row_id", RAW_ROW_ID}


def parents(
    con: duckdb.DuckDBPyConnection, snapshot: Snapshot, table: str, row_ids: set[str]
) -> Hop:
    rows = con.execute(
        f"""
        SELECT DISTINCT "table", row_id FROM (
          SELECT unnest(_sources, recursive := true) FROM {snapshot.source(table)}
          WHERE cast(_row_id AS VARCHAR) IN (SELECT unnest(?))
        )
        """,
        [sorted(row_ids)],
    ).fetchall()
    hop: Hop = {}
    for source_table, row_id in rows:
        hop.setdefault(source_table, set()).add(row_id)
    return hop


def trace(snapshot: Snapshot, table: str, row_id: str, follow: Follow | None = None) -> list[Hop]:
    """The rows at each hop from one row back to raw, starting with the row itself.

    `follow(from_table, to_table)` decides which source tables to follow; by default, all.
    """
    hops: list[Hop] = [{table: {row_id}}]
    with snapshot.connect() as con:
        while any(not is_raw(t) for t in hops[-1]):
            hop: Hop = {}
            for current, row_ids in hops[-1].items():
                if is_raw(current):
                    continue
                for source_table, source_ids in parents(con, snapshot, current, row_ids).items():
                    if follow is None or follow(current, source_table):
                        hop.setdefault(source_table, set()).update(source_ids)
            if not hop:
                break
            hops.append(hop)
    return hops


def column_maps(snapshot: Snapshot) -> dict[str, dict[str, Any]]:
    """Each built table's column map, read from its Parquet metadata, for tables that have one."""
    maps = {}
    with snapshot.connect() as con:
        for table in sorted(t for t in snapshot.tables if not is_raw(t)):
            # A table's files share one job's output, so the first file's map is the table's.
            row = con.execute(
                f"SELECT decode(value) FROM parquet_kv_metadata({sql_string(snapshot.files(table)[0])}) "
                "WHERE decode(key) = ?",
                [COLUMNS_METADATA_KEY],
            ).fetchone()
            if row:
                maps[table] = json.loads(row[0])
    return maps


def ref_label(ref: str) -> str:
    _, column, path = parse_ref(ref)
    return f"{column}:{path}" if path else column


@dataclass
class FieldTrace:
    field: str
    direct: list[str]
    # Every column reached, as labels (`column` or `column:<json path>`), by table.
    columns: dict[str, set[str]] = dataclass_field(default_factory=dict)
    # Per table, the source tables worth following. A table missing here follows all of them.
    follows: dict[str, set[str]] = dataclass_field(default_factory=dict)

    def follow(self, from_table: str, to_table: str) -> bool:
        allowed = self.follows.get(from_table)
        return allowed is None or to_table in allowed


def trace_field(
    maps: Mapping[str, Mapping[str, list[str]]],
    table: str,
    field: str,
    values: Mapping[str, Any],
) -> FieldTrace | None:
    """Trace one field of one row; None if neither the row nor its table maps the field.

    The row's own `_fields` gives the first hop exactly. Past it, a table's map is the union over
    its rows, so it can list more than one particular row read. The same walk as `traceField` in
    Waymark's src/domain/columnLineage.ts.
    """
    own = values.get("_fields") or {}
    direct = own.get(field, maps.get(table, {}).get(field))
    if direct is None:
        return None
    result = FieldTrace(field, direct, follows={table: {parse_ref(r)[0] for r in direct}})

    whole_rows: set[str] = set()
    seen: set[str] = set()
    queue = list(direct)
    while queue:
        ref = queue.pop(0)
        if ref in seen:
            continue
        seen.add(ref)
        ref_table, column, _ = parse_ref(ref)
        result.columns.setdefault(ref_table, set()).add(ref_label(ref))
        if is_raw(ref_table):
            continue
        next_refs = maps.get(ref_table, {}).get(column)
        if column in ROW_IDENTITY or next_refs is None:
            whole_rows.add(ref_table)
            continue
        result.follows.setdefault(ref_table, set()).update(parse_ref(r)[0] for r in next_refs)
        queue.extend(next_refs)
    for whole_table in whole_rows:
        result.follows.pop(whole_table, None)
    return result


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

    field_trace = None
    if args.field:
        values = row_values(snapshot, args.table, args.row_id)
        field_trace = trace_field(column_maps(snapshot), args.table, args.field, values)
        if field_trace is None:
            parser.error(f"{args.table} has no column lineage for {args.field!r}")
        print(f"{args.field} = {values.get(args.field)!r}")
        print(f"  computed from: {', '.join(field_trace.direct) or '(a constant)'}")

    hops = trace(snapshot, args.table, args.row_id, field_trace.follow if field_trace else None)
    for depth, hop in enumerate(hops):
        for table, row_ids in sorted(hop.items()):
            sample = ", ".join(sorted(row_ids)[:3])
            id_name = RAW_ROW_ID if is_raw(table) else "_row_id"
            print(f"hop {depth}: {table:<24} {len(row_ids):>6} rows  ({id_name} {sample}, ...)")

    if field_trace:
        leaves: Hop = {}
        for hop in hops:
            for table, row_ids in hop.items():
                if is_raw(table):
                    leaves.setdefault(table, set()).update(row_ids)
        for table, labels in sorted(field_trace.columns.items()):
            if not is_raw(table):
                continue
            for label in sorted(labels):
                sample = raw_values(snapshot, table, label, leaves.get(table, set()))
                print(f"raw field: {table}.{label}  e.g. {', '.join(map(str, sample))}")


if __name__ == "__main__":
    main()
