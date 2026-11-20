"""Extract GitHub and Jira into raw Parquet at <bucket>/raw/<table>/<run_id>.<load>.<file>.parquet.

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
import json
import re
import os
import sys
import tempfile
import tomllib
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Any, Mapping

import dlt
from dlt.destinations import filesystem
from dlt.destinations.impl.filesystem.filesystem import CURRENT_VERSION, INIT_FILE_NAME
from dlt.sources.rest_api import rest_api_source

import snapshot as snapshots
from snapshot import Run, check_id, join, new_snapshot_id

PAGE_SIZE = 100
# How far before the last run's start an incremental run fetches from. GitHub's `updated_at` is
# UTC to the second, so this only covers clock skew. JQL dates are in the Jira user's time zone
# (anywhere from -12 to +14 hours) and to the minute, so a day covers any of them. Records fetched
# twice are harmless: the jobs keep the latest version of each.
GITHUB_OVERLAP = timedelta(hours=1)
JIRA_OVERLAP = timedelta(days=1)
ORDER_BY = re.compile(r"(?:^|\s+)order\s+by\s+", re.IGNORECASE)

# dlt drops a column that is all null in a load, so a run could lose a field depending on what
# it fetched. Declaring what the transform reads keeps the raw schema the same on every run.
GITHUB_PULL_COLUMNS = {
    "title": {"data_type": "text"},
    "body": {"data_type": "text"},
    "created_at": {"data_type": "timestamp"},
    "updated_at": {"data_type": "timestamp"},
    "closed_at": {"data_type": "timestamp"},
    "merged_at": {"data_type": "timestamp"},
}


def new_run_id(now: datetime) -> str:
    return new_snapshot_id(now)


# Every file a run writes starts with its id, so a run's files are exactly `<table>/<run_id>.*`.
RAW_LAYOUT = "{table_name}/{run_id}.{load_id}.{file_id}.{ext}"


def slim_pull(pull: dict[str, Any]) -> dict[str, Any]:
    """Drop the full repo objects GitHub nests in each PR, keeping the branch and repo names."""

    def slim_ref(ref: dict[str, Any]) -> dict[str, Any]:
        repo = ref.get("repo") or {}
        return {"ref": ref.get("ref"), "sha": ref.get("sha"), "repo": repo.get("full_name")}

    return {**pull, "head": slim_ref(pull["head"]), "base": slim_ref(pull["base"])}


def github_since(started_at: datetime) -> str:
    return (started_at - GITHUB_OVERLAP).astimezone(UTC).strftime("%Y-%m-%dT%H:%M:%SZ")


def github_pulls_endpoint(repo: str, since: str | None) -> dict[str, Any]:
    """A full run pages by creation date, which doesn't move under it. GitHub's pull list has no
    `since` filter, so an incremental run pages newest-updated first and stops at the cursor."""
    params = {"state": "all", "per_page": PAGE_SIZE}
    if since is None:
        params = {**params, "sort": "created", "direction": "asc"}
        return {"path": f"repos/{repo}/pulls", "params": params}
    return {
        "path": f"repos/{repo}/pulls",
        "params": {**params, "sort": "updated", "direction": "desc"},
        "incremental": {"cursor_path": "updated_at", "initial_value": since, "row_order": "desc"},
    }


def github_config(
    repos: list[str], env: Mapping[str, str], since: str | None = None
) -> dict[str, Any]:
    token = env.get("GITHUB_TOKEN")
    if not token:
        raise ValueError("GITHUB_TOKEN is required")
    return {
        "client": {
            "base_url": "https://api.github.com/",
            "auth": {"type": "bearer", "token": token},
            "paginator": {"type": "header_link"},
        },
        "resources": [
            {
                "name": f"github_pulls_{repo.replace('/', '_').replace('-', '_')}",
                "table_name": "github_pulls",
                "primary_key": "id",
                "columns": GITHUB_PULL_COLUMNS,
                "processing_steps": [{"map": slim_pull}],
                "endpoint": github_pulls_endpoint(repo, since),
            }
            for repo in repos
        ],
    }


def jira_auth(flavor: str, env: Mapping[str, str]) -> dict[str, str] | None:
    token = env.get("JIRA_API_TOKEN")
    if flavor == "cloud":
        email = env.get("JIRA_EMAIL")
        if not (email and token):
            raise ValueError("JIRA_EMAIL and JIRA_API_TOKEN are required for Jira Cloud")
        return {"type": "http_basic", "username": email, "password": token}
    return {"type": "bearer", "token": token} if token else None


def jira_since(started_at: datetime) -> str:
    return (started_at - JIRA_OVERLAP).astimezone(UTC).strftime("%Y-%m-%d %H:%M")


def incremental_jql(jql: str, since: str | None) -> str:
    """The client's JQL, narrowed to issues updated since the cursor, keeping its ORDER BY."""
    if since is None:
        return jql
    parts = ORDER_BY.split(jql, maxsplit=1)
    where = parts[0].strip()
    order = f" ORDER BY {parts[1].strip()}" if len(parts) > 1 else ""
    clause = f'updated >= "{since}"'
    return f"({where}) AND {clause}{order}" if where else f"{clause}{order}"


