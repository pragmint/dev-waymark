"""Extract a client's sources into raw Parquet at
<bucket>/raw/<table>/<run_id>.<load>.<file>.parquet.

What to fetch is the client's: each module in its sources folder (by default the template's,
templates/client-app/sources/, which fetch GitHub and Jira) returns a dlt source for a run. How
it's written is the pipeline's, below, the same for every client.

A run is full (`--full`: everything) or incremental (the default: only what changed since the last
run started, with some overlap). When every source has loaded it writes its run record,
<bucket>/runs/<run_id>.json, naming the runs a snapshot of it reads: the last full run and every
run since. Run a full extract regularly: it's how deleted records drop out.

Raw is append-only: a run adds files named after it and never touches another run's, so every
snapshot built from earlier raw stays readable. A failed run writes no record, so runner.py never
builds it and the next incremental run starts from the run before (the layout is in snapshot.py).

Only one extract runs against a bucket at a time: each holds <bucket>/runs/extract.lock from
planning its run to recording it, and a second one fails straight away rather than waiting.
"""

import argparse
import importlib.util
import json
import os
import sys
import tempfile
import tomllib
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path
from typing import Any, Callable, Mapping

import dlt
from dlt.destinations import filesystem
from dlt.destinations.impl.filesystem.filesystem import CURRENT_VERSION, INIT_FILE_NAME

import snapshot as snapshots
from snapshot import Run, check_id, join, new_snapshot_id

# The source modules a client runs unless it names its own folder: the template's, which a client
# repo starts from (templates/client-app/sources/).
DEFAULT_SOURCES = Path(__file__).parent / "templates" / "client-app" / "sources"


@dataclass(frozen=True)
class Source:
    """One source module: its file name, where an incremental run fetches it from given when the
    last run started, and the dlt source for a run (everything when `since` is None)."""

    name: str
    since: Callable[[datetime], str]
    source: Callable[[Mapping[str, Any], Mapping[str, str], str | None], Any]


def load_sources(folder: Path) -> list[Source]:
    """Every module in the folder whose name doesn't start with `_`, in name order. Each defines
    `since(cursor)` and `source(client, env, since)`."""
    found = []
    for path in sorted(folder.glob("*.py")):
        if path.name.startswith("_"):
            continue
        spec = importlib.util.spec_from_file_location(f"waymark_source_{path.stem}", path)
        if spec is None or spec.loader is None:
            raise ValueError(f"Can't load source module {path}")
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        missing = [n for n in ("since", "source") if not callable(getattr(module, n, None))]
        if missing:
            raise ValueError(f"Source module {path} doesn't define {' or '.join(missing)}")
        found.append(Source(path.stem, module.since, module.source))
    if not found:
        raise ValueError(f"No source modules in {folder}")
    return found


def new_run_id(now: datetime) -> str:
    return new_snapshot_id(now)


# Every file a run writes starts with its id, so a run's files are exactly `<table>/<run_id>.*`.
RAW_LAYOUT = "{table_name}/{run_id}.{load_id}.{file_id}.{ext}"


def mark_raw_initialized(bucket_url: str) -> bool:
    """Write dlt's `raw/init` marker if `raw/` exists without one, as dlt itself would.

    dlt treats a dataset with no marker as new and creates its folder first. On an object store
    that does nothing, but on a local disk it fails when `raw/` is already there, as it is in a
    bucket whose raw was copied in rather than extracted. Returns whether it wrote the marker."""
    raw = join(bucket_url, "raw")
    marker = f"{raw}/{INIT_FILE_NAME}"
    if not snapshots.exists(raw) or snapshots.exists(marker):
        return False
    fs, path = snapshots.filesystem(marker)
    version = {"initial_version": CURRENT_VERSION, "current_version": CURRENT_VERSION}
    fs.write_text(path, json.dumps(version), encoding="utf-8")
    return True


def iso_utc(moment: datetime) -> str:
    return moment.astimezone(UTC).strftime("%Y-%m-%dT%H:%M:%SZ")


def plan_run(
    bucket_url: str, run_id: str, started_at: datetime, full: bool, limited: bool
) -> tuple[Run, datetime | None]:
    """The run this extract will record, and the time it fetches changes from (None for full)."""
    if full:
        return Run(run_id, "full", iso_utc(started_at), (run_id,), limited), None
    previous = snapshots.last_run(bucket_url)
    if previous is None:
        raise ValueError(f"No finished run under {bucket_url} to continue from; run with --full")
    if previous.started_at >= iso_utc(started_at):
        raise ValueError(f"Run {previous.id} started at or after this one ({previous.started_at})")
    cursor = datetime.fromisoformat(previous.started_at)
    chain = (*previous.chain, run_id)
    return Run(run_id, "incremental", iso_utc(started_at), chain, limited), cursor


