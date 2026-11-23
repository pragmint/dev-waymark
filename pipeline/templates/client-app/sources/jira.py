"""Jira issues into raw.jira_issues, from the JQL in the client's `[jira]`.

A source module: the pipeline's extract.py runs every module in sources/, in name order, and
gives each the client config, the environment, and where an incremental run fetches from. It
handles the rest: the lock, the run record, and where and how the files are written. This copy is
the client's to change, but the shared jobs read raw.jira_issues, so keep the columns they read.
"""

import re
from datetime import UTC, datetime, timedelta
from typing import Any, Mapping

from dlt.sources import DltSource
from dlt.sources.rest_api import rest_api_source

PAGE_SIZE = 100
# JQL dates are in the Jira user's time zone (anywhere from -12 to +14 hours) and to the minute,
# so a day of overlap covers any of them. Records fetched twice are harmless: the jobs keep the
# latest version of each.
OVERLAP = timedelta(days=1)
ORDER_BY = re.compile(r"(?:^|\s+)order\s+by\s+", re.IGNORECASE)


def since(cursor: datetime) -> str:
    """Where an incremental run fetches from, given when the last run started."""
    return (cursor - OVERLAP).astimezone(UTC).strftime("%Y-%m-%d %H:%M")


def auth(flavor: str, env: Mapping[str, str]) -> dict[str, str] | None:
    token = env.get("JIRA_API_TOKEN")
    if flavor == "cloud":
        email = env.get("JIRA_EMAIL")
        if not (email and token):
            raise ValueError("JIRA_EMAIL and JIRA_API_TOKEN are required for Jira Cloud")
        return {"type": "http_basic", "username": email, "password": token}
    return {"type": "bearer", "token": token} if token else None


def incremental_jql(jql: str, since: str | None) -> str:
    """The client's JQL, narrowed to issues updated since the cursor, keeping its ORDER BY."""
    if since is None:
        return jql
    parts = ORDER_BY.split(jql, maxsplit=1)
    where = parts[0].strip()
    order = f" ORDER BY {parts[1].strip()}" if len(parts) > 1 else ""
    clause = f'updated >= "{since}"'
    return f"({where}) AND {clause}{order}" if where else f"{clause}{order}"


def endpoint(flavor: str, jql: str) -> dict[str, Any]:
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


def config(
    jira: Mapping[str, str], env: Mapping[str, str], since: str | None = None
) -> dict[str, Any]:
    flavor = jira["flavor"]
    client: dict[str, Any] = {"base_url": jira["base_url"].rstrip("/") + "/"}
    found = auth(flavor, env)
    if found:
        client["auth"] = found
    return {
        "client": client,
        "resources": [
            {
                "name": "jira_issues",
                "primary_key": "id",
                "endpoint": endpoint(flavor, incremental_jql(jira["jql"], since)),
            }
        ],
    }


def source(client: Mapping[str, Any], env: Mapping[str, str], since: str | None) -> DltSource:
    """The dlt source for one run: everything when `since` is None, else what changed since."""
    # Nesting 0 keeps nested objects as JSON columns. Custom fields differ per client and would
    # otherwise become hundreds of columns; the jobs pick what they need.
    return rest_api_source(config(client["jira"], env, since), name="jira", max_table_nesting=0)