def jira_endpoint(flavor: str, jql: str) -> dict[str, Any]:
    params = {"jql": jql, "fields": "*all"}
    if flavor == "cloud":
        return {
            "path": "rest/api/3/search/jql",
            "params": {**params, "maxResults": PAGE_SIZE},
            "data_selector": "issues",
            "paginator": {
                "type": "cursor",
                "cursor_path": "nextPageToken",
                "cursor_param": "nextPageToken",
            },
        }
    if flavor == "server":
        return {
            "path": "rest/api/2/search",
            "params": params,
            "data_selector": "issues",
            "paginator": {
                "type": "offset",
                "limit": PAGE_SIZE,
                "offset_param": "startAt",
                "limit_param": "maxResults",
                "total_path": "total",
            },
        }
    raise ValueError(f"Unknown Jira flavor: {flavor!r}")


def jira_config(
    jira: Mapping[str, str], env: Mapping[str, str], since: str | None = None
) -> dict[str, Any]:
    flavor = jira["flavor"]
    client: dict[str, Any] = {"base_url": jira["base_url"].rstrip("/") + "/"}
    auth = jira_auth(flavor, env)
    if auth:
        client["auth"] = auth
    return {
        "client": client,
        "resources": [
            {
                "name": "jira_issues",
                "primary_key": "id",
                "endpoint": jira_endpoint(flavor, incremental_jql(jira["jql"], since)),
            }
        ],
    }


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
    max_pages: int | None = None,
    full: bool = False,
    started_at: datetime | None = None,
) -> Run:
    """Fetch every source into raw, then write the run record. Returns the run. Fails with
    LockHeld if another extract is running against the bucket."""
    started_at = started_at or datetime.now(UTC)
    # Held from planning, so a second run can't pick the same base run as this one.
    with snapshots.extract_lock(bucket_url, check_id(run_id), started_at):
        return _extract(client, bucket_url, run_id, env, max_pages, full, started_at)


def _extract(
    client: Mapping[str, Any],
    bucket_url: str,
    run_id: str,
    env: Mapping[str, str],
    max_pages: int | None,
    full: bool,
    started_at: datetime,
) -> Run:
    run, cursor = plan_run(bucket_url, check_id(run_id), started_at, full, bool(max_pages))
    since = {} if cursor is None else {"github": github_since(cursor), "jira": jira_since(cursor)}
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
    configs = {
        "github": github_config(client["github"]["repos"], env, since.get("github")),
        "jira": jira_config(client["jira"], env, since.get("jira")),
    }
    for name, config in configs.items():
        # Nesting 0 keeps nested objects as JSON columns. Custom fields differ per client and
        # would otherwise become hundreds of columns; the staging models pick what they need.
        source = rest_api_source(config, name=name, max_table_nesting=0)
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
            client, args.bucket_url, run_id, os.environ, args.max_pages, args.full, started_at
        )
    except snapshots.LockHeld as error:
        sys.exit(str(error))
    since = ", ".join(f"{k} since {v}" for k, v in run.since.items()) or "everything"
    print(f"{run.kind} run: {since}; a snapshot reads runs {', '.join(run.chain)}")
    print(f"run_id={run_id}")
    print(f"raw_url={join(args.bucket_url, 'raw')}")


if __name__ == "__main__":
    main()
