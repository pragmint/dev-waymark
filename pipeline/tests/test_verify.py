import json
from pathlib import Path

import pyarrow as pa
import pyarrow.parquet as pq
import pytest

import snapshot as snapshots
from runner import Job, run_jobs
from snapshot import Snapshot
from verify import JSON_SEED, Finding, perturb_json, verify_job, verify_jobs

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


def fields(columns: dict[str, list[str]]) -> str:
    """A `_fields` map literal giving every row the same references."""
    entries = ", ".join(f"'{c}': [{', '.join(repr(r) for r in refs)}]" for c, refs in columns.items())
    return f"map {{{entries}}} as _fields"


def item_job(name: str, select: str, columns: dict[str, list[str]]) -> Job:
    return Job(name, ("raw.items",), f"select {ROW}, {fields(columns)}, {select} from raw.items")


GOOD = item_job(
    "good",
    "name, json_extract_string(payload, '$.a.b') as b",
    {"name": ["raw.items.name"], "b": ["raw.items.payload:$.a.b"]},
)


@pytest.fixture
def run_root(tmp_path: Path) -> Snapshot:
    (tmp_path / "raw" / "items").mkdir(parents=True)
    pq.write_table(pa.Table.from_pylist(ITEMS), tmp_path / "raw" / "items" / "r1.1.0.parquet")
    return snapshots.start(str(tmp_path), ["r1"], "s1", {})


def verify(snap: Snapshot, *jobs: Job) -> dict[Finding, list[int]]:
    """Build every job, then check the last one."""
    assert set(run_jobs(list(jobs), CLIENT, snap).values()) == {"built"}
    return verify_job(jobs[-1], CLIENT, snap, per_branch=5)[1]


def details(found: dict[Finding, list[int]]) -> set[tuple[str, str | None, str]]:
    return {(f.check, f.column, f.detail) for f in found}


def test_correct_fields_pass(run_root):
    assert verify(run_root, GOOD) == {}


def test_reports_a_column_fields_leave_out(run_root):
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
          map {'items': ['good._row_id']} as _fields,
          count(*) as items
        from good
        """,
    )
    (finding,) = verify(run_root, GOOD, total)
    assert finding.check == "replay"
    assert "reproduced with all of good" in finding.detail


def test_checks_each_branch_of_the_query(run_root):
    keyed = Job(
        "keyed",
        ("raw.items",),
        """
        select stable_id('kv', id || ':' || k) as _row_id,
          [source_ref('raw.items', _dlt_id)] as _sources,
          -- Wrong for `size`: its value comes from raw.items.size.
          map {'key': [], 'value': ['raw.items.name']} as _fields,
          k as key, v as value
        from (
          select *, unnest([{'k': 'name', 'v': name}, {'k': 'size', 'v': cast(size as varchar)}],
            recursive := true)
          from raw.items
        )
        """,
    )
    assert details(verify(run_root, keyed)) == {
        ("undeclared", "value", "changes with raw.items.size"),
        ("unused", "value", "never changed by raw.items.name"),
    }


def test_perturb_json_grows_a_null_parent_into_the_declared_path():
    selected = lambda p: p == "$.a.b"  # noqa: E731
    assert perturb_json({"a": None}, "null", selected, grow="$.a.b") == {"a": {"b": JSON_SEED}}
    assert perturb_json({"a": {"b": 1}}, "shift", selected, grow="$.a.b") == {"a": {"b": 2}}


def test_does_not_check_a_job_whose_files_changed_since_the_build(run_root, capsys):
    job = item_job("items_copy", "name", {"name": ["raw.items.name"]})
    built = Job(job.name, job.inputs, job.sql, version="v1")
    run_jobs([built], CLIENT, run_root)
    assert verify_jobs([built], CLIENT, run_root)
    changed = Job(job.name, job.inputs, job.sql, version="v2")
    assert not verify_jobs([changed], CLIENT, run_root)
    assert "files changed since snapshot" in capsys.readouterr().out


def total_job(refs: list[str]) -> Job:
    """One row summing the size of every item but `three`."""
    return Job(
        "total",
        ("raw.items",),
        "select stable_id('total', 'all') as _row_id, "
        "list(source_ref('raw.items', _dlt_id)) as _sources, "
        f"{fields({'total': refs})}, "
        "sum(size) filter (where name <> 'three') as total from raw.items",
    )


def test_filtered_references_that_cover_every_row_read_pass(run_root):
    job = total_job(["raw.items[name=one].size", "raw.items[name=two].size", "raw.items.name"])
    assert details(verify(run_root, job)) == set()


def test_reports_a_row_a_filtered_reference_leaves_out(run_root):
    job = total_job(["raw.items[name=one].size", "raw.items.name"])
    assert details(verify(run_root, job)) == {
        ("undeclared", "total", "changes with raw.items.size outside raw.items[name=one]")
    }


def test_warns_about_a_filtered_reference_whose_rows_nothing_reads(run_root):
    refs = ["raw.items[name=one].size", "raw.items[name=two].size", "raw.items[name=three].size"]
    job = total_job([*refs, "raw.items.name"])
    assert details(verify(run_root, job)) == {
        ("unused", "total", "never changed by raw.items[name=three].size")
    }


def grouped_job(columns: dict[str, list[str]]) -> Job:
    """One row per name, identified by it: changing a name renames the row."""
    return Job(
        "by_name",
        ("raw.items",),
        "select stable_id('by_name', name) as _row_id, "
        "list(source_ref('raw.items', _dlt_id)) as _sources, "
        f"{fields(columns)}, "
        "name, sum(size) as total from raw.items group by name",
    )


def test_a_grouping_key_declared_correctly_passes(run_root):
    job = grouped_job({"name": ["raw.items.name"], "total": ["raw.items.size"]})
    assert details(verify(run_root, job)) == set()


def test_reports_a_grouping_key_its_fields_leave_out(run_root):
    # Changing name gives the row a new _row_id; verify follows it there rather than taking
    # the row's absence as a dependency of its existence.
    job = grouped_job({"name": [], "total": ["raw.items.size"]})
    assert details(verify(run_root, job)) == {
        ("undeclared", "name", "changes with raw.items.name")
    }


def test_a_row_a_filter_drops_is_still_not_a_value_change(run_root):
    # Changing size drops the row from the output altogether: no row with its sources is left,
    # so it counts as the row depending on size to exist, as before.
    job = item_job("big", "name", {"name": ["raw.items.name"]}).sql.replace(
        "from raw.items", "from raw.items where size >= 10"
    )
    assert details(verify(run_root, Job("big", ("raw.items",), job))) == set()
