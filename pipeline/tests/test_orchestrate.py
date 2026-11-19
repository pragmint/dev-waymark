"""The job registry (registry.py), reusing unchanged tables (runner.py), and run, preview and
promote (orchestrate.py), on a local bucket.

verify.py is stubbed out: these tests are about what gets built, and replaying the shared jobs
takes most of a minute per snapshot. test_runner.py checks that they verify.
"""

import json
from pathlib import Path

import pytest

import registry
import snapshot as snapshots
import verify
from orchestrate import Bucket, preview, promote, run
from registry import Registries
from runner import JOBS_DIR, build_snapshot, job_version, load_jobs, params_version
from snapshot import Run, Snapshot
from test_runner import CLIENT, ISSUES, RUN, TYPED_PULLS, write_raw
from verify import built_jobs

# Every entity's name, row for row: a client job small enough to write here, and to break.
NAMES_SQL = """
select _row_id, [source_ref('entities', _row_id)] as _sources,
  map {'name': ['entities.name']} as _fields, name
from entities
"""
SHOUTED_SQL = NAMES_SQL.replace(", name\n", ", upper(name) as name\n")
BROKEN_SQL = "select 1 as name"


def write_job(parent: Path, name: str, sql: str, inputs=("entities",)) -> Path:
    folder = parent / name
    folder.mkdir(parents=True, exist_ok=True)
    (folder / "job.toml").write_text(f"inputs = {json.dumps(list(inputs))}\n")
    (folder / "query.sql").write_text(sql)
    return folder


@pytest.fixture(autouse=True)
def verified(monkeypatch: pytest.MonkeyPatch) -> list[list[str]]:
    """Every call to verify_jobs, as the names of the jobs it was asked to check."""
    calls: list[list[str]] = []

    def verify_jobs(jobs, client, snapshot, per_branch=2):
        calls.append([job.name for job in jobs])
        return True

    monkeypatch.setattr(verify, "verify_jobs", verify_jobs)
    return calls


@pytest.fixture
def bucket(tmp_path: Path) -> Bucket:
    """A client root with one finished full run, and a shared registry seeded with this repo's
    shared jobs."""
    root, shared = tmp_path / "client", tmp_path / "shared"
    write_raw(root, "jira_issues", ISSUES)
    write_raw(root, "github_pulls", TYPED_PULLS)
    snapshots.save_run(str(root), Run(RUN, "full", "2026-01-10T00:00:00Z", (RUN,)))
    for folder in sorted(JOBS_DIR.iterdir()):
        registry.activate(str(shared), folder.name, registry.push(str(shared), folder))
    return Bucket(str(root), str(shared), {})


def statuses(snapshot: Snapshot) -> dict[str, str]:
    return dict(snapshot.status)


# ── Registry ──────────────────────────────────────────────────────────────────


def test_a_version_is_the_hash_of_the_jobs_files_and_pushing_it_again_is_a_no_op(tmp_path: Path):
    root = str(tmp_path / "registry")
    folder = write_job(tmp_path / "jobs", "names", NAMES_SQL)
    version = registry.push(root, folder)
    assert version == job_version(folder)
    assert registry.push(root, folder) == version
    assert registry.versions(root, "names") == [version]
    assert registry.active(root, "names") is None  # pushing doesn't activate


def test_a_registry_wont_hand_back_files_that_dont_match_their_version(tmp_path: Path):
    root = tmp_path / "registry"
    version = registry.push(str(root), write_job(tmp_path / "jobs", "names", NAMES_SQL))
    (root / "jobs/names/versions" / version / "query.sql").write_text(SHOUTED_SQL)
    with Registries([str(root)]) as found, pytest.raises(ValueError, match="doesn't hash"):
        found.job("names", version)


def test_activate_refuses_a_version_the_registry_doesnt_have(tmp_path: Path):
    with pytest.raises(ValueError, match="no version"):
        registry.activate(str(tmp_path), "names", "0123456789abcdef")


