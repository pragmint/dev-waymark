import json
import re
from pathlib import Path

import pyarrow as pa
import pyarrow.parquet as pq
import pytest

from runner import (
    COLUMNS_METADATA_KEY,
    JOBS_DIR,
    ContractError,
    Job,
    build_order,
    column_errors,
    connect,
    contract_errors,
    load_jobs,
    parse_ref,
    run_job,
    run_jobs,
    validate_columns,
)
from trace import column_maps, raw_values, refs_for, row_values, trace, trace_field

CLIENT = {
    "client": "test",
    "jira": {"base_url": "https://jira.example.org/"},
    "mapping": {
        "ticket_key_pattern": "KAFKA-[0-9]+",
        "statuses": {"In Progress": "Doing"},
        "jira_fields": [{"key": "votes", "path": "$.votes.votes", "value_type": "number"}],
    },
}


def issue(dlt_id, load_id, issue_id, key, status, updated, **extra):
    fields = {
        "summary": f"{key} summary",
        "issuetype": {"name": "Bug"},
        "status": {"name": status, "statusCategory": {"name": "To Do"}},
        "created": "2026-01-01T00:00:00.000+0000",
        "updated": updated,
        **extra,
    }
    return {"id": issue_id, "key": key, "fields": json.dumps(fields),
            "_dlt_id": dlt_id, "_dlt_load_id": load_id}  # fmt: skip


def pull(dlt_id, load_id, pull_id, title, branch, updated, merged=None):
    return {
        "id": pull_id, "number": pull_id, "title": title, "body": None, "state": "closed",
        "draft": False, "user": json.dumps({"login": "dev"}),
        "html_url": f"https://github.com/apache/kafka/pull/{pull_id}",
        "head": json.dumps({"ref": branch}), "base": json.dumps({"repo": "apache/kafka"}),
        "created_at": "2026-01-02T00:00:00Z", "updated_at": updated, "closed_at": merged,
        "merged_at": merged, "_dlt_id": dlt_id, "_dlt_load_id": load_id,
    }  # fmt: skip


ISSUES = [
    issue("j1-old", "1", "101", "KAFKA-1", "Open", "2026-01-01T00:00:00.000+0000"),
    issue("j1-new", "2", "101", "KAFKA-1", "Resolved", "2026-01-05T00:00:00.000+0000",
          votes={"votes": 3}),  # fmt: skip
    issue("j2", "1", "102", "KAFKA-2", "In Progress", "2026-01-01T00:00:00.000+0000"),
    issue("j3", "1", "103", "KAFKA-3", "Open", "2026-01-01T00:00:00.000+0000"),
]
PULLS = [
    pull("p10", "1", 10, "KAFKA-1: fix", "feature/kafka-2_fix", "2026-01-03T00:00:00Z",
         merged="2026-01-04T00:00:00Z"),  # fmt: skip
    pull("p11", "1", 11, "Mentions KAFKA-99 only", "main", "2026-01-03T00:00:00Z"),
    pull("p12-old", "1", 12, "Draft", "wip", "2026-01-03T00:00:00Z"),
    pull("p12-new", "2", 12, "KAFKA-3 done", "wip", "2026-01-06T00:00:00Z"),
]


def write_raw(run_root: Path, table: str, rows: list[dict]) -> None:
    directory = run_root / "raw" / table
    directory.mkdir(parents=True)
    pq.write_table(pa.Table.from_pylist(rows), directory / "load.parquet")


@pytest.fixture
def run_root(tmp_path: Path) -> Path:
    write_raw(tmp_path, "jira_issues", ISSUES)
    write_raw(tmp_path, "github_pulls", PULLS)
    return tmp_path


@pytest.fixture
def built(run_root: Path):
    statuses = run_jobs(load_jobs([JOBS_DIR]), CLIENT, run_root)
    assert set(statuses.values()) == {"built"}
    con = connect(CLIENT)
    for name in statuses:
        con.execute(f"CREATE VIEW {name} AS SELECT * FROM '{run_root}/tables/{name}.parquet'")
    return con


def job(name, inputs=(), sql="select 1"):
    return Job(name, tuple(inputs), sql)


def test_build_order_puts_inputs_first():
    jobs = [job("c", ["b"]), job("b", ["a"]), job("a", ["raw.x"])]
    assert [j.name for j in build_order(jobs)] == ["a", "b", "c"]


def test_build_order_rejects_a_cycle():
    with pytest.raises(ValueError, match="cycle"):
        build_order([job("a", ["b"]), job("b", ["a"])])


def test_build_order_rejects_an_unknown_input():
    with pytest.raises(ValueError, match="unknown inputs"):
        build_order([job("a", ["missing"])])


def test_a_client_job_replaces_a_shared_job_with_the_same_name(tmp_path: Path):
    for root, sql in [("shared", "select 'shared'"), ("client", "select 'client'")]:
        directory = tmp_path / root / "tickets"
        directory.mkdir(parents=True)
        (directory / "job.toml").write_text(
            'inputs = ["raw.jira_issues"]\n[columns]\nx = ["raw.jira_issues.key"]'
        )
        (directory / "query.sql").write_text(sql)
    jobs = load_jobs([tmp_path / "shared", tmp_path / "client"])
    assert [(j.name, j.sql) for j in jobs] == [("tickets", "select 'client'")]


