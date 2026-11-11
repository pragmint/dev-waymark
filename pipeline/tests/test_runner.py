import json
from datetime import datetime
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
    connect,
    contract_errors,
    field_errors,
    load_job,
    load_jobs,
    parse_ref,
    run_job,
    run_jobs,
)
import snapshot as snapshots
from snapshot import Snapshot
from trace import column_maps, raw_values, row_values, trace, trace_field
from verify import verify_job

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


RUN = "r1"


def write_raw(root: Path, table: str, rows: list[dict], run_id: str = RUN) -> None:
    directory = root / "raw" / table
    directory.mkdir(parents=True, exist_ok=True)
    pq.write_table(pa.Table.from_pylist(rows), directory / f"{run_id}.1.0.parquet")


@pytest.fixture
def snap(tmp_path: Path) -> Snapshot:
    write_raw(tmp_path, "jira_issues", ISSUES)
    write_raw(tmp_path, "github_pulls", PULLS)
    return snapshots.start(str(tmp_path), RUN, "s1", {})


@pytest.fixture
def built(snap: Snapshot):
    statuses = run_jobs(load_jobs([JOBS_DIR]), CLIENT, snap)
    assert set(statuses.values()) == {"built"}
    con = connect(CLIENT)
    for name in statuses:
        con.execute(f"CREATE VIEW {name} AS SELECT * FROM {snap.source(name)}")
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


def test_run_job_refuses_to_write_a_table_that_breaks_the_contract(snap: Snapshot):
    bad = job("bad", ["raw.jira_issues"], "select 1::bigint as _row_id")
    with pytest.raises(ContractError):
        run_job(bad, CLIENT, snap)
    assert not Path(snap.url(snap.output_key("bad"))).exists()
    assert "bad" not in snap.tables


def test_a_failed_job_skips_everything_downstream(snap: Snapshot):
    jobs = [job("broken", ["raw.jira_issues"], "select nope"), job("after", ["broken"])]
    statuses = run_jobs(jobs, CLIENT, snap)
    assert statuses == {"broken": "failed", "after": "skipped"}
    assert not Path(snap.url("tables")).exists()


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


def test_trace_follows_a_metadata_value_back_to_raw(built, snap: Snapshot):
    (row_id,) = built.sql("""
        SELECT m._row_id FROM entity_metadata AS m JOIN entities ON entities.id = m.entity_id
        WHERE entities.name = 'KAFKA-1' AND m.key = 'change_count'
    """).fetchone()
    hops = trace(snap, "entity_metadata", str(row_id))
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


def test_load_job_rejects_a_column_map_in_job_toml(tmp_path: Path):
    (tmp_path / "job.toml").write_text('inputs = ["up"]\n[columns]\nx = ["up.y"]')
    (tmp_path / "query.sql").write_text("select 1")
    with pytest.raises(ValueError, match="returns _fields instead"):
        load_job(tmp_path)


@pytest.mark.parametrize(
    ("fields", "problem"),
    [
        ("{'n': ['up.y']}::map(varchar, varchar)", "_fields must be MAP(VARCHAR, VARCHAR[])"),
        ("map {'n': ['up.y'], 'extra': []}", "keys are not the output columns ['n']"),
        ("null::map(varchar, varchar[])", "keys are not the output columns"),
        ("map {'n': [null]::varchar[]}", "_fields[n] holds a null reference"),
        ("map {'n': ['nope']}", "Invalid column reference"),
        ("map {'n': ['other.y']}", "_fields[n] reads other, which is not an input"),
        ("map {'n': ['up.missing']}", "up has no column missing"),
        ("map {'n': ['up.y:$.a']}", "JSON path on a INTEGER column"),
    ],
)
def test_field_errors_catch_fields_that_do_not_match_the_tables(fields, problem):
    con = connect(CLIENT)
    con.execute("CREATE TABLE up AS SELECT 1::bigint AS _row_id, 2 AS y")
    con.execute(f"CREATE TEMP TABLE result AS SELECT 7::bigint AS _row_id, {fields} AS _fields, 1 AS n")
    errors = field_errors(con, ("up",))
    assert any(problem in error for error in errors), errors


def test_field_errors_pass_fields_that_differ_by_row():
    con = connect(CLIENT)
    con.execute("CREATE TABLE up AS SELECT 1::bigint AS _row_id, 2 AS y, 3 AS z")
    con.execute("""
        CREATE TEMP TABLE result AS
        SELECT i::bigint AS _row_id, if(i = 0, map {'n': ['up.y']}, map {'n': []}) AS _fields, 1 AS n
        FROM range(2) AS r(i)
    """)
    assert field_errors(con, ("up",)) == []


