from datetime import datetime, timedelta, timezone

import pytest

from extract import github_config, jira_auth, jira_config, new_run_id, slim_pull

SERVER = {"flavor": "server", "base_url": "https://jira.example.org/jira/", "jql": "project = A"}
CLOUD = {"flavor": "cloud", "base_url": "https://acme.atlassian.net", "jql": "project = A"}


def test_new_run_id_uses_utc():
    now = datetime(2026, 11, 2, 10, 30, 5, tzinfo=timezone(timedelta(hours=-5)))
    assert new_run_id(now) == "20261102T153005Z"


def test_slim_pull_keeps_branch_and_repo_names_only():
    ref = {"ref": "KAFKA-1-fix", "sha": "abc", "repo": {"full_name": "a/b", "big": "x"}}
    slim = slim_pull({"id": 1, "title": "KAFKA-1: fix", "head": ref, "base": ref})
    assert slim["title"] == "KAFKA-1: fix"
    assert slim["head"] == {"ref": "KAFKA-1-fix", "sha": "abc", "repo": "a/b"}


def test_slim_pull_handles_a_deleted_fork():
    slim = slim_pull({"id": 1, "head": {"ref": "x", "sha": "a", "repo": None}, "base": {}})
    assert slim["head"]["repo"] is None


def test_github_requires_a_token():
    with pytest.raises(ValueError, match="GITHUB_TOKEN"):
        github_config(["a/b"], {})


def test_github_repos_share_one_table_under_distinct_resources():
    config = github_config(["a/b-c", "d/e"], {"GITHUB_TOKEN": "t"})
    resources = config["resources"]
    assert [r["name"] for r in resources] == ["github_pulls_a_b_c", "github_pulls_d_e"]
    assert {r["table_name"] for r in resources} == {"github_pulls"}


def test_server_jira_is_anonymous_without_a_token():
    assert "auth" not in jira_config(SERVER, {})["client"]


def test_server_jira_uses_v2_offset_paging():
    endpoint = jira_config(SERVER, {})["resources"][0]["endpoint"]
    assert endpoint["path"] == "rest/api/2/search"
    assert endpoint["paginator"]["offset_param"] == "startAt"


def test_cloud_jira_uses_v3_cursor_paging():
    env = {"JIRA_EMAIL": "e", "JIRA_API_TOKEN": "t"}
    endpoint = jira_config(CLOUD, env)["resources"][0]["endpoint"]
    assert endpoint["path"] == "rest/api/3/search/jql"
    assert endpoint["paginator"]["cursor_param"] == "nextPageToken"


def test_cloud_jira_requires_email_and_token():
    with pytest.raises(ValueError, match="JIRA_EMAIL"):
        jira_auth("cloud", {"JIRA_API_TOKEN": "t"})


def test_unknown_jira_flavor_is_rejected():
    with pytest.raises(ValueError, match="flavor"):
        jira_config({**SERVER, "flavor": "other"}, {})