def test_a_client_job_replaces_the_shared_one_and_an_inactive_job_is_left_out(tmp_path: Path):
    shared, client = str(tmp_path / "shared"), str(tmp_path / "client")
    jobs = tmp_path / "jobs"
    theirs = registry.push(shared, write_job(jobs / "a", "names", NAMES_SQL))
    registry.activate(shared, "names", theirs)
    mine = registry.push(client, write_job(jobs / "b", "names", SHOUTED_SQL))
    registry.push(client, write_job(jobs / "c", "unused", NAMES_SQL))
    with Registries([shared, client]) as found:
        assert [(j.name, j.sql) for j in found.active_jobs()] == [("names", NAMES_SQL.strip())]
        registry.activate(client, "names", mine)
        assert [(j.name, j.version) for j in found.active_jobs()] == [("names", mine)]


# ── Reuse ─────────────────────────────────────────────────────────────────────


def build(bucket: Bucket, snapshot_id: str, jobs=None, reuse=True, client=CLIENT) -> Snapshot:
    base = snapshots.published(bucket.root, bucket.env)
    snap = snapshots.start(bucket.root, [RUN], snapshot_id, bucket.env, base)
    assert build_snapshot(jobs or load_jobs([JOBS_DIR]), client, snap, reuse=reuse)
    snapshots.publish(snap)
    return snapshots.load(bucket.root, snapshot_id, bucket.env)


def test_a_table_that_would_come_out_the_same_is_reused_with_an_empty_change_file(
    bucket: Bucket, verified: list[list[str]]
):
    first = build(bucket, "s1")
    second = build(bucket, "s2")
    assert set(statuses(second).values()) == {"reused"}
    assert verified[-1] == []  # each was verified in the snapshot that built it
    for name, entry in second.tables.items():
        if name.startswith("raw."):
            continue
        assert entry["files"] == first.tables[name]["files"]
        assert entry["built_in"] == "s1"
        assert (entry["changes"]["added"], entry["changes"]["changed"]) == (0, 0)
        assert Path(second.url(entry["changes"]["file"])).is_file()
    # A chain of reuses still names the snapshot that built the files.
    assert build(bucket, "s3").tables["entities"]["built_in"] == "s1"


def test_a_new_job_version_rebuilds_that_table_and_what_reads_it(bucket: Bucket, tmp_path: Path):
    jobs = load_jobs([JOBS_DIR])
    names = write_job(tmp_path / "a", "names", NAMES_SQL).parent
    shouted = write_job(tmp_path / "b", "names", SHOUTED_SQL).parent
    build(bucket, "s1", jobs + load_jobs([names]))
    second = build(bucket, "s2", jobs + load_jobs([shouted]))
    assert statuses(second)["names"] == "built"
    assert {s for name, s in statuses(second).items() if name != "names"} == {"reused"}

    # A new version of entities, which every other job reads, rebuilds them all.
    changed = tmp_path / "c"
    for folder in JOBS_DIR.iterdir():
        target = changed / folder.name
        target.mkdir(parents=True)
        for file in folder.iterdir():
            target.joinpath(file.name).write_bytes(file.read_bytes())
    (changed / "entities" / "query.sql").write_text(
        (JOBS_DIR / "entities" / "query.sql").read_text() + "\n-- a comment is a new version\n"
    )
    third = build(bucket, "s3", load_jobs([changed]))
    assert set(statuses(third).values()) == {"built"}


def test_new_parameters_or_an_unverified_base_rebuild_everything(bucket: Bucket):
    build(bucket, "s1")
    shouted = {**CLIENT, "mapping": {**CLIENT["mapping"], "statuses": {"In Progress": "Busy"}}}
    assert params_version(shouted) != params_version(CLIENT)
    assert set(statuses(build(bucket, "s2", client=shouted)).values()) == {"built"}

    # s2 is published but not verified, so nothing is taken from it.
    manifest = Path(bucket.root, "snapshots/s2.json")
    manifest.write_text(manifest.read_text().replace('"verified": true', '"verified": null'))
    assert set(statuses(build(bucket, "s3", client=shouted)).values()) == {"built"}