def test_every_table_carries_the_union_of_its_rows_fields(built, snap: Snapshot):
    for job in load_jobs([JOBS_DIR]):
        metadata = pq.read_metadata(snap.files(job.name)[0]).metadata
        stored = json.loads(metadata[COLUMNS_METADATA_KEY.encode()])
        rows = built.sql(f"SELECT DISTINCT _fields FROM {job.name}").fetchall()
        union: dict[str, set[str]] = {}
        for (fields,) in rows:
            for column, refs in fields.items():
                union.setdefault(column, set()).update(refs)
        assert stored == {column: sorted(refs) for column, refs in union.items()}


def test_a_value_with_a_fallback_names_only_the_column_it_came_from(built):
    # KAFKA-2's status is mapped by the client; the others fall back to Jira's category.
    rows = dict(built.sql(
        "SELECT ticket_key, _fields['status_group'] FROM tickets ORDER BY ticket_key"
    ).fetchall())  # fmt: skip
    assert rows == {
        "KAFKA-1": ["raw.jira_issues.fields:$.status.statusCategory.name"],
        "KAFKA-2": ["raw.jira_issues.fields:$.status.name"],
        "KAFKA-3": ["raw.jira_issues.fields:$.status.statusCategory.name"],
    }


def test_a_link_names_the_texts_its_key_was_found_in(built):
    rows = dict(built.sql(
        "SELECT ticket_key, _fields['ticket_key'] FROM ticket_change_links ORDER BY ticket_key"
    ).fetchall())  # fmt: skip
    assert rows == {
        "KAFKA-1": ["tickets.ticket_key", "changes.title"],
        "KAFKA-2": ["tickets.ticket_key", "changes.branch"],
        "KAFKA-3": ["tickets.ticket_key", "changes.title"],
    }


def metadata_row_id(built, entity_name: str, key: str) -> str:
    (row_id,) = built.sql(f"""
        SELECT m._row_id FROM entity_metadata AS m JOIN entities ON entities.id = m.entity_id
        WHERE entities.name = '{entity_name}' AND m.key = '{key}'
    """).fetchone()
    return str(row_id)


def test_trace_field_follows_only_the_tables_a_field_reads(built, snap: Snapshot):
    # change_count is sourced from the ticket, its changes and their links, but counts only the
    # linked changes. The links lead back to the ticket only through the key that matched.
    tables = snap
    row_id = metadata_row_id(built, "KAFKA-1", "change_count")
    values = row_values(tables, "entity_metadata", row_id)
    field = trace_field(column_maps(tables), "entity_metadata", "value", values)
    assert field is not None
    assert field.direct == ["changes._row_id", "ticket_change_links._row_id"]
    hops = trace(tables, "entity_metadata", row_id, field.follow)
    assert set(hops[1]) == {"changes", "ticket_change_links"}
    assert hops[-1] == {"raw.jira_issues": {"j1-new"}, "raw.github_pulls": {"p10"}}


def test_trace_field_reaches_a_json_path_in_raw(built, snap: Snapshot):
    tables = snap
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
    assert raw_values(snap, "raw.jira_issues", "fields:$.status.name", raw_ids) == [
        values["value"]
    ]


def test_trace_field_returns_none_for_an_undeclared_field(built, snap: Snapshot):
    assert trace_field(column_maps(snap), "tickets", "nope", {}) is None


def test_every_shared_job_passes_verification(tmp_path: Path):
    # The shared jobs' hand-written _fields, checked by re-running each job. verify.py perturbs
    # values in place, so the pulls' timestamps are typed, as dlt writes them.
    def typed(pull: dict) -> dict:
        stamps = ("created_at", "updated_at", "closed_at", "merged_at")
        return {**pull, **{k: pull[k] and datetime.fromisoformat(pull[k]) for k in stamps}}

    root = tmp_path / "typed"
    write_raw(root, "jira_issues", ISSUES)
    write_raw(root, "github_pulls", [typed(p) for p in PULLS])
    snap = snapshots.start(str(root), RUN, "s1", {})
    jobs = build_order(load_jobs([JOBS_DIR]))
    assert set(run_jobs(jobs, CLIENT, snap).values()) == {"built"}
    for job in jobs:
        _, found = verify_job(job, CLIENT, snap, per_branch=1)
        assert [f for f in found if f.level == "error"] == [], job.name
