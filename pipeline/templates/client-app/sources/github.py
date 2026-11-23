"""GitHub pull requests into raw.github_pulls, one dlt resource per repo in the client's `[github]`.

A source module: the pipeline's extract.py runs every module in sources/, in name order, and
gives each the client config, the environment, and where an incremental run fetches from. It
handles the rest: the lock, the run record, and where and how the files are written. This copy is
the client's to change, but the shared jobs read raw.github_pulls, so keep the columns they read.
"""

from datetime import UTC, datetime, timedelta
from typing import Any, Mapping

from dlt.sources import DltSource
from dlt.sources.rest_api import rest_api_source

PAGE_SIZE = 100
# GitHub's `updated_at` is UTC to the second, so the overlap only covers clock skew. Records
# fetched twice are harmless: the jobs keep the latest version of each.
OVERLAP = timedelta(hours=1)

# dlt drops a column that is all null in a load, so a run could lose a field depending on what
# it fetched. Declaring what the jobs read keeps the raw schema the same on every run.
PULL_COLUMNS = {
    "title": {"data_type": "text"},
    "body": {"data_type": "text"},
    "created_at": {"data_type": "timestamp"},
    "updated_at": {"data_type": "timestamp"},
    "closed_at": {"data_type": "timestamp"},
    "merged_at": {"data_type": "timestamp"},
}


def since(cursor: datetime) -> str:
    """Where an incremental run fetches from, given when the last run started."""
    return (cursor - OVERLAP).astimezone(UTC).strftime("%Y-%m-%dT%H:%M:%SZ")


def slim_pull(pull: dict[str, Any]) -> dict[str, Any]:
    """Drop the full repo objects GitHub nests in each PR, keeping the branch and repo names."""

    def slim_ref(ref: dict[str, Any]) -> dict[str, Any]:
        repo = ref.get("repo") or {}
        return {"ref": ref.get("ref"), "sha": ref.get("sha"), "repo": repo.get("full_name")}

    return {**pull, "head": slim_ref(pull["head"]), "base": slim_ref(pull["base"])}


def pulls_endpoint(repo: str, since: str | None) -> dict[str, Any]:
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


def config(repos: list[str], env: Mapping[str, str], since: str | None = None) -> dict[str, Any]:
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
                "columns": PULL_COLUMNS,
                "processing_steps": [{"map": slim_pull}],
                "endpoint": pulls_endpoint(repo, since),
            }
            for repo in repos
        ],
    }


def source(client: Mapping[str, Any], env: Mapping[str, str], since: str | None) -> DltSource:
    """The dlt source for one run: everything when `since` is None, else what changed since."""
    # Nesting 0 keeps nested objects as JSON columns; the jobs pick what they need.
    return rest_api_source(
        config(client["github"]["repos"], env, since), name="github", max_table_nesting=0
    )
