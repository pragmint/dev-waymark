import json
import tempfile
from datetime import UTC, datetime, timedelta, timezone
from pathlib import Path
from types import SimpleNamespace
from typing import Any

import pyarrow as pa
import pyarrow.parquet as pq
import pytest

import dlt
from dlt.destinations import filesystem

import extract as extract_module
import snapshot as snapshots
from extract import (
    adopt_run,
    extract,
    github_config,
    github_since,
    incremental_jql,
    jira_auth,
    jira_config,
    jira_since,
    mark_raw_initialized,
    new_run_id,
    plan_run,
    slim_pull,
)

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


NOW = datetime(2026, 11, 11, 12, 0, 0, tzinfo=UTC)
ENV = {"GITHUB_TOKEN": "t"}
CLIENT = {"client": "acme", "github": {"repos": ["a/b"]}, "jira": SERVER}


def test_a_full_github_run_pages_by_creation_date():
    endpoint = github_config(["a/b"], ENV)["resources"][0]["endpoint"]
    assert endpoint["params"]["sort"] == "created"
    assert "incremental" not in endpoint


def test_an_incremental_github_run_pages_newest_updated_first_and_stops_at_the_cursor():
    endpoint = github_config(["a/b"], ENV, "2026-11-10T11:00:00Z")["resources"][0]["endpoint"]
    assert endpoint["params"] | {"sort": "updated", "direction": "desc"} == endpoint["params"]
    assert endpoint["incremental"] == {
        "cursor_path": "updated_at",
        "initial_value": "2026-11-10T11:00:00Z",
        "row_order": "desc",
    }


def test_cursors_reach_back_past_the_last_run_start():
    assert github_since(NOW) == "2026-11-11T11:00:00Z"
    assert jira_since(NOW) == "2026-11-10 12:00"


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
    assert incremental_jql(jql, "S") == expected
    assert incremental_jql(jql, None) == jql


def test_an_incremental_jira_run_filters_on_updated():
    params = jira_config(SERVER, {}, "2026-11-10 12:00")["resources"][0]["endpoint"]["params"]
    assert params["jql"] == '(project = A) AND updated >= "2026-11-10 12:00"'


def save(root: Path, run_id: str, started_at: str, chain: tuple[str, ...], **extra) -> None:
    kind = "full" if len(chain) == 1 else "incremental"
    snapshots.save_run(str(root), snapshots.Run(run_id, kind, started_at, chain, **extra))


def test_a_full_run_starts_a_new_chain(tmp_path: Path):
    run, cursor = plan_run(str(tmp_path), "r1", NOW, full=True, limited=False)
    assert (run.kind, run.chain, run.started_at, cursor) == (
        "full", ("r1",), "2026-11-11T12:00:00Z", None,
    )  # fmt: skip


def test_an_incremental_run_needs_a_run_to_continue_from(tmp_path: Path):
    with pytest.raises(ValueError, match="--full"):
        plan_run(str(tmp_path), "r1", NOW, full=False, limited=False)


def test_an_incremental_run_extends_the_last_complete_runs_chain(tmp_path: Path):
    save(tmp_path, "r1", "2026-11-09T00:00:00Z", ("r1",))
    save(tmp_path, "r2", "2026-11-10T00:00:00Z", ("r1", "r2"))
    save(tmp_path, "smoke", "2026-11-10T06:00:00Z", ("smoke",), limited=True)
    run, cursor = plan_run(str(tmp_path), "r3", NOW, full=False, limited=False)
    assert run.kind == "incremental"
    assert run.chain == ("r1", "r2", "r3")
    assert cursor == datetime(2026, 11, 10, tzinfo=UTC)


def test_a_run_cant_continue_from_one_that_started_after_it(tmp_path: Path):
    save(tmp_path, "r1", "2026-11-12T00:00:00Z", ("r1",))
    with pytest.raises(ValueError, match="started at or after"):
        plan_run(str(tmp_path), "r2", NOW, full=False, limited=False)


