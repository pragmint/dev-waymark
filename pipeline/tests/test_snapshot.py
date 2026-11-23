import json
from pathlib import Path

import pyarrow as pa
import pyarrow.parquet as pq
import pytest

import snapshot as snapshots
from runner import Job, run_jobs

CLIENT = {
    "client": "test",
    "jira": {"base_url": "https://jira.example.org/"},
    "mapping": {"ticket_key_pattern": "KAFKA-[0-9]+"},
}
COPY = Job(
    "copy",
    ("raw.items",),
    "select stable_id('item', id) as _row_id, [source_ref('raw.items', _dlt_id)] as _sources, "
    "map {'name': ['raw.items.name'], 'created_at': []} as _fields, name, "
    "'2026-01-01T00:00:00Z' as created_at from raw.items",
    entity_type="item",
)


def write_raw(
    root: Path, table: str, run_id: str, names: list[str], ids: list[int] | None = None
) -> None:
    directory = root / "raw" / table
    directory.mkdir(parents=True, exist_ok=True)
    ids = ids if ids is not None else list(range(len(names)))
    rows = [{"id": i, "name": n, "_dlt_id": f"{run_id}-{i}"} for i, n in zip(ids, names)]
    pq.write_table(pa.Table.from_pylist(rows), directory / f"{run_id}.1.0.parquet")


def names(snap: snapshots.Snapshot, table: str) -> list[str]:
    with snap.connect() as con:
        return [n for (n,) in con.sql(f"SELECT name FROM {snap.source(table)} ORDER BY name").fetchall()]


def test_a_snapshot_reads_only_its_own_runs_raw_files(tmp_path: Path):
    write_raw(tmp_path, "items", "r1", ["a", "b"])
    write_raw(tmp_path, "items", "r2", ["c"])
    write_raw(tmp_path, "_dlt_loads", "r1", ["bookkeeping"])
    snap = snapshots.start(str(tmp_path), ["r1"], "s1", {})
    assert snap.tables == {"raw.items": {"files": ["raw/items/r1.1.0.parquet"]}}
    assert names(snap, "raw.items") == ["a", "b"]


def test_a_later_run_does_not_change_a_saved_snapshot(tmp_path: Path):
    # The race from the 11/9 call: raw lands between a build and its verification.
    write_raw(tmp_path, "items", "r1", ["a", "b"])
    snap = snapshots.start(str(tmp_path), ["r1"], "s1", {})
    assert run_jobs([COPY], CLIENT, snap) == {"copy": "built"}
    snapshots.save(snap)
    write_raw(tmp_path, "items", "r2", ["changed"])
    loaded = snapshots.load(str(tmp_path), "s1", {})
    assert names(loaded, "raw.items") == ["a", "b"]
    assert names(loaded, "entities") == ["a", "b"]


def test_tables_are_written_once_per_snapshot(tmp_path: Path):
    write_raw(tmp_path, "items", "r1", ["a"])
    first = snapshots.start(str(tmp_path), ["r1"], "s1", {})
    run_jobs([COPY], CLIENT, first)
    snapshots.save(first)
    second = snapshots.start(str(tmp_path), ["r1"], "s2", {})
    run_jobs([COPY], CLIENT, second)
    assert first.jobs["copy"]["files"] == {
        "entities": "tables/entities/s1.copy.parquet",
        "entity_metadata": "tables/entity_metadata/s1.copy.parquet",
    }
    assert second.tables["entities"]["files"] == ["tables/entities/s2.copy.parquet"]
    with pytest.raises(ValueError, match="already exists"):
        snapshots.start(str(tmp_path), ["r1"], "s1", {})


def test_load_without_an_id_reads_the_published_snapshot(tmp_path: Path):
    write_raw(tmp_path, "items", "r1", ["a"])
    for snapshot_id in ("s1", "s2"):
        snap = snapshots.start(str(tmp_path), ["r1"], snapshot_id, {})
        run_jobs([COPY], CLIENT, snap)
        snapshots.save(snap)
    snapshots.publish(snapshots.load(str(tmp_path), "s1", {}))
    loaded = snapshots.load(str(tmp_path), None, {})
    assert loaded.id == "s1"
    assert loaded.jobs["copy"]["rows"] == 1
    assert loaded.status == {"copy": "built"}


