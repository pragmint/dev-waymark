import json
from pathlib import Path

import pyarrow as pa
import pyarrow.parquet as pq
import pytest

from runner import Job, run_jobs
from verify import JSON_SEED, Finding, perturb_json, verify_job

CLIENT = {
    "client": "test",
    "jira": {"base_url": "https://jira.example.org/"},
    "mapping": {"ticket_key_pattern": "KAFKA-[0-9]+"},
}

ITEMS = [
    {"id": 1, "name": "one", "size": 10, "payload": json.dumps({"a": {"b": 1}, "c": "x"}),
     "_dlt_id": "i1"},
    {"id": 2, "name": "two", "size": 20, "payload": json.dumps({"a": {"b": 2}, "c": "y"}),
     "_dlt_id": "i2"},
    # A null on the way to a declared path.
    {"id": 3, "name": "three", "size": 30, "payload": json.dumps({"a": None, "c": "z"}),
     "_dlt_id": "i3"},
]  # fmt: skip

ROW = "stable_id('item', id) as _row_id, [source_ref('raw.items', _dlt_id)] as _sources"


def item_job(name: str, select: str, columns: dict) -> Job:
    return Job(name, ("raw.items",), f"select {ROW}, {select} from raw.items", None, columns)


GOOD = item_job(
    "good",
    "name, json_extract_string(payload, '$.a.b') as b",
    {"name": ["raw.items.name"], "b": ["raw.items.payload:$.a.b"]},
)


@pytest.fixture
def run_root(tmp_path: Path) -> Path:
    (tmp_path / "raw" / "items").mkdir(parents=True)
    pq.write_table(pa.Table.from_pylist(ITEMS), tmp_path / "raw" / "items" / "load.parquet")
    return tmp_path


def verify(run_root: Path, *jobs: Job) -> dict[Finding, list[int]]:
    """Build every job, then check the last one."""
    assert set(run_jobs(list(jobs), CLIENT, run_root).values()) == {"built"}
    return verify_job(jobs[-1], CLIENT, run_root, per_branch=5)[1]


def details(found: dict[Finding, list[int]]) -> set[tuple[str, str | None, str]]:
    return {(f.check, f.column, f.detail) for f in found}


def test_a_correct_map_passes(run_root):
    assert verify(run_root, GOOD) == {}


def test_reports_a_column_the_map_leaves_out(run_root):
    job = item_job("labels", "name || size as label", {"label": ["raw.items.name"]})
    assert details(verify(run_root, job)) == {
        ("undeclared", "label", "changes with raw.items.size")
    }


def test_narrows_an_undeclared_json_path(run_root):
    job = item_job(
        "paths",
        "json_extract_string(payload, '$.a.b') || json_extract_string(payload, '$.c') as v",
        {"v": ["raw.items.payload:$.a.b"]},
    )
    assert ("undeclared", "v", "changes with raw.items.payload:$.c") in details(verify(run_root, job))


def test_warns_about_a_reference_nothing_reads(run_root):
    job = item_job("extra", "name", {"name": ["raw.items.name", "raw.items.size"]})
    found = verify(run_root, job)
    assert details(found) == {("unused", "name", "never changed by raw.items.size")}
    assert all(f.level == "warning" for f in found)


def test_a_null_parent_of_a_declared_path_still_counts_as_read(run_root):
    found = verify(run_root, GOOD)
    assert not any(f.check == "unused" for f in found)


def test_a_row_that_does_not_list_all_its_inputs_fails_replay(run_root):
    total = Job(
        "total",
        ("good",),
        """
        select stable_id('total', 'all') as _row_id,
          [source_ref('good', min(_row_id))] as _sources,
          count(*) as items
        from good
        """,
        None,
        {"items": ["good._row_id"]},
    )
    (finding,) = verify(run_root, GOOD, total)
    assert finding.check == "replay"
    assert "reproduced with all of good" in finding.detail


def test_checks_each_branch_of_a_keyed_column(run_root):
    keyed = Job(
        "keyed",
        ("raw.items",),
        f"""
        select stable_id('kv', id || ':' || k) as _row_id,
          [source_ref('raw.items', _dlt_id)] as _sources, k as key, v as value
        from (
          select *, unnest([{{'k': 'name', 'v': name}}, {{'k': 'size', 'v': cast(size as varchar)}}],
            recursive := true)
          from raw.items
        )
        """,
        None,
        {
            "key": [],
            # Wrong for `size`: its value comes from raw.items.size.
            "value": {"by": "key", "when": {"name": ["raw.items.name"], "size": ["raw.items.name"]}},
        },
    )
    assert details(verify(run_root, keyed)) == {
        ("undeclared", "value", "changes with raw.items.size"),
        ("unused", "value", "never changed by raw.items.name"),
    }


def test_perturb_json_grows_a_null_parent_into_the_declared_path():
    selected = lambda p: p == "$.a.b"  # noqa: E731
    assert perturb_json({"a": None}, "null", selected, grow="$.a.b") == {"a": {"b": JSON_SEED}}
    assert perturb_json({"a": {"b": 1}}, "shift", selected, grow="$.a.b") == {"a": {"b": 2}}
