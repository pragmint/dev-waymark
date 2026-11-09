"""Trace a row of a run's table back to the raw records it came from.

Follows `_sources` one hop at a time, as CONTRACT.md describes, and prints the rows reached at
each hop. The last hop is raw data. With --field, follows only the sources that one field reads,
using each job's column map, and prints the raw fields the value comes from.
"""

import argparse
import json
from collections.abc import Callable, Mapping
from dataclasses import dataclass, field as dataclass_field
from pathlib import Path
from typing import Any

import duckdb

from extract import run_url
from runner import (
    COLUMNS_METADATA_KEY,
    RAW_PREFIX,
    RAW_ROW_ID,
    duckdb_path,
    is_raw,
    parse_ref,
    spec_refs,
    sql_string,
)

Hop = dict[str, set[str]]
Follow = Callable[[str, str], bool]
ROW_IDENTITY = {"_row_id", RAW_ROW_ID}


def parents(con: duckdb.DuckDBPyConnection, tables_dir: Path, table: str, row_ids: set[str]) -> Hop:
    path = sql_string(str(tables_dir / f"{table}.parquet"))
    rows = con.execute(
        f"""
        SELECT DISTINCT "table", row_id FROM (
          SELECT unnest(_sources, recursive := true) FROM read_parquet({path})
          WHERE cast(_row_id AS VARCHAR) IN (SELECT unnest(?))
        )
        """,
        [sorted(row_ids)],
    ).fetchall()
    hop: Hop = {}
    for source_table, row_id in rows:
        hop.setdefault(source_table, set()).add(row_id)
    return hop


def trace(tables_dir: Path, table: str, row_id: str, follow: Follow | None = None) -> list[Hop]:
    """The rows at each hop from one row back to raw, starting with the row itself.

    `follow(from_table, to_table)` decides which source tables to follow; by default, all.
    """
    hops: list[Hop] = [{table: {row_id}}]
    with duckdb.connect() as con:
        while any(not is_raw(t) for t in hops[-1]):
            hop: Hop = {}
            for current, row_ids in hops[-1].items():
                if is_raw(current):
                    continue
                for source_table, source_ids in parents(con, tables_dir, current, row_ids).items():
                    if follow is None or follow(current, source_table):
                        hop.setdefault(source_table, set()).update(source_ids)
            if not hop:
                break
            hops.append(hop)
    return hops


def column_maps(tables_dir: Path) -> dict[str, dict[str, Any]]:
    """Each table's column map, read from its Parquet metadata, for tables that have one."""
    maps = {}
    with duckdb.connect() as con:
        for path in sorted(tables_dir.glob("*.parquet")):
            row = con.execute(
                f"SELECT decode(value) FROM parquet_kv_metadata({sql_string(str(path))}) "
                "WHERE decode(key) = ?",
                [COLUMNS_METADATA_KEY],
            ).fetchone()
            if row:
                maps[path.stem] = json.loads(row[0])
    return maps


def refs_for(spec: Any, by_value: str | None = None) -> list[str]:
    """A column's references. For a keyed column, `by_value` picks the branch; else all count."""
    if isinstance(spec, list):
        return spec
    if by_value is not None:
        return spec.get("when", {}).get(by_value, spec.get("else", []))
    return spec_refs(spec)


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
    maps: Mapping[str, Mapping[str, Any]], table: str, field: str, values: Mapping[str, Any]
) -> FieldTrace | None:
    """Trace one field of one row through the column maps; None if the field isn't declared.

    The same walk as `traceField` in Waymark's src/domain/columnLineage.ts.
    """
    spec = maps.get(table, {}).get(field)
    if spec is None:
        return None
    by_value = None if isinstance(spec, list) else str(values.get(spec["by"]) or "")
    direct = refs_for(spec, by_value)
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
        ref_spec = maps.get(ref_table, {}).get(column)
        if column in ROW_IDENTITY or ref_spec is None:
            whole_rows.add(ref_table)
            continue
        next_refs = refs_for(ref_spec)
        result.follows.setdefault(ref_table, set()).update(parse_ref(r)[0] for r in next_refs)
        queue.extend(next_refs)
    for whole_table in whole_rows:
        result.follows.pop(whole_table, None)
    return result


def row_values(tables_dir: Path, table: str, row_id: str) -> dict[str, Any]:
    path = sql_string(str(tables_dir / f"{table}.parquet"))
    with duckdb.connect() as con:
        cursor = con.execute(
            f"SELECT * EXCLUDE (_sources) FROM read_parquet({path}) "
            "WHERE cast(_row_id AS VARCHAR) = ?",
            [row_id],
        )
        row = cursor.fetchone()
        names = [d[0] for d in cursor.description]
    return dict(zip(names, row)) if row else {}


def raw_values(run_root: Path, table: str, label: str, row_ids: set[str], limit: int = 3) -> list:
    """Up to `limit` values of one raw field (`column` or `column:<json path>`) for some rows."""
    column, _, path = label.partition(":")
    files = sql_string(str(run_root / "raw" / table.removeprefix(RAW_PREFIX) / "*.parquet"))
    value = f'json_extract_string("{column}", {sql_string(path)})' if path else f'"{column}"'
    with duckdb.connect() as con:
        # Show timestamps in UTC, as Waymark does, whatever the host's zone.
        con.execute("SET TimeZone = 'UTC'")
        rows = con.execute(
            f"SELECT {value} FROM read_parquet({files}, union_by_name = true) "
            f"WHERE {RAW_ROW_ID} IN (SELECT unnest(?)) ORDER BY {RAW_ROW_ID} LIMIT {int(limit)}",
            [sorted(row_ids)],
        ).fetchall()
    return [v for (v,) in rows]


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--bucket-url", required=True, help="file:// base URL")
    parser.add_argument("--run-id", required=True)
    parser.add_argument("--table", required=True)
    parser.add_argument("--row-id", required=True)
    parser.add_argument("--field", help="Trace only this column of the row")
    args = parser.parse_args()

    run_root = Path(duckdb_path(run_url(args.bucket_url, args.run_id)))
    tables_dir = run_root / "tables"

    field_trace = None
    if args.field:
        values = row_values(tables_dir, args.table, args.row_id)
        field_trace = trace_field(column_maps(tables_dir), args.table, args.field, values)
        if field_trace is None:
            parser.error(f"{args.table} declares no column lineage for {args.field!r}")
        print(f"{args.field} = {values.get(args.field)!r}")
        print(f"  computed from: {', '.join(field_trace.direct) or '(a constant)'}")

    hops = trace(tables_dir, args.table, args.row_id, field_trace.follow if field_trace else None)
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
                sample = raw_values(run_root, table, label, leaves.get(table, set()))
                print(f"raw field: {table}.{label}  e.g. {', '.join(map(str, sample))}")


if __name__ == "__main__":
    main()
