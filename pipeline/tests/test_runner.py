import json
from pathlib import Path

import pyarrow as pa
import pyarrow.parquet as pq
import pytest

from runner import (
    JOBS_DIR,
    ContractError,
    Job,
    build_order,
    connect,
    contract_errors,
    load_jobs,
    run_job,
    run_jobs,
)
from trace import trace

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
        (directory / "job.toml").write_text('inputs = ["raw.jira_issues"]')
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
    assert sources == ["changes", "tickets"]


def test_trace_follows_a_metadata_value_back_to_raw(built, run_root: Path):
    (row_id,) = built.sql("""
        SELECT m._row_id FROM entity_metadata AS m JOIN entities ON entities.id = m.entity_id
        WHERE entities.name = 'KAFKA-1' AND m.key = 'change_count'
    """).fetchone()
    hops = trace(run_root / "tables", "entity_metadata", str(row_id))
    assert set(hops[1]) == {"tickets", "changes"}
    assert hops[-1] == {"raw.jira_issues": {"j1-new"}, "raw.github_pulls": {"p10"}}