@pytest.mark.parametrize(
    ("result", "problem"),
    [
        ("select 1 as _row_id, [source_ref('up', 1)] as _sources", "_row_id must be BIGINT"),
        ("select 1::bigint as _row_id", "_sources must be"),
        ("select null::bigint as _row_id, [source_ref('up', 1)] as _sources",
         "rows have a null _row_id"),
        ("select 1::bigint as _row_id, [source_ref('up', 1)] as _sources from range(2)",
         "repeat another row's _row_id"),
        ("select 1::bigint as _row_id, [source_ref('up', 1)][1:0] as _sources",
         "rows have no _sources"),
        ("select 1::bigint as _row_id, [source_ref('other', 1)] as _sources",
         "names tables that are not inputs"),
        ("select 1::bigint as _row_id, [source_ref('up', 2)] as _sources",
         "point at rows missing from up"),
    ],
)  # fmt: skip
def test_contract_errors_catch_each_violation(result, problem):
    con = connect(CLIENT)
    con.execute("CREATE TABLE up AS SELECT 1::bigint AS _row_id")
    con.execute(f"CREATE TEMP TABLE result AS {result}")
    assert any(problem in error for error in contract_errors(con, ("up",)))


def test_contract_errors_pass_a_valid_table():
    con = connect(CLIENT)
    con.execute("CREATE TABLE up AS SELECT 1::bigint AS _row_id")
    con.execute("CREATE TEMP TABLE result AS SELECT 7::bigint AS _row_id, [source_ref('up', 1)] AS _sources")
    assert contract_errors(con, ("up",)) == []


def test_run_job_refuses_to_write_a_table_that_breaks_the_contract(run_root: Path):
    (run_root / "tables").mkdir()
    bad = job("bad", ["raw.jira_issues"], "select 1::bigint as _row_id")
    with pytest.raises(ContractError):
        run_job(bad, CLIENT, run_root)
    assert not (run_root / "tables" / "bad.parquet").exists()


def test_a_failed_job_skips_everything_downstream(run_root: Path):
    jobs = [job("broken", ["raw.jira_issues"], "select nope"), job("after", ["broken"])]
    statuses = run_jobs(jobs, CLIENT, run_root)
    assert statuses == {"broken": "failed", "after": "skipped"}
    assert list((run_root / "tables").iterdir()) == []


def test_tickets_keep_the_latest_version_and_point_at_its_raw_row(built):
    rows = built.sql("""
        SELECT ticket_key, status, status_group, url, _sources[1].row_id
        FROM tickets ORDER BY ticket_key
    """).fetchall()
    assert rows == [
        ("KAFKA-1", "Resolved", "To Do", "https://jira.example.org/browse/KAFKA-1", "j1-new"),
        ("KAFKA-2", "In Progress", "Doing", "https://jira.example.org/browse/KAFKA-2", "j2"),
        ("KAFKA-3", "Open", "To Do", "https://jira.example.org/browse/KAFKA-3", "j3"),
    ]


def test_every_current_raw_row_is_the_source_of_exactly_one_entity(built):
    refs = built.sql("""
        SELECT s.row_id, count(*) FROM (
          SELECT unnest(_sources) AS s FROM tickets
          UNION ALL
          SELECT unnest(_sources) FROM changes
        ) GROUP BY 1 ORDER BY 1
    """).fetchall()
    assert refs == [(i, 1) for i in ["j1-new", "j2", "j3", "p10", "p11", "p12-new"]]


def test_links_match_titles_and_underscored_branches_and_skip_unknown_tickets(built):
    links = built.sql("""
        SELECT changes.number, links.ticket_key
        FROM ticket_change_links AS links JOIN changes ON changes._row_id = links.change_id
        ORDER BY 1, 2
    """).fetchall()
    assert links == [(10, "KAFKA-1"), (10, "KAFKA-2"), (12, "KAFKA-3")]


def test_metadata_includes_custom_fields_and_rollups(built):
    values = dict(built.sql("""
        SELECT key, value FROM entity_metadata JOIN entities ON entities.id = entity_id
        WHERE entities.name = 'KAFKA-1'
    """).fetchall())
    assert values["votes"] == "3.0"
    assert values["change_count"] == "1"
    assert values["last_merged_at"] == "2026-01-04T00:00:00Z"


def test_a_rollup_is_sourced_from_the_rows_it_rolls_up(built):
    (sources,) = built.sql("""
        SELECT list_sort(list(s.table)) FROM (
          SELECT unnest(m._sources) AS s FROM entity_metadata AS m
          JOIN entities ON entities.id = m.entity_id
          WHERE entities.name = 'KAFKA-1' AND key = 'change_count'
        )
    """).fetchone()
    assert sources == ["changes", "ticket_change_links", "tickets"]


