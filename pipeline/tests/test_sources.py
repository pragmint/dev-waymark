"""The client template's source modules (templates/client-app/sources/), and how they're loaded."""

import importlib.util
from datetime import UTC, datetime
from pathlib import Path
from types import ModuleType

import pytest

from extract import DEFAULT_SOURCES, load_sources

SOURCES = {found.name: found for found in load_sources(DEFAULT_SOURCES)}
SERVER = {"flavor": "server", "base_url": "https://jira.example.org/jira/", "jql": "project = A"}
CLOUD = {"flavor": "cloud", "base_url": "https://acme.atlassian.net", "jql": "project = A"}
NOW = datetime(2026, 11, 11, 12, 0, 0, tzinfo=UTC)
ENV = {"GITHUB_TOKEN": "t"}


def module(name: str) -> ModuleType:
    """A source module itself, for its helpers."""
    path = DEFAULT_SOURCES / f"{name}.py"
    spec = importlib.util.spec_from_file_location(f"test_source_{name}", path)
    assert spec and spec.loader
    found = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(found)
    return found


github = module("github")
jira = module("jira")


def test_the_template_fetches_github_then_jira():
    assert list(SOURCES) == ["github", "jira"]


def test_modules_starting_with_an_underscore_are_skipped(tmp_path: Path):
    (tmp_path / "_helpers.py").write_text("X = 1\n")
    (tmp_path / "linear.py").write_text("def since(c): return 's'\ndef source(c, e, s): return s\n")
    assert [found.name for found in load_sources(tmp_path)] == ["linear"]


def test_a_module_without_since_and_source_is_rejected(tmp_path: Path):
    (tmp_path / "linear.py").write_text("def source(c, e, s): return s\n")
    with pytest.raises(ValueError, match="doesn't define since"):
        load_sources(tmp_path)


def test_a_folder_without_sources_is_rejected(tmp_path: Path):
    with pytest.raises(ValueError, match="No source modules"):
        load_sources(tmp_path)


def test_slim_pull_keeps_branch_and_repo_names_only():
    ref = {"ref": "KAFKA-1-fix", "sha": "abc", "repo": {"full_name": "a/b", "big": "x"}}
    slim = github.slim_pull({"id": 1, "title": "KAFKA-1: fix", "head": ref, "base": ref})
    assert slim["title"] == "KAFKA-1: fix"
    assert slim["head"] == {"ref": "KAFKA-1-fix", "sha": "abc", "repo": "a/b"}


def test_slim_pull_handles_a_deleted_fork():
    slim = github.slim_pull({"id": 1, "head": {"ref": "x", "sha": "a", "repo": None}, "base": {}})
    assert slim["head"]["repo"] is None


def test_github_requires_a_token():
    with pytest.raises(ValueError, match="GITHUB_TOKEN"):
        github.config(["a/b"], {})


def test_github_repos_share_one_table_under_distinct_resources():
    resources = github.config(["a/b-c", "d/e"], ENV)["resources"]
    assert [r["name"] for r in resources] == ["github_pulls_a_b_c", "github_pulls_d_e"]
    assert {r["table_name"] for r in resources} == {"github_pulls"}


def test_a_full_github_run_pages_by_creation_date():
    endpoint = github.config(["a/b"], ENV)["resources"][0]["endpoint"]
    assert endpoint["params"]["sort"] == "created"
    assert "incremental" not in endpoint


def test_an_incremental_github_run_pages_newest_updated_first_and_stops_at_the_cursor():
    endpoint = github.config(["a/b"], ENV, "2026-11-10T11:00:00Z")["resources"][0]["endpoint"]
    assert endpoint["params"] | {"sort": "updated", "direction": "desc"} == endpoint["params"]
    assert endpoint["incremental"] == {
        "cursor_path": "updated_at",
        "initial_value": "2026-11-10T11:00:00Z",
        "row_order": "desc",
    }


def test_cursors_reach_back_past_the_last_run_start():
    assert SOURCES["github"].since(NOW) == "2026-11-11T11:00:00Z"
    assert SOURCES["jira"].since(NOW) == "2026-11-10 12:00"


def test_server_jira_is_anonymous_without_a_token():
    assert "auth" not in jira.config(SERVER, {})["client"]


def test_server_jira_uses_v2_offset_paging():
    endpoint = jira.config(SERVER, {})["resources"][0]["endpoint"]
    assert endpoint["path"] == "rest/api/2/search"
    assert endpoint["paginator"]["offset_param"] == "startAt"


def test_cloud_jira_uses_v3_cursor_paging():
    env = {"JIRA_EMAIL": "e", "JIRA_API_TOKEN": "t"}
    endpoint = jira.config(CLOUD, env)["resources"][0]["endpoint"]
    assert endpoint["path"] == "rest/api/3/search/jql"
    assert endpoint["paginator"]["cursor_param"] == "nextPageToken"


def test_cloud_jira_requires_email_and_token():
    with pytest.raises(ValueError, match="JIRA_EMAIL"):
        jira.auth("cloud", {"JIRA_API_TOKEN": "t"})


def test_unknown_jira_flavor_is_rejected():
    with pytest.raises(ValueError, match="flavor"):
        jira.config({**SERVER, "flavor": "other"}, {})


@pytest.mark.parametrize(
    ("jql", "expected"),
    [
        ("project = A ORDER BY key ASC", '(project = A) AND updated >= "S" ORDER BY key ASC'),
        ("project = A or project = B", '(project = A or project = B) AND updated >= "S"'),
        ("order by key", 'updated >= "S" ORDER BY key'),
        ("", 'updated >= "S"'),
    ],
)
def test_incremental_jql_narrows_the_clients_query_and_keeps_its_order(jql, expected):
    assert jira.incremental_jql(jql, "S") == expected
    assert jira.incremental_jql(jql, None) == jql


def test_an_incremental_jira_run_filters_on_updated():
    params = jira.config(SERVER, {}, "2026-11-10 12:00")["resources"][0]["endpoint"]["params"]
    assert params["jql"] == '(project = A) AND updated >= "2026-11-10 12:00"'


def test_each_source_names_its_dlt_source_after_itself():
    client = {"client": "acme", "github": {"repos": ["a/b"]}, "jira": SERVER}
    assert SOURCES["github"].source(client, ENV, None).name == "github"
    assert SOURCES["jira"].source(client, {}, None).name == "jira"
