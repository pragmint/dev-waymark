"""Trace a row of a run's table back to the raw records it came from.

Follows `_sources` one hop at a time, as CONTRACT.md describes, and prints the rows reached at
each hop. The last hop is raw data.
"""

import argparse
from pathlib import Path

import duckdb

from extract import run_url
from runner import RAW_ROW_ID, duckdb_path, is_raw, sql_string

Hop = dict[str, set[str]]


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


def trace(tables_dir: Path, table: str, row_id: str) -> list[Hop]:
    """The rows at each hop from one row back to raw, starting with the row itself."""
    hops: list[Hop] = [{table: {row_id}}]
    with duckdb.connect() as con:
        while any(not is_raw(t) for t in hops[-1]):
            hop: Hop = {}
            for current, row_ids in hops[-1].items():
                if is_raw(current):
                    continue
                for source_table, source_ids in parents(con, tables_dir, current, row_ids).items():
                    hop.setdefault(source_table, set()).update(source_ids)
            if not hop:
                break
            hops.append(hop)
    return hops


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--bucket-url", required=True, help="file:// base URL")
    parser.add_argument("--run-id", required=True)
    parser.add_argument("--table", required=True)
    parser.add_argument("--row-id", required=True)
    args = parser.parse_args()

    run_root = Path(duckdb_path(run_url(args.bucket_url, args.run_id)))
    hops = trace(run_root / "tables", args.table, args.row_id)
    for depth, hop in enumerate(hops):
        for table, row_ids in sorted(hop.items()):
            sample = ", ".join(sorted(row_ids)[:3])
            id_name = RAW_ROW_ID if is_raw(table) else "_row_id"
            print(f"hop {depth}: {table:<24} {len(row_ids):>6} rows  ({id_name} {sample}, ...)")


if __name__ == "__main__":
    main()