def test_trace_follows_a_metadata_value_back_to_raw(built, run_root: Path):
    (row_id,) = built.sql("""
        SELECT m._row_id FROM entity_metadata AS m JOIN entities ON entities.id = m.entity_id
        WHERE entities.name = 'KAFKA-1' AND m.key = 'change_count'
    """).fetchone()
    hops = trace(run_root / "tables", "entity_metadata", str(row_id))
    assert set(hops[1]) == {"tickets", "changes", "ticket_change_links"}
    assert hops[-1] == {"raw.jira_issues": {"j1-new"}, "raw.github_pulls": {"p10"}}


def test_parse_ref_splits_table_column_and_json_path():
    assert parse_ref("changes.merged_at") == ("changes", "merged_at", None)
    assert parse_ref("raw.jira_issues.fields:$.priority.name") == (
        "raw.jira_issues",
        "fields",
        "$.priority.name",
    )
    with pytest.raises(ValueError, match="Invalid column reference"):
        parse_ref("fields:$.priority")


@pytest.mark.parametrize(
    ("columns", "problem"),
    [
        (None, "needs a [columns] table"),
        ({"_row_id": []}, "part of the contract"),
        ({"x": ["other.y"]}, "not an input"),
        ({"x": {"when": {"a": ["up.y"]}}}, "needs `by`"),
        ({"x": "up.y"}, "must list references"),
    ],
)
def test_validate_columns_rejects_a_malformed_map(columns, problem):
    with pytest.raises(ValueError, match=re.escape(problem)):
        validate_columns("job", columns, ("up",))


@pytest.mark.parametrize(
    ("columns", "problem"),
    [
        ({}, "does not declare ['n']"),
        ({"n": ["up.y"], "extra": []}, "does not output: ['extra']"),
        ({"n": ["up.missing"]}, "up has no column missing"),
        ({"n": ["up.y:$.a"]}, "JSON path on a INTEGER column"),
        ({"n": {"by": "missing", "when": {}}}, "keyed by missing"),
    ],
)
def test_column_errors_catch_a_map_that_does_not_match_the_tables(columns, problem):
    con = connect(CLIENT)
    con.execute("CREATE TABLE up AS SELECT 1::bigint AS _row_id, 2 AS y")
    con.execute("CREATE TEMP TABLE result AS SELECT 7::bigint AS _row_id, 1 AS n")
    errors = column_errors(con, Job("j", ("up",), "", columns=columns))
    assert any(problem in error for error in errors), errors


def test_every_table_carries_its_column_map(built, run_root: Path):
    for job in load_jobs([JOBS_DIR]):
        metadata = pq.read_metadata(run_root / "tables" / f"{job.name}.parquet").metadata
        assert json.loads(metadata[COLUMNS_METADATA_KEY.encode()]) == job.columns


def metadata_row_id(built, entity_name: str, key: str) -> str:
    (row_id,) = built.sql(f"""
        SELECT m._row_id FROM entity_metadata AS m JOIN entities ON entities.id = m.entity_id
        WHERE entities.name = '{entity_name}' AND m.key = '{key}'
    """).fetchone()
    return str(row_id)


def test_refs_for_picks_the_branch_of_a_keyed_column():
    spec = {"by": "key", "when": {"a": ["t.a"]}, "else": ["t.other"]}
    assert refs_for(spec, "a") == ["t.a"]
    assert refs_for(spec, "zzz") == ["t.other"]
    assert refs_for(spec) == ["t.a", "t.other"]
    assert refs_for(["t.x"], "ignored") == ["t.x"]


def test_trace_field_follows_only_the_tables_a_field_reads(built, run_root: Path):
    # change_count is sourced from the ticket, its changes and their links, but counts only the
    # linked changes. The links lead back to the ticket only through the key that matched.
    tables = run_root / "tables"
    row_id = metadata_row_id(built, "KAFKA-1", "change_count")
    values = row_values(tables, "entity_metadata", row_id)
    field = trace_field(column_maps(tables), "entity_metadata", "value", values)
    assert field is not None
    assert field.direct == ["changes._row_id", "ticket_change_links._row_id"]
    hops = trace(tables, "entity_metadata", row_id, field.follow)
    assert set(hops[1]) == {"changes", "ticket_change_links"}
    assert hops[-1] == {"raw.jira_issues": {"j1-new"}, "raw.github_pulls": {"p10"}}


def test_trace_field_reaches_a_json_path_in_raw(built, run_root: Path):
    tables = run_root / "tables"
    row_id = metadata_row_id(built, "KAFKA-1", "status")
    values = row_values(tables, "entity_metadata", row_id)
    field = trace_field(column_maps(tables), "entity_metadata", "value", values)
    assert field is not None
    assert field.columns == {
        "tickets": {"status"},
        "raw.jira_issues": {"fields:$.status.name"},
    }
    hops = trace(tables, "entity_metadata", row_id, field.follow)
    raw_ids = hops[-1]["raw.jira_issues"]
    assert raw_values(run_root, "raw.jira_issues", "fields:$.status.name", raw_ids) == [
        values["value"]
    ]


def test_trace_field_returns_none_for_an_undeclared_field(built, run_root: Path):
    assert trace_field(column_maps(run_root / "tables"), "tickets", "nope", {}) is None
