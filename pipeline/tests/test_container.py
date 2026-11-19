import hashlib
import json
import shutil
import subprocess
import sys
from pathlib import Path

import duckdb
import pyarrow.parquet as pq
import pytest

import container
import snapshot as snapshots
import verify
from runner import (
    COLUMNS_METADATA_KEY,
    JOBS_DIR,
    build_order,
    job_params,
    load_job,
    load_jobs,
    run_jobs,
)
from snapshot import Snapshot
from test_runner import CLIENT, ISSUES, RUN, TYPED_PULLS, write_raw
from verify import verify_job

FAKE_DOCKER = Path(__file__).parent / "fake_docker.py"
LEAD_TIME_IMAGE = Path(__file__).parent.parent / "containers" / "lead-time"
IMAGE = "sha256:" + "a" * 64

# One row per entity type, counting them. A correct container job, in SQL for the fake runtime.
COUNT_BY_TYPE = """
    select
      (hash(type) & 9007199254740991)::bigint as _row_id,
      list({'table': 'entities', 'row_id': cast(_row_id as varchar)}) as _sources,
      map {'type': ['entities.type'], 'entities': ['entities._row_id']} as _fields,
      type,
      count(*) as entities
    from entities group by type order by type
"""


class FakeDocker:
    def __init__(self, root: Path):
        self.images = root / "images"
        self.images.mkdir()
        self.log = root / "docker.log"
        self.log.touch()

    def image(self, sql: str) -> str:
        """An image id that runs `sql` over the job's inputs."""
        digest = hashlib.sha256(sql.encode()).hexdigest()
        (self.images / f"{digest}.sql").write_text(sql)
        return f"sha256:{digest}"

    def calls(self) -> list[dict]:
        return [json.loads(line) for line in self.log.read_text().splitlines()]