def extract(
    client: Mapping[str, Any],
    bucket_url: str,
    run_id: str,
    env: Mapping[str, str],
    sources: list[Source],
    max_pages: int | None = None,
    full: bool = False,
    started_at: datetime | None = None,
) -> Run:
    """Fetch every source into raw, then write the run record. Returns the run. Fails with
    LockHeld if another extract is running against the bucket."""
    started_at = started_at or datetime.now(UTC)
    # Held from planning, so a second run can't pick the same base run as this one.
    with snapshots.extract_lock(bucket_url, check_id(run_id), started_at):
        return _extract(client, bucket_url, run_id, env, sources, max_pages, full, started_at)


def _extract(
    client: Mapping[str, Any],
    bucket_url: str,
    run_id: str,
    env: Mapping[str, str],
    sources: list[Source],
    max_pages: int | None,
    full: bool,
    started_at: datetime,
) -> Run:
    run, cursor = plan_run(bucket_url, check_id(run_id), started_at, full, bool(max_pages))
    since = {} if cursor is None else {found.name: found.since(cursor) for found in sources}
    mark_raw_initialized(bucket_url)
    pipeline = dlt.pipeline(
        pipeline_name=f"waymark_{client['client'].replace('-', '_')}",
        # A throwaway working dir keeps dlt stateless: the cursor comes from the run records.
        pipelines_dir=tempfile.mkdtemp(prefix="waymark-dlt-"),
        destination=filesystem(
            bucket_url=bucket_url,
            layout=RAW_LAYOUT,
            extra_placeholders={"run_id": check_id(run_id)},
        ),
        dataset_name="raw",
    )
    # Otherwise dlt restores its state from the bucket, and its incremental cursor (the newest
    # `updated_at` it saw) overrides the run record's, skipping changes made while a run paged.
    pipeline.config.restore_from_destination = False
    for found in sources:
        source = found.source(client, env, since.get(found.name))
        if max_pages:
            source.add_limit(max_pages)
        # Append: "replace" would delete earlier runs' files, which older snapshots still read.
        pipeline.run(source, loader_file_format="parquet", write_disposition="append")
        print(pipeline.last_trace.last_normalize_info)
    # Last, so a run that failed part way has no record and nothing builds on it.
    run = Run(run.id, run.kind, run.started_at, run.chain, run.limited, since)
    snapshots.save_run(bucket_url, run)
    return run


def adopt_run(bucket_url: str, run_id: str) -> Run:
    """Record a full run extracted before run records existed. Its id must be the UTC time it
    started (the default), which becomes the next incremental run's cursor."""
    try:
        started_at = datetime.strptime(run_id, "%Y%m%dT%H%M%SZ").replace(tzinfo=UTC)
    except ValueError as error:
        raise ValueError(f"Can't adopt {run_id!r}: its id isn't a UTC time") from error
    if snapshots.exists(join(bucket_url, snapshots.run_key(run_id))):
        raise ValueError(f"Run {run_id} already has a record")
    if not snapshots.raw_files(bucket_url, [run_id]):
        raise ValueError(f"No raw files for run {run_id} under {join(bucket_url, 'raw')}")
    run = Run(run_id, "full", iso_utc(started_at), (run_id,))
    snapshots.save_run(bucket_url, run)
    return run


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--client", type=Path, help="Client config TOML")
    parser.add_argument("--bucket-url", required=True, help="s3://, az:// or file:// base URL")
    parser.add_argument(
        "--sources",
        type=Path,
        default=DEFAULT_SOURCES,
        help="Folder of source modules (default: the client template's)",
    )
    parser.add_argument("--run-id", help="Defaults to the current UTC time")
    parser.add_argument("--full", action="store_true", help="Fetch everything, not just changes")
    parser.add_argument("--max-pages", type=int, help="Stop each resource early, for smoke tests")
    parser.add_argument(
        "--adopt-run", metavar="RUN_ID", help="Record an old full run instead of extracting"
    )
    parser.add_argument(
        "--break-lock",
        action="store_true",
        help="Remove a lock a crashed extract left behind, instead of extracting",
    )
    args = parser.parse_args()

    if args.break_lock:
        held = snapshots.break_lock(args.bucket_url)
        print("no extract lock to remove" if held is None else f"removed extract lock: {held}")
        return

    if args.adopt_run:
        run = adopt_run(args.bucket_url, args.adopt_run)
        print(f"recorded run {run.id} as full, started {run.started_at}")
        return
    if args.client is None:
        parser.error("--client is required")
    started_at = datetime.now(UTC)
    run_id = args.run_id or new_run_id(started_at)
    client = tomllib.loads(args.client.read_text())
    try:
        run = extract(
            client,
            args.bucket_url,
            run_id,
            os.environ,
            load_sources(args.sources),
            args.max_pages,
            args.full,
            started_at,
        )
    except snapshots.LockHeld as error:
        sys.exit(str(error))
    since = ", ".join(f"{k} since {v}" for k, v in run.since.items()) or "everything"
    print(f"{run.kind} run: {since}; a snapshot reads runs {', '.join(run.chain)}")
    print(f"run_id={run_id}")
    print(f"raw_url={join(args.bucket_url, 'raw')}")


if __name__ == "__main__":
    main()