def test_rebuild_builds_everything(bucket: Bucket):
    build(bucket, "s1")
    assert set(statuses(build(bucket, "s2", reuse=False)).values()) == {"built"}


# ── Run, preview, promote ─────────────────────────────────────────────────────


def test_run_builds_the_last_extract_from_the_registry_then_reuses_it(bucket: Bucket):
    first = run(CLIENT, bucket, extract="none", snapshot_id="s1")
    assert first is not None and set(statuses(first).values()) == {"built"}
    assert snapshots.published(bucket.root, {}).id == "s1"
    second = run(CLIENT, bucket, extract="none", snapshot_id="s2")
    assert second is not None and set(statuses(second).values()) == {"reused"}
    assert snapshots.published(bucket.root, {}).id == "s2"


def test_run_refuses_an_empty_registry(tmp_path: Path, bucket: Bucket):
    empty = Bucket(bucket.root, str(tmp_path / "nothing"), {})
    with pytest.raises(ValueError, match="No active jobs"):
        run(CLIENT, empty, extract="none")


def test_a_preview_is_saved_but_never_published(bucket: Bucket, tmp_path: Path):
    run(CLIENT, bucket, extract="none", snapshot_id="s1")
    version = registry.push(bucket.root, write_job(tmp_path, "names", NAMES_SQL))
    snapshot, ok = preview(CLIENT, bucket, "names", version, snapshot_id="p1")
    assert ok
    assert statuses(snapshot)["names"] == "built"
    assert snapshots.published(bucket.root, {}).id == "s1"
    assert snapshots.load(bucket.root, "p1", {}).preview == {"job": "names", "version": version}
    with pytest.raises(ValueError, match="never published"):
        snapshots.publish(snapshot)
    assert registry.active(bucket.root, "names") is None


def test_promote_activates_only_a_version_whose_preview_passed(bucket: Bucket, tmp_path: Path):
    run(CLIENT, bucket, extract="none", snapshot_id="s1")
    broken = registry.push(bucket.root, write_job(tmp_path / "a", "names", BROKEN_SQL))
    assert not promote(CLIENT, bucket, "names", broken)
    assert registry.active(bucket.root, "names") is None

    good = registry.push(bucket.root, write_job(tmp_path / "b", "names", NAMES_SQL))
    assert promote(CLIENT, bucket, "names", good)
    assert registry.active(bucket.root, "names") == good
    # The next run builds only the promoted job; the shared jobs come from s1.
    after = run(CLIENT, bucket, extract="none", snapshot_id="s2")
    assert after is not None
    assert statuses(after)["names"] == "built"
    assert {s for name, s in statuses(after).items() if name != "names"} == {"reused"}


def test_promote_needs_the_version_in_the_registry_it_activates_in(bucket: Bucket, tmp_path: Path):
    version = registry.push(bucket.shared, write_job(tmp_path, "names", NAMES_SQL))
    with pytest.raises(ValueError, match="push it there first"):
        promote(CLIENT, bucket, "names", version)  # it's only in the shared registry


def test_verify_can_load_the_versions_a_snapshot_was_built_with(bucket: Bucket, tmp_path: Path):
    run(CLIENT, bucket, extract="none", snapshot_id="s1")
    good = registry.push(bucket.root, write_job(tmp_path, "names", NAMES_SQL))
    registry.activate(bucket.root, "names", good)
    snap = run(CLIENT, bucket, extract="none", snapshot_id="s2")
    assert snap is not None
    with bucket.registries() as found:
        jobs = {job.name: job.version for job in built_jobs(snap, found)}
    assert jobs == {name: snap.tables[name]["job"] for name in jobs}
    assert "names" in jobs