@pytest.fixture
def fake_docker(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> FakeDocker:
    fake = FakeDocker(tmp_path)
    script = tmp_path / "docker"
    script.write_text(f'#!/bin/sh\nexec "{sys.executable}" "{FAKE_DOCKER}" "$@"\n')
    script.chmod(0o755)
    monkeypatch.setenv("WAYMARK_DOCKER", str(script))
    monkeypatch.setenv("FAKE_DOCKER_JOBS", str(fake.images))
    monkeypatch.setenv("FAKE_DOCKER_LOG", str(fake.log))
    return fake


def container_job(jobs_dir: Path, name: str, image: str, inputs=("entities",)) -> Path:
    directory = jobs_dir / name
    directory.mkdir(parents=True)
    (directory / "job.toml").write_text(
        f'kind = "container"\nimage = "{image}"\ninputs = {json.dumps(list(inputs))}\n'
    )
    return directory


def typed_snapshot(root: Path, snapshot_id: str = "s1", base: Snapshot | None = None) -> Snapshot:
    write_raw(root, "jira_issues", ISSUES)
    write_raw(root, "github_pulls", TYPED_PULLS)
    return snapshots.start(str(root), [RUN], snapshot_id, {}, base)


# ── Loading ───────────────────────────────────────────────────────────────────


def test_load_job_reads_a_container_job(tmp_path: Path):
    job = load_job(container_job(tmp_path, "counts", IMAGE))
    assert (job.kind, job.image, job.inputs, job.sql) == ("container", IMAGE, ("entities",), "")


@pytest.mark.parametrize(
    "image",
    ["node:22", "ghcr.io/acme/job:latest", "sha256:abc", "ghcr.io/acme/job@sha256:" + "A" * 64],
)
def test_load_job_refuses_an_image_not_pinned_by_digest(tmp_path: Path, image: str):
    with pytest.raises(ValueError, match="pinned by digest"):
        load_job(container_job(tmp_path, "counts", image))


def test_load_job_accepts_a_registry_image_pinned_by_digest(tmp_path: Path):
    image = "ghcr.io/acme/lead-time@sha256:" + "0" * 64
    assert load_job(container_job(tmp_path, "counts", image)).image == image


@pytest.mark.parametrize(
    "toml, sql, problem",
    [
        (f'kind = "container"\nimage = "{IMAGE}"\ninputs = []', "select 1", "no query.sql"),
        (f'image = "{IMAGE}"\ninputs = []', "select 1", "only for container jobs"),
        ('kind = "python"\ninputs = []', "select 1", "kind must be one of"),
    ],
)
def test_load_job_refuses_a_job_that_mixes_kinds(tmp_path: Path, toml: str, sql: str, problem):
    directory = tmp_path / "counts"
    directory.mkdir()
    (directory / "job.toml").write_text(toml)
    (directory / "query.sql").write_text(sql)
    with pytest.raises(ValueError, match=problem):
        load_job(directory)


def test_a_container_jobs_version_changes_with_its_image(tmp_path: Path):
    first = load_job(container_job(tmp_path / "a", "counts", IMAGE))
    second = load_job(container_job(tmp_path / "b", "counts", "sha256:" + "b" * 64))
    assert first.version != second.version


def test_the_container_runs_without_network_or_write_access_to_its_inputs(tmp_path: Path):
    command = container.docker_command(IMAGE, tmp_path, {"WAYMARK_OUTPUT": "/waymark/out/x"})
    text = " ".join(command)
    assert "--network none" in text
    assert "--read-only" in text
    assert f"{tmp_path / 'in'}:/waymark/in:ro" in text
    assert command[-1] == IMAGE


def test_job_params_give_a_container_what_a_sql_job_gets():
    assert job_params(CLIENT) == {
        "client": "test",
        "jira_base_url": "https://jira.example.org",
        "ticket_key_pattern": "KAFKA-[0-9]+",
        "statuses": {"In Progress": "Doing"},
        "jira_fields": [{"key": "votes", "path": "$.votes.votes", "value_type": "number"}],
    }


# ── Building ──────────────────────────────────────────────────────────────────


def test_a_container_job_builds_like_a_sql_job(tmp_path: Path, fake_docker: FakeDocker):
    snap = typed_snapshot(tmp_path / "bucket")
    container_job(tmp_path / "jobs", "counts", fake_docker.image(COUNT_BY_TYPE))
    statuses = run_jobs(load_jobs([JOBS_DIR, tmp_path / "jobs"]), CLIENT, snap)
    assert statuses["counts"] == "built"

    with snap.connect() as con:
        rows = con.sql(f"SELECT type, entities FROM {snap.source('counts')} ORDER BY type")
        assert rows.fetchall() == [("change", 3), ("ticket", 3)]
    metadata = pq.read_metadata(snap.url(snap.tables["counts"]["files"][0])).metadata
    assert json.loads(metadata[COLUMNS_METADATA_KEY.encode()]) == {
        "entities": ["entities._row_id"],
        "type": ["entities.type"],
    }
    (call,) = fake_docker.calls()
    # It sees only its declared inputs, and the client's parameters.
    assert list(json.loads(call["WAYMARK_INPUTS"])) == ["entities"]
    assert json.loads(call["WAYMARK_PARAMS"])["client"] == "test"
    assert json.loads(call["WAYMARK_CHANGES"]) == {}


def test_a_container_job_that_breaks_the_contract_is_not_written(
    tmp_path: Path, fake_docker: FakeDocker
):
    no_sources = COUNT_BY_TYPE.replace(
        "list({'table': 'entities', 'row_id': cast(_row_id as varchar)})",
        "[]::STRUCT(\"table\" VARCHAR, row_id VARCHAR)[]",
    )
    snap = typed_snapshot(tmp_path / "bucket")
    container_job(tmp_path / "jobs", "counts", fake_docker.image(no_sources))
    container_job(tmp_path / "jobs", "downstream", fake_docker.image("select 1"), ["counts"])
    statuses = run_jobs(load_jobs([JOBS_DIR, tmp_path / "jobs"]), CLIENT, snap)
    assert (statuses["counts"], statuses["downstream"]) == ("failed", "skipped")
    assert "counts" not in snap.tables


def test_a_container_that_exits_with_an_error_fails_its_job(
    tmp_path: Path, fake_docker: FakeDocker, capsys: pytest.CaptureFixture
):
    snap = typed_snapshot(tmp_path / "bucket")
    container_job(tmp_path / "jobs", "counts", IMAGE)  # the fake has no such image
    statuses = run_jobs(load_jobs([JOBS_DIR, tmp_path / "jobs"]), CLIENT, snap)
    assert statuses["counts"] == "failed"
    assert "container exited with 1: no such job" in capsys.readouterr().err


def test_a_container_job_gets_the_change_files_of_its_inputs(
    tmp_path: Path, fake_docker: FakeDocker
):
    # Counts how many entities changed since the base, from the change file the runner passes.
    changed = """
        select 1::bigint as _row_id,
          list({'table': 'entities', 'row_id': cast(_row_id as varchar)}) as _sources,
          map {'entities': ['entities._row_id']} as _fields,
          (select count(*) from changes_entities) as entities
        from entities
    """
    jobs = tmp_path / "jobs"
    container_job(jobs, "changed", fake_docker.image(changed))
    first = typed_snapshot(tmp_path / "bucket")
    container_job(tmp_path / "first-jobs", "changed", fake_docker.image(COUNT_BY_TYPE))
    run_jobs(load_jobs([JOBS_DIR, tmp_path / "first-jobs"]), CLIENT, first)
    snapshots.save(first)

    write_raw(tmp_path / "bucket", "jira_issues", [{**ISSUES[2], "_dlt_id": "j2-inc"}], "inc1")
    second = snapshots.start(str(tmp_path / "bucket"), [RUN, "inc1"], "s2", {}, first)
    assert run_jobs(load_jobs([JOBS_DIR, jobs]), CLIENT, second)["changed"] == "built"

    call = fake_docker.calls()[-1]
    assert list(json.loads(call["WAYMARK_CHANGES"])) == ["entities"]


# ── Verifying ─────────────────────────────────────────────────────────────────


def test_verify_passes_a_container_job_whose_fields_are_right(
    tmp_path: Path, fake_docker: FakeDocker, monkeypatch: pytest.MonkeyPatch
):
    snap = typed_snapshot(tmp_path / "bucket")
    container_job(tmp_path / "jobs", "counts", fake_docker.image(COUNT_BY_TYPE))
    jobs = {job.name: job for job in load_jobs([JOBS_DIR, tmp_path / "jobs"])}
    run_jobs(list(jobs.values()), CLIENT, snap)
    built = len(fake_docker.calls())
    lookups = []
    row = verify.Replay.row
    monkeypatch.setattr(verify.Replay, "row", lambda self, i: lookups.append(i) or row(self, i))

    checked, found = verify_job(jobs["counts"], CLIENT, snap, per_branch=2)
    assert checked == 2
    assert [f for f in found if f.level == "error"] == []
    # Perturbations that leave the inputs as they were reuse the output they already got.
    runs = len(fake_docker.calls()) - built
    assert 0 < runs < len(lookups)


def test_verify_catches_an_input_a_container_job_reads_but_does_not_declare(
    tmp_path: Path, fake_docker: FakeDocker
):
    # name_length reads entities.name but declares only entities.type.
    undeclared = """
        select
          (hash(type) & 9007199254740991)::bigint as _row_id,
          list({'table': 'entities', 'row_id': cast(_row_id as varchar)}) as _sources,
          map {'type': ['entities.type'], 'name_length': ['entities.type']} as _fields,
          type,
          sum(length(name)) as name_length
        from entities group by type
    """
    snap = typed_snapshot(tmp_path / "bucket")
    container_job(tmp_path / "jobs", "counts", fake_docker.image(undeclared))
    jobs = {job.name: job for job in load_jobs([JOBS_DIR, tmp_path / "jobs"])}
    assert run_jobs(list(jobs.values()), CLIENT, snap)["counts"] == "built"

    _, found = verify_job(jobs["counts"], CLIENT, snap, per_branch=1)
    errors = {(f.check, f.column, f.detail) for f in found if f.level == "error"}
    assert ("undeclared", "name_length", "changes with entities.name") in errors


def test_verify_follows_a_container_row_that_a_change_renames(
    tmp_path: Path, fake_docker: FakeDocker
):
    # The row's _row_id hashes type, so changing type renames it; type still has to be declared.
    renamed = """
        select
          (hash(type) & 9007199254740991)::bigint as _row_id,
          list({'table': 'entities', 'row_id': cast(_row_id as varchar)}) as _sources,
          map {'type': [], 'entities': ['entities._row_id']} as _fields,
          type,
          count(*) as entities
        from entities group by type
    """
    snap = typed_snapshot(tmp_path / "bucket")
    container_job(tmp_path / "jobs", "counts", fake_docker.image(renamed))
    jobs = {job.name: job for job in load_jobs([JOBS_DIR, tmp_path / "jobs"])}
    assert run_jobs(list(jobs.values()), CLIENT, snap)["counts"] == "built"

    _, found = verify_job(jobs["counts"], CLIENT, snap, per_branch=1)
    errors = {(f.check, f.column, f.detail) for f in found if f.level == "error"}
    assert errors == {("undeclared", "type", "changes with entities.type")}


# ── The TypeScript example, in a real container ───────────────────────────────


def docker_available() -> bool:
    if not shutil.which("docker"):
        return False
    return subprocess.run(["docker", "info"], capture_output=True).returncode == 0


@pytest.mark.skipif(not docker_available(), reason="needs a running Docker")
def test_the_typescript_lead_time_job_matches_the_sql_job(tmp_path: Path):
    ts_jobs = tmp_path / "ts-jobs"
    subprocess.run([LEAD_TIME_IMAGE / "build.sh", ts_jobs], check=True, capture_output=True)
    sql_dirs = [JOBS_DIR, LEAD_TIME_IMAGE / "reference"]
    tables = {}
    for name, dirs in [("sql", sql_dirs), ("ts", [*sql_dirs, ts_jobs])]:
        snap = typed_snapshot(tmp_path / name)
        jobs = load_jobs(dirs)
        assert set(run_jobs(jobs, CLIENT, snap).values()) == {"built"}
        lead_time = next(job for job in jobs if job.name == "lead_time_by_issue_type")
        assert lead_time.kind == ("container" if name == "ts" else "sql")
        _, found = verify_job(lead_time, CLIENT, snap, per_branch=2)
        assert [f for f in found if f.level == "error"] == [], name
        tables[name] = duckdb.sql(f"""
            SELECT * REPLACE (list_sort(list_distinct(_sources)) AS _sources,
                              cast(_fields AS VARCHAR) AS _fields)
            FROM {snap.source("lead_time_by_issue_type")} ORDER BY _row_id
        """).fetchall()
    assert tables["ts"] == tables["sql"]
    assert len(tables["sql"]) == 1


def test_build_order_treats_a_container_job_like_any_other(tmp_path: Path):
    container_job(tmp_path, "counts", IMAGE)
    jobs = build_order(load_jobs([JOBS_DIR, tmp_path]))
    names = [job.name for job in jobs]
    assert names.index("entities") < names.index("counts")
