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
    "map {'name': ['raw.items.name']} as _fields, name from raw.items",
)


def write_raw(root: Path, table: str, run_id: str, names: list[str]) -> None:
    directory = root / "raw" / table
    directory.mkdir(parents=True, exist_ok=True)
    rows = [{"id": i, "name": n, "_dlt_id": f"{run_id}-{i}"} for i, n in enumerate(names)]
    pq.write_table(pa.Table.from_pylist(rows), directory / f"{run_id}.1.0.parquet")


def names(snap: snapshots.Snapshot, table: str) -> list[str]:
    with snap.connect() as con:
        return [n for (n,) in con.sql(f"SELECT name FROM {snap.source(table)} ORDER BY name").fetchall()]


def test_a_snapshot_reads_only_its_own_runs_raw_files(tmp_path: Path):
    write_raw(tmp_path, "items", "r1", ["a", "b"])
    write_raw(tmp_path, "items", "r2", ["c"])
    write_raw(tmp_path, "_dlt_loads", "r1", ["bookkeeping"])
    snap = snapshots.start(str(tmp_path), "r1", "s1", {})
    assert snap.tables == {"raw.items": {"files": ["raw/items/r1.1.0.parquet"]}}
    assert names(snap, "raw.items") == ["a", "b"]


def test_a_later_run_does_not_change_a_saved_snapshot(tmp_path: Path):
    # The race from the 11/9 call: raw lands between a build and its verification.
    write_raw(tmp_path, "items", "r1", ["a", "b"])
    snap = snapshots.start(str(tmp_path), "r1", "s1", {})
    assert run_jobs([COPY], CLIENT, snap) == {"copy": "built"}
    snapshots.save(snap)
    write_raw(tmp_path, "items", "r2", ["changed"])
    loaded = snapshots.load(str(tmp_path), "s1", {})
    assert names(loaded, "raw.items") == ["a", "b"]
    assert names(loaded, "copy") == ["a", "b"]


def test_tables_are_written_once_per_snapshot(tmp_path: Path):
    write_raw(tmp_path, "items", "r1", ["a"])
    first = snapshots.start(str(tmp_path), "r1", "s1", {})
    run_jobs([COPY], CLIENT, first)
    snapshots.save(first)
    second = snapshots.start(str(tmp_path), "r1", "s2", {})
    run_jobs([COPY], CLIENT, second)
    assert first.tables["copy"]["files"] == ["tables/copy/s1.parquet"]
    assert second.tables["copy"]["files"] == ["tables/copy/s2.parquet"]
    with pytest.raises(ValueError, match="already exists"):
        snapshots.start(str(tmp_path), "r1", "s1", {})


def test_load_without_an_id_reads_the_published_snapshot(tmp_path: Path):
    write_raw(tmp_path, "items", "r1", ["a"])
    for snapshot_id in ("s1", "s2"):
        snap = snapshots.start(str(tmp_path), "r1", snapshot_id, {})
        run_jobs([COPY], CLIENT, snap)
        snapshots.save(snap)
    snapshots.publish(snapshots.load(str(tmp_path), "s1", {}))
    loaded = snapshots.load(str(tmp_path), None, {})
    assert loaded.id == "s1"
    assert loaded.tables["copy"]["rows"] == 1
    assert loaded.status == {"copy": "built"}


def test_a_snapshot_needs_raw_files_from_its_run(tmp_path: Path):
    write_raw(tmp_path, "items", "r1", ["a"])
    with pytest.raises(ValueError, match="No raw files for run r2"):
        snapshots.start(str(tmp_path), "r2", "s1", {})


@pytest.mark.parametrize("bad", ["../x", "a/b", ""])
def test_ids_cannot_escape_their_folder(tmp_path: Path, bad: str):
    with pytest.raises(ValueError):
        snapshots.start(str(tmp_path), "r1", bad, {})


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