class FakeSource(str):
    def add_limit(self, _pages: int) -> "FakeSource":
        return self


class FakePipeline:
    """Stands in for dlt: records the configs it was asked to load, and can fail on one."""

    def __init__(self, fail_on: str | None = None) -> None:
        self.fail_on = fail_on
        self.loaded: list[str] = []
        self.last_trace = SimpleNamespace(last_normalize_info="")
        self.config = SimpleNamespace(restore_from_destination=True)

    def run(self, source: Any, **_kwargs: Any) -> None:
        if source == self.fail_on:
            raise RuntimeError(f"{source} failed")
        self.loaded.append(source)


@pytest.fixture
def fake_dlt(monkeypatch: pytest.MonkeyPatch) -> dict[str, Any]:
    seen: dict[str, Any] = {"configs": {}, "pipeline": FakePipeline()}

    def source(config: dict[str, Any], name: str, **_kwargs: Any) -> FakeSource:
        seen["configs"][name] = config
        return FakeSource(name)

    monkeypatch.setattr(extract_module, "rest_api_source", source)
    monkeypatch.setattr(extract_module.dlt, "pipeline", lambda **_kwargs: seen["pipeline"])
    return seen


def test_an_extract_records_its_run_after_every_source_loaded(tmp_path: Path, fake_dlt):
    root = str(tmp_path)
    full = extract(CLIENT, root, "r1", ENV, full=True, started_at=NOW - timedelta(days=1))
    assert full.since == {} and snapshots.load_run(root, "r1") == full
    run = extract(CLIENT, root, "r2", ENV, started_at=NOW)
    assert fake_dlt["pipeline"].loaded == ["github", "jira", "github", "jira"]
    assert run.since == {"github": "2026-11-10T11:00:00Z", "jira": "2026-11-09 12:00"}
    jql = fake_dlt["configs"]["jira"]["resources"][0]["endpoint"]["params"]["jql"]
    assert jql == '(project = A) AND updated >= "2026-11-09 12:00"'
    assert snapshots.load_run(root, "r2").chain == ("r1", "r2")
    # dlt's own cursor, restored from the bucket, would override the run record's.
    assert fake_dlt["pipeline"].config.restore_from_destination is False


def test_a_failed_extract_records_nothing(tmp_path: Path, fake_dlt):
    fake_dlt["pipeline"] = FakePipeline(fail_on="jira")
    with pytest.raises(RuntimeError):
        extract(CLIENT, str(tmp_path), "r1", ENV, full=True, started_at=NOW)
    assert snapshots.last_run(str(tmp_path)) is None


def test_a_smoke_test_run_is_recorded_as_limited(tmp_path: Path, fake_dlt):
    extract(CLIENT, str(tmp_path), "r1", ENV, max_pages=1, full=True, started_at=NOW)
    assert snapshots.load_run(str(tmp_path), "r1").limited
    assert snapshots.last_run(str(tmp_path)) is None


def test_an_extract_fails_while_another_holds_the_lock(tmp_path: Path, fake_dlt):
    root = str(tmp_path)
    with snapshots.extract_lock(root, "r1"):
        with pytest.raises(snapshots.LockHeld, match="run r1 on .* --break-lock"):
            extract(CLIENT, root, "r2", ENV, full=True, started_at=NOW)
    assert fake_dlt["pipeline"].loaded == []
    assert snapshots.last_run(root) is None


def test_an_extract_releases_the_lock_when_it_finishes_or_fails(tmp_path: Path, fake_dlt):
    root = str(tmp_path)
    extract(CLIENT, root, "r1", ENV, full=True, started_at=NOW - timedelta(days=1))
    assert snapshots.lock_holder(root) is None
    fake_dlt["pipeline"] = FakePipeline(fail_on="jira")
    with pytest.raises(RuntimeError):
        extract(CLIENT, root, "r2", ENV, started_at=NOW)
    assert snapshots.lock_holder(root) is None