def test_a_snapshot_needs_raw_files_from_its_run(tmp_path: Path):
    write_raw(tmp_path, "items", "r1", ["a"])
    with pytest.raises(ValueError, match=r"No raw files for runs \[.r2.\]"):
        snapshots.start(str(tmp_path), ["r2"], "s1", {})


@pytest.mark.parametrize("bad", ["../x", "a/b", ""])
def test_ids_cannot_escape_their_folder(tmp_path: Path, bad: str):
    with pytest.raises(ValueError):
        snapshots.start(str(tmp_path), ["r1"], bad, {})


def test_local_urls_need_no_secret():
    assert snapshots.secret_statements("file:///tmp/b", {}) == []
    assert snapshots.secret_statements("/tmp/b", {"AWS_ENDPOINT_URL": "http://x"}) == []


def test_s3_uses_the_credential_chain_and_an_explicit_endpoint():
    (statement,) = snapshots.secret_statements(
        "s3://bucket/acme",
        {"AWS_REGION": "eu-west-1", "AWS_ENDPOINT_URL": "http://localhost:9000"},
    )
    assert "PROVIDER credential_chain" in statement
    assert "REGION 'eu-west-1'" in statement
    assert "ENDPOINT 'localhost:9000'" in statement
    assert "URL_STYLE 'path'" in statement
    assert "USE_SSL false" in statement


def test_s3_on_aws_sets_no_endpoint():
    (statement,) = snapshots.secret_statements("s3://bucket", {})
    assert statement.endswith("(TYPE s3, PROVIDER credential_chain)")


def test_azure_prefers_a_connection_string():
    env = {"AZURE_STORAGE_CONNECTION_STRING": "AccountName=a;Key='x'", "AZURE_STORAGE_ACCOUNT": "a"}
    (statement,) = snapshots.secret_statements("az://container/acme", env)
    assert "CONNECTION_STRING 'AccountName=a;Key=''x'''" in statement


def test_azure_without_a_connection_string_needs_an_account():
    (statement,) = snapshots.secret_statements("az://c", {"AZURE_STORAGE_ACCOUNT": "acct"})
    assert "PROVIDER credential_chain" in statement and "ACCOUNT_NAME 'acct'" in statement
    with pytest.raises(ValueError):
        snapshots.secret_statements("az://c", {})


def build(root: Path, run_id: str, snapshot_id: str) -> snapshots.Snapshot:
    snap = snapshots.start(str(root), [run_id], snapshot_id, {})
    run_jobs([COPY], CLIENT, snap)
    snapshots.save(snap)
    return snap


def published(root: Path) -> str:
    return snapshots.load(str(root), None, {}).id


def test_a_slow_build_of_an_older_extract_does_not_replace_a_newer_one(tmp_path: Path):
    # A starts first on extract r1; B starts later on r2 and finishes first.
    write_raw(tmp_path, "items", "20261110T000000Z", ["old"])
    write_raw(tmp_path, "items", "20261111T000000Z", ["new"])
    a = build(tmp_path, "20261110T000000Z", "20261111T010000Z")
    b = build(tmp_path, "20261111T000000Z", "20261111T010500Z")
    assert snapshots.publish(b) is None
    assert snapshots.publish(a) == b.id
    assert published(tmp_path) == b.id


def test_a_newer_build_of_the_same_extract_is_published(tmp_path: Path):
    write_raw(tmp_path, "items", "r1", ["a"])
    first, second = build(tmp_path, "r1", "s1"), build(tmp_path, "r1", "s2")
    assert snapshots.publish(first) is None
    assert snapshots.publish(second) is None
    assert published(tmp_path) == "s2"
    assert snapshots.publish(second) is None  # republishing is harmless


def record(root: Path, run_id: str, started_at: str, chain: list[str], **extra) -> snapshots.Run:
    kind = "full" if len(chain) == 1 else "incremental"
    run = snapshots.Run(run_id, kind, started_at, tuple(chain), **extra)
    snapshots.save_run(str(root), run)
    return run


def test_a_run_record_round_trips(tmp_path: Path):
    run = record(tmp_path, "r2", "2026-11-11T00:00:00Z", ["r1", "r2"], since={"jira": "x"})
    assert snapshots.load_run(str(tmp_path), "r2") == run


