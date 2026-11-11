"""Extract GitHub and Jira into raw Parquet at <bucket>/raw/<table>/<run_id>.<load>.<file>.parquet.

Raw is append-only: a run adds files named after it and never touches another run's, so every
snapshot built from earlier raw stays readable. A failed or partial run is never read, because
runner.py only builds a snapshot from a run id it's given (the layout is in snapshot.py).
"""

import argparse
import os
import tempfile
import tomllib
from datetime import UTC, datetime
from pathlib import Path
from typing import Any, Mapping

import dlt
from dlt.destinations import filesystem
from dlt.sources.rest_api import rest_api_source

from snapshot import check_id, join, new_snapshot_id

PAGE_SIZE = 100

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


def github_config(repos: list[str], env: Mapping[str, str]) -> dict[str, Any]:
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
                "endpoint": {
                    "path": f"repos/{repo}/pulls",
                    "params": {
                        "state": "all",
                        "sort": "created",
                        "direction": "asc",
                        "per_page": PAGE_SIZE,
                    },
                },
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


def jira_config(jira: Mapping[str, str], env: Mapping[str, str]) -> dict[str, Any]:
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
                "endpoint": jira_endpoint(flavor, jira["jql"]),
            }
        ],
    }


def extract(
    client: Mapping[str, Any],
    bucket_url: str,
    run_id: str,
    env: Mapping[str, str],
    max_pages: int | None = None,
) -> None:
    pipeline = dlt.pipeline(
        pipeline_name=f"waymark_{client['client'].replace('-', '_')}",
        # A throwaway working dir keeps runs stateless: nothing carries over between them.
        pipelines_dir=tempfile.mkdtemp(prefix="waymark-dlt-"),
        destination=filesystem(
            bucket_url=bucket_url,
            layout=RAW_LAYOUT,
            extra_placeholders={"run_id": check_id(run_id)},
        ),
        dataset_name="raw",
    )
    configs = {
        "github": github_config(client["github"]["repos"], env),
        "jira": jira_config(client["jira"], env),
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


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--client", required=True, type=Path, help="Client config TOML")
    parser.add_argument("--bucket-url", required=True, help="s3://, az:// or file:// base URL")
    parser.add_argument("--run-id", help="Defaults to the current UTC time")
    parser.add_argument("--max-pages", type=int, help="Stop each resource early, for smoke tests")
    args = parser.parse_args()

    run_id = args.run_id or new_run_id(datetime.now(UTC))
    client = tomllib.loads(args.client.read_text())
    extract(client, args.bucket_url, run_id, os.environ, args.max_pages)
    print(f"run_id={run_id}")
    print(f"raw_url={join(args.bucket_url, 'raw')}")


if __name__ == "__main__":
    main()