def test_a_broken_lock_is_not_released_by_its_old_holder(tmp_path: Path):
    root = str(tmp_path)
    old, new = snapshots.extract_lock(root, "r1"), snapshots.extract_lock(root, "r2")
    old.__enter__()
    assert snapshots.break_lock(root)["run"] == "r1"
    new.__enter__()
    old.__exit__(None, None, None)  # r1 finishing late must leave r2's lock alone
    assert snapshots.lock_holder(root)["run"] == "r2"
    new.__exit__(None, None, None)
    assert snapshots.lock_holder(root) is None
    assert snapshots.break_lock(root) is None


def test_a_held_lock_has_no_run_record_name(tmp_path: Path):
    """The lock lives beside the run records, and must never be read as one."""
    root = str(tmp_path)
    snapshots.save_run(root, snapshots.Run("r1", "full", "2026-11-10T00:00:00Z", ("r1",)))
    with snapshots.extract_lock(root, "r2"):
        assert snapshots.last_run(root).id == "r1"


def test_adopting_an_old_run_records_it_as_full_from_its_id(tmp_path: Path):
    directory = tmp_path / "raw" / "jira_issues"
    directory.mkdir(parents=True)
    pq.write_table(pa.table({"id": [1]}), directory / "20261102T000000Z.1.0.parquet")
    run = adopt_run(str(tmp_path), "20261102T000000Z")
    assert (run.kind, run.started_at) == ("full", "2026-11-02T00:00:00Z")
    with pytest.raises(ValueError, match="already has a record"):
        adopt_run(str(tmp_path), "20261102T000000Z")
    with pytest.raises(ValueError, match="No raw files"):
        adopt_run(str(tmp_path), "20261101T000000Z")
    with pytest.raises(ValueError, match="isn't a UTC time"):
        adopt_run(str(tmp_path), "legacy")


def copied_in_raw(root: Path) -> None:
    """A bucket whose raw was copied in by hand rather than extracted: no dlt `init` marker."""
    directory = root / "raw" / "jira_issues"
    directory.mkdir(parents=True)
    pq.write_table(pa.table({"id": [1]}), directory / "20261102T000000Z.1.0.parquet")


def load_with_dlt(root: Path) -> None:
    pipeline = dlt.pipeline(
        pipeline_name="copied_in",
        pipelines_dir=tempfile.mkdtemp(prefix="waymark-dlt-test-"),
        destination=filesystem(bucket_url=f"file://{root}", layout=extract_module.RAW_LAYOUT,
                               extra_placeholders={"run_id": "20261111T000000Z"}),
        dataset_name="raw",
    )
    pipeline.config.restore_from_destination = False
    pipeline.run([{"id": 2}], table_name="jira_issues", loader_file_format="parquet")


def test_dlt_cant_load_into_raw_copied_in_without_its_marker(tmp_path: Path):
    copied_in_raw(tmp_path)
    with pytest.raises(Exception, match="File exists"):
        load_with_dlt(tmp_path)


def test_marking_raw_initialized_lets_dlt_load_into_copied_in_raw(tmp_path: Path):
    copied_in_raw(tmp_path)
    assert mark_raw_initialized(str(tmp_path))
    marker = json.loads((tmp_path / "raw" / "init").read_text())
    assert marker == {"initial_version": 2, "current_version": 2}
    load_with_dlt(tmp_path)
    files = sorted(path.name for path in (tmp_path / "raw" / "jira_issues").glob("*.parquet"))
    assert [name.split(".")[0] for name in files] == ["20261102T000000Z", "20261111T000000Z"]


def test_raw_is_marked_only_when_it_exists_without_a_marker(tmp_path: Path):
    assert not mark_raw_initialized(str(tmp_path))
    assert not (tmp_path / "raw").exists()
    copied_in_raw(tmp_path)
    (tmp_path / "raw" / "init").write_text("")
    assert not mark_raw_initialized(f"file://{tmp_path}")
    assert (tmp_path / "raw" / "init").read_text() == ""