def test_a_run_without_a_record_is_never_built(tmp_path: Path):
    write_raw(tmp_path, "items", "r1", ["a"])
    with pytest.raises(ValueError, match="no record"):
        snapshots.load_run(str(tmp_path), "r1")


def test_a_run_record_must_end_its_chain_with_itself(tmp_path: Path):
    with pytest.raises(ValueError, match="end with itself"):
        record(tmp_path, "r2", "2026-11-11T00:00:00Z", ["r1"])


def test_the_last_run_is_the_latest_started_complete_one(tmp_path: Path):
    assert snapshots.last_run(str(tmp_path)) is None
    record(tmp_path, "b", "2026-11-10T00:00:00Z", ["b"])
    record(tmp_path, "a", "2026-11-11T00:00:00Z", ["b", "a"])  # ids needn't sort by time
    record(tmp_path, "c", "2026-11-12T00:00:00Z", ["c"], limited=True)
    last = snapshots.last_run(str(tmp_path))
    assert last is not None and last.id == "a"


def test_a_snapshot_reads_every_run_in_its_chain(tmp_path: Path):
    write_raw(tmp_path, "items", "full", ["a", "b"])
    write_raw(tmp_path, "items", "older", ["not read"])
    write_raw(tmp_path, "items", "inc2", ["c"])  # inc1 changed nothing, so it wrote no files
    snap = snapshots.start(str(tmp_path), ["full", "inc1", "inc2"], "s1", {})
    assert snap.extract == "inc2"
    assert snap.tables["raw.items"]["files"] == [
        "raw/items/full.1.0.parquet",
        "raw/items/inc2.1.0.parquet",
    ]
    assert names(snap, "raw.items") == ["a", "b", "c"]
    snapshots.save(snap)
    assert snapshots.load(str(tmp_path), "s1", {}).runs == ["full", "inc1", "inc2"]


def changes(snap: snapshots.Snapshot, table: str) -> dict[int, str]:
    with snap.connect() as con:
        key = snap.jobs[table]["changes"]["file"]
        rows = con.sql(f"SELECT _row_id, change FROM read_parquet('{snap.url(key)}')").fetchall()
    return dict(rows)


def test_each_job_records_its_changes_since_the_base(tmp_path: Path):
    write_raw(tmp_path, "items", "r1", ["a", "b", "c"])  # ids 0, 1, 2
    first = snapshots.start(str(tmp_path), ["r1"], "s1", {})
    run_jobs([COPY], CLIENT, first)
    assert first.jobs["copy"]["changes"] is None  # nothing to compare with
    snapshots.save(first)

    # Fetched again: 0 is unchanged but has a new _dlt_id, 1 changed, 2 is gone and 3 is new.
    write_raw(tmp_path, "items", "r2", ["a", "B", "d"], ids=[0, 1, 3])
    second = snapshots.start(str(tmp_path), ["r2"], "s2", {}, base=first)
    run_jobs([COPY], CLIENT, second)
    entry = second.jobs["copy"]["changes"]
    assert {k: entry[k] for k in ("base", "added", "changed", "removed")} == {
        "base": "s1", "added": 1, "changed": 1, "removed": 1,
    }  # fmt: skip
    ids = {name: row_id for row_id, name in rows(second, "entities") + rows(first, "entities")}
    assert changes(second, "copy") == {ids["B"]: "changed", ids["c"]: "removed", ids["d"]: "added"}
    snapshots.save(second)
    with open(tmp_path / "snapshots" / "s2.json") as file:
        assert json.load(file)["base"] == "s1"


def rows(snap: snapshots.Snapshot, table: str) -> list[tuple[int, str]]:
    with snap.connect() as con:
        return con.sql(f"SELECT _row_id, name FROM {snap.source(table)}").fetchall()


def test_a_published_snapshot_from_an_older_pipeline_is_no_base(tmp_path: Path, capsys):
    write_raw(tmp_path, "items", "r1", ["a"])
    (tmp_path / "snapshots").mkdir()
    (tmp_path / "snapshots" / "old.json").write_text(json.dumps({"version": 1}))
    (tmp_path / "latest.json").write_text(
        json.dumps({"snapshot": "old", "manifest": "snapshots/old.json"})
    )
    assert snapshots.published(str(tmp_path), {}) is None
    assert "building without a base" in capsys.readouterr().err
