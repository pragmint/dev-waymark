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
    Ref,
    is_raw,
    parse_ref,
    run_job,
    run_jobs,
)
import snapshot as snapshots
from snapshot import Snapshot
from trace import raw_values, row_values, trace
from verify import verify_job, verify_jobs

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


# verify.py perturbs values in place, so it needs the pulls' timestamps typed, as dlt writes them.
def typed(pull: dict) -> dict:
    stamps = ("created_at", "updated_at", "closed_at", "merged_at")
    return {**pull, **{k: pull[k] and datetime.fromisoformat(pull[k]) for k in stamps}}


TYPED_PULLS = [typed(p) for p in PULLS]
RUN = "r1"


def write_raw(root: Path, table: str, rows: list[dict], run_id: str = RUN) -> None:
    directory = root / "raw" / table
    directory.mkdir(parents=True, exist_ok=True)
    pq.write_table(pa.Table.from_pylist(rows), directory / f"{run_id}.1.0.parquet")


@pytest.fixture
def snap(tmp_path: Path) -> Snapshot:
    write_raw(tmp_path, "jira_issues", ISSUES)
    write_raw(tmp_path, "github_pulls", PULLS)
    return snapshots.start(str(tmp_path), [RUN], "s1", {})


@pytest.fixture
def built(snap: Snapshot):
    statuses = run_jobs(load_jobs([JOBS_DIR]), CLIENT, snap)
    assert set(statuses.values()) == {"built"}
    con = connect(CLIENT)
    for table in ("entities", "entity_metadata"):
        con.execute(f"CREATE VIEW {table} AS SELECT * FROM {snap.source(table)}")
    return con


def job(name, inputs=(), sql="select 1", makes=None, adds_to=None):
    return Job(name, tuple(inputs), sql, entity_type=makes or (None if adds_to else name),
               adds_to=adds_to)  # fmt: skip


def metadata(built, entity_name: str) -> dict[str, str]:
    """One entity's metadata, key → value."""
    return dict(built.execute(
        "SELECT m.key, m.value FROM entity_metadata AS m JOIN entities ON entities.id = m.entity_id"
        " WHERE entities.name = ?",
        [entity_name],
    ).fetchall())  # fmt: skip


def test_build_order_puts_the_jobs_that_make_a_type_first():
    jobs = [
        job("c", ["entities[type=b]"]),
        job("b", ["entities[type=a]"]),
        job("a", ["raw.x"]),
    ]
    assert [j.name for j in build_order(jobs)] == ["a", "b", "c"]


def test_build_order_rejects_a_cycle():
    with pytest.raises(ValueError, match="cycle"):
        build_order([job("a", ["entities[type=b]"]), job("b", ["entities[type=a]"])])


def test_build_order_rejects_a_type_no_job_makes():
    with pytest.raises(ValueError, match="no job makes entity type missing"):
        build_order([job("a", ["entities[type=missing]"])])


def test_a_client_job_replaces_a_shared_job_with_the_same_name(tmp_path: Path):
    for root, sql in [("shared", "select 'shared'"), ("client", "select 'client'")]:
        directory = tmp_path / root / "tickets"
        directory.mkdir(parents=True)
        (directory / "job.toml").write_text('inputs = ["raw.jira_issues"]\nentity_type = "ticket"')
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


def test_run_job_refuses_to_write_parts_that_break_the_contract(snap: Snapshot):
    bad = job("bad", ["raw.jira_issues"], "select 1::bigint as _row_id")
    with pytest.raises(ContractError):
        run_job(bad, CLIENT, snap, {"raw.jira_issues": []}, {})
    assert not Path(snap.url("tables")).exists()
    assert "bad" not in snap.jobs


def test_a_failed_job_skips_everything_downstream(snap: Snapshot):
    jobs = [
        job("broken", ["raw.jira_issues"], "select nope"),
        job("after", ["entities[type=broken]"]),
    ]
    statuses = run_jobs(jobs, CLIENT, snap)
    assert statuses == {"broken": "failed", "after": "skipped"}
    assert not Path(snap.url("tables")).exists()


def test_every_job_writes_only_parts_of_the_entity_tables(built, snap: Snapshot):
    assert {t for t in snap.tables if not is_raw(t)} == {"entities", "entity_metadata"}
    for name, entry in snap.jobs.items():
        assert entry["files"]["entity_metadata"] == f"tables/entity_metadata/s1.{name}.parquet"
    types = built.sql("SELECT DISTINCT type FROM entities ORDER BY 1").fetchall()
    assert types == [("change",), ("ticket",), ("ticket_change_link",)]


def test_tickets_keep_the_latest_version_and_point_at_its_raw_row(built):
    rows = built.sql("""
        SELECT name, _sources[1].row_id FROM entities WHERE type = 'ticket' ORDER BY name
    """).fetchall()
    assert rows == [("KAFKA-1", "j1-new"), ("KAFKA-2", "j2"), ("KAFKA-3", "j3")]
    expected = {
        "KAFKA-1": ("Resolved", "To Do"),
        "KAFKA-2": ("In Progress", "Doing"),
        "KAFKA-3": ("Open", "To Do"),
    }
    for name, (status, group) in expected.items():
        values = metadata(built, name)
        assert (values["status"], values["status_group"]) == (status, group)
        assert values["url"] == f"https://jira.example.org/browse/{name}"


def test_every_current_raw_row_is_the_source_of_exactly_one_entity(built):
    refs = built.sql("""
        SELECT s.row_id, count(*) FROM (SELECT unnest(_sources) AS s FROM entities)
        WHERE s.table LIKE 'raw.%' GROUP BY 1 ORDER BY 1
    """).fetchall()
    assert refs == [(i, 1) for i in ["j1-new", "j2", "j3", "p10", "p11", "p12-new"]]


def test_links_match_titles_and_underscored_branches_and_skip_unknown_tickets(built):
    links = built.sql(
        "SELECT name FROM entities WHERE type = 'ticket_change_link' ORDER BY name"
    ).fetchall()
    assert links == [
        ("KAFKA-1 in apache/kafka#10",),
        ("KAFKA-2 in apache/kafka#10",),
        ("KAFKA-3 in apache/kafka#12",),
    ]


def test_metadata_includes_custom_fields_and_rollups(built):
    values = metadata(built, "KAFKA-1")
    assert values["votes"] == "3.0"
    assert values["change_count"] == "1"
    assert values["last_merged_at"] == "2026-01-04T00:00:00Z"
    assert metadata(built, "apache/kafka#10")["ticket_keys"] == "KAFKA-1,KAFKA-2"


def test_lead_time_runs_from_the_first_change_opening_to_the_last_merging(built):
    values = dict(built.sql("""
        SELECT entities.name, value FROM entity_metadata JOIN entities ON entities.id = entity_id
        WHERE key = 'lead_time_hours'
    """).fetchall())
    # KAFKA-3's only change hasn't merged, so it has no lead time yet.
    assert values == {"KAFKA-1": "48.0", "KAFKA-2": "48.0"}


def test_metadata_added_to_an_entity_is_dated_like_it(built):
    (created_at,) = built.sql(
        "SELECT created_at FROM entities WHERE name = 'KAFKA-1'"
    ).fetchone()
    dates = built.sql("""
        SELECT DISTINCT m.created_at, m.updated_at FROM entity_metadata AS m
        JOIN entities ON entities.id = m.entity_id
        WHERE entities.name = 'KAFKA-1' AND m.key IN ('change_count', 'lead_time_hours')
    """).fetchall()
    assert dates == [(created_at, created_at)]


def test_lead_time_traces_to_the_changes_raw_timestamps(built, snap: Snapshot):
    row_id = metadata_row_id(built, "KAFKA-1", "lead_time_hours")
    result = trace(snap, "entity_metadata", row_id, "value")
    assert result is not None
    raw_fields = {t: set(labels) for t, labels in result.columns.items() if is_raw(t)}
    assert raw_fields == {"raw.github_pulls": {"created_at", "merged_at"}}


def test_a_rollup_is_sourced_from_the_rows_it_rolls_up(built):
    (sources,) = built.sql("""
        SELECT list_sort(list(cited.type)) FROM (
          SELECT unnest(m._sources) AS s FROM entity_metadata AS m
          JOIN entities ON entities.id = m.entity_id
          WHERE entities.name = 'KAFKA-1' AND key = 'change_count'
        ) JOIN entities AS cited ON cast(cited._row_id AS VARCHAR) = s.row_id
    """).fetchone()
    # The link and the change it names: entities, never their metadata rows.
    assert sources == ["change", "ticket_change_link"]


def test_trace_follows_a_metadata_value_back_to_raw(built, snap: Snapshot):
    row_id = metadata_row_id(built, "KAFKA-1", "change_count")
    result = trace(snap, "entity_metadata", row_id)
    assert result is not None
    assert all("entity_metadata" not in hop for hop in result.hops[1:])
    raw = {t: ids for hop in result.hops for t, ids in hop.items() if is_raw(t)}
    assert raw == {"raw.jira_issues": {"j1-new"}, "raw.github_pulls": {"p10"}}


def test_parse_ref_splits_table_column_and_json_path():
    assert parse_ref("changes.merged_at") == Ref("changes", "merged_at")
    ref = parse_ref("raw.jira_issues.fields:$.priority.name")
    assert ref == Ref("raw.jira_issues", "fields", "$.priority.name")
    assert ref.label == "fields:$.priority.name"
    with pytest.raises(ValueError, match="Invalid column reference"):
        parse_ref("fields:$.priority")


def test_parse_ref_reads_a_row_filter():
    ref = parse_ref("entities[type=change].created_at")
    assert ref == Ref("entities", "created_at", where=("type", "change"))
    assert ref.matches("change") and not ref.matches("ticket") and not ref.matches(None)
    spaced = parse_ref("entities[issue_type=New Feature]._row_id")
    assert spaced.where == ("issue_type", "New Feature")
    for bad in ["entities[type].x", "entities[=a].x", "entities[type=].x", "entities[a=[b]].x"]:
        with pytest.raises(ValueError, match="Invalid column reference"):
            parse_ref(bad)


def test_load_job_rejects_a_column_map_in_job_toml(tmp_path: Path):
    (tmp_path / "job.toml").write_text(
        'inputs = ["raw.up"]\nentity_type = "x"\n[columns]\nx = ["raw.up.y"]'
    )
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
        ("map {'n': ['up[missing=a].y']}", "up has no column missing to filter on"),
        ("map {'n': ['up[y=2].y']}", "filters on a INTEGER column, not text"),
        ("map {'n': ['up[q=a].q:$.a']}", "has both a filter and a JSON path"),
    ],
)
def test_field_errors_catch_fields_that_do_not_match_the_tables(fields, problem):
    con = connect(CLIENT)
    con.execute("CREATE TABLE up AS SELECT 1::bigint AS _row_id, 2 AS y, 'a' AS q")
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


def test_field_errors_pass_a_filter_on_a_text_column():
    con = connect(CLIENT)
    con.execute("CREATE TABLE up AS SELECT 1::bigint AS _row_id, 2 AS y, 'a' AS q")
    con.execute(
        "CREATE TEMP TABLE result AS SELECT 7::bigint AS _row_id, "
        "map {'n': ['up[q=a].y', 'up[q=b]._row_id']} AS _fields, 1 AS n"
    )
    assert field_errors(con, ("up",)) == []


def test_every_part_carries_the_union_of_its_rows_fields(built, snap: Snapshot):
    for name, entry in snap.jobs.items():
        for table, key in entry["files"].items():
            stored = json.loads(pq.read_metadata(snap.url(key)).metadata[COLUMNS_METADATA_KEY.encode()])
            rows = built.sql(
                f"SELECT DISTINCT _fields FROM read_parquet('{snap.url(key)}')"
            ).fetchall()
            union: dict[str, set[str]] = {}
            for (fields,) in rows:
                for column, refs in fields.items():
                    union.setdefault(column, set()).update(refs)
            assert stored == {column: sorted(refs) for column, refs in union.items()}, (name, table)


def test_a_value_with_a_fallback_names_only_the_column_it_came_from(built):
    # KAFKA-2's status is mapped by the client; the others fall back to Jira's category.
    rows = dict(built.sql("""
        SELECT entities.name, m._fields['value'] FROM entity_metadata AS m
        JOIN entities ON entities.id = m.entity_id
        WHERE m.key = 'status_group' ORDER BY 1
    """).fetchall())  # fmt: skip
    assert rows == {
        "KAFKA-1": ["raw.jira_issues.fields:$.status.statusCategory.name"],
        "KAFKA-2": ["raw.jira_issues.fields:$.status.name"],
        "KAFKA-3": ["raw.jira_issues.fields:$.status.statusCategory.name"],
    }


def test_a_link_names_the_texts_its_key_was_found_in(built):
    rows = dict(built.sql("""
        SELECT m.value, m._fields['value'] FROM entity_metadata AS m
        WHERE m.entity_type = 'ticket_change_link' AND m.key = 'ticket_key' ORDER BY 1
    """).fetchall())  # fmt: skip
    found_in = {
        "KAFKA-1": "entities[type=change].title",
        "KAFKA-2": "entities[type=change].branch",
        "KAFKA-3": "entities[type=change].title",
    }
    assert rows == {key: ["entities[type=ticket].name", text] for key, text in found_in.items()}


def metadata_row_id(built, entity_name: str, key: str) -> str:
    (row_id,) = built.sql(f"""
        SELECT m._row_id FROM entity_metadata AS m JOIN entities ON entities.id = m.entity_id
        WHERE entities.name = '{entity_name}' AND m.key = '{key}'
    """).fetchone()
    return str(row_id)


def change_entity_ids(built) -> set[str]:
    rows = built.sql("SELECT _row_id FROM entities WHERE type = 'change'").fetchall()
    return {str(row_id) for (row_id,) in rows}


def test_a_filtered_reference_follows_only_the_rows_it_matches(built, snap: Snapshot):
    # change_count counts the ticket's links: the change's merged_at is a source, not counted.
    row_id = metadata_row_id(built, "KAFKA-1", "change_count")
    result = trace(snap, "entity_metadata", row_id, "value")
    assert result is not None
    assert result.direct == [
        "entities[type=ticket_change_link].ticket_id",
        "entities[type=ticket_change_link].change_id",
        "entities[type=change]._row_id",
    ]
    assert set(result.hops[1]) == {"entities"}
    assert change_entity_ids(built) & result.hops[1]["entities"]
    # The change's merged_at is a value of a row it reached, but not one it reads.
    assert "merged_at" not in result.columns["entities"]
    assert set(result.columns["entities"]) == {"ticket_id", "change_id", "_row_id"}
    raw = {t: ids for hop in result.hops for t, ids in hop.items() if is_raw(t)}
    assert raw == {"raw.jira_issues": {"j1-new"}, "raw.github_pulls": {"p10"}}


def test_an_entitys_metadata_value_traces_from_the_entity(built, snap: Snapshot):
    # Traced from the ticket itself: every hop names entities, never a metadata row.
    (ticket,) = built.sql("SELECT _row_id FROM entities WHERE name = 'KAFKA-1'").fetchone()
    result = trace(snap, "entities", str(ticket), "lead_time_hours")
    assert result is not None
    assert result.direct == [
        "entities[type=ticket_change_link].ticket_id",
        "entities[type=ticket_change_link].change_id",
        "entities[type=change].created_at",
        "entities[type=change].merged_at",
    ]
    assert all(set(hop) <= {"entities", "raw.jira_issues", "raw.github_pulls"} for hop in result.hops)
    raw_fields = {t: set(labels) for t, labels in result.columns.items() if is_raw(t)}
    assert raw_fields == {"raw.github_pulls": {"created_at", "merged_at"}}


def test_an_entity_without_a_value_for_a_key_has_no_lineage_for_it(built, snap: Snapshot):
    (ticket,) = built.sql("SELECT _row_id FROM entities WHERE name = 'KAFKA-3'").fetchone()
    assert trace(snap, "entities", str(ticket), "lead_time_hours") is None


def test_a_field_reaches_only_the_raw_fields_of_the_rows_it_reads(built, snap: Snapshot):
    # first_change_at reads the change's created_at; the link reaches the ticket only as a whole
    # row, without making its created field part of the value.
    row_id = metadata_row_id(built, "KAFKA-1", "first_change_at")
    result = trace(snap, "entity_metadata", row_id, "value")
    assert result is not None
    raw_fields = {t: set(labels) for t, labels in result.columns.items() if is_raw(t)}
    assert raw_fields == {"raw.github_pulls": {"created_at"}}
    assert result.columns["raw.github_pulls"]["created_at"] == {"p10"}


def test_a_value_traces_straight_to_raw_with_no_table_between(built, snap: Snapshot):
    row_id = metadata_row_id(built, "KAFKA-1", "status")
    values = row_values(snap, "entity_metadata", row_id)
    result = trace(snap, "entity_metadata", row_id, "value")
    assert result is not None
    assert {t: set(labels) for t, labels in result.columns.items()} == {
        "raw.jira_issues": {"fields:$.status.name"},
    }
    assert result.hops == [{"entity_metadata": {row_id}}, {"raw.jira_issues": {"j1-new"}}]
    raw_ids = result.columns["raw.jira_issues"]["fields:$.status.name"]
    assert raw_values(snap, "raw.jira_issues", "fields:$.status.name", raw_ids) == [
        values["value"]
    ]


def test_trace_returns_none_for_an_undeclared_field(built, snap: Snapshot):
    (row_id,) = built.sql("SELECT _row_id FROM entities LIMIT 1").fetchone()
    assert trace(snap, "entities", str(row_id), "nope") is None


def test_every_shared_job_passes_verification(tmp_path: Path):
    # The shared jobs' hand-written _fields, checked by re-running each job.
    root = tmp_path / "typed"
    write_raw(root, "jira_issues", ISSUES)
    write_raw(root, "github_pulls", TYPED_PULLS)
    snap = snapshots.start(str(root), [RUN], "s1", {})
    jobs = build_order(load_jobs([JOBS_DIR]))
    assert set(run_jobs(jobs, CLIENT, snap).values()) == {"built"}
    for job in jobs:
        _, found = verify_job(job, CLIENT, snap, per_branch=1)
        assert [f for f in found if f.level == "error"] == [], job.name


def build(root: Path, runs: list[str], snapshot_id: str, base: Snapshot | None) -> Snapshot:
    snap = snapshots.start(str(root), runs, snapshot_id, {}, base)
    assert set(run_jobs(load_jobs([JOBS_DIR]), CLIENT, snap).values()) == {"built"}
    snapshots.save(snap)
    return snap


def tickets_by_key(snap: Snapshot) -> dict[str, tuple[str, str]]:
    with snap.connect() as con:
        rows = con.sql(f"""
            SELECT e.name, m.value, e._sources[1].row_id
            FROM {snap.source("entities")} AS e
            JOIN {snap.source("entity_metadata")} AS m ON m.entity_id = e.id AND m.key = 'status'
            WHERE e.type = 'ticket'
        """).fetchall()
    return {key: (status, source) for key, status, source in rows}


def counts(snap: Snapshot, job: str) -> tuple[int, int, int]:
    changes = snap.jobs[job]["changes"]
    return changes["added"], changes["changed"], changes["removed"]


def test_an_incremental_snapshot_reads_its_full_run_plus_the_changes_since(tmp_path: Path):
    write_raw(tmp_path, "jira_issues", ISSUES, "full1")
    write_raw(tmp_path, "github_pulls", TYPED_PULLS, "full1")
    first = build(tmp_path, ["full1"], "s1", None)

    # The incremental run fetched one changed issue and one new one, and no pull requests.
    write_raw(tmp_path, "jira_issues", [
        issue("j2-inc", "3", "102", "KAFKA-2", "Resolved", "2026-01-07T00:00:00.000+0000"),
        issue("j4", "3", "104", "KAFKA-4", "Open", "2026-01-07T00:00:00.000+0000"),
    ], "inc1")  # fmt: skip
    second = build(tmp_path, ["full1", "inc1"], "s2", first)
    tickets = tickets_by_key(second)
    assert tickets["KAFKA-2"] == ("Resolved", "j2-inc")
    assert tickets["KAFKA-3"] == ("Open", "j3")  # unchanged, still read from the full run
    assert set(tickets) == {"KAFKA-1", "KAFKA-2", "KAFKA-3", "KAFKA-4"}
    assert counts(second, "tickets") == (1, 1, 0)
    assert counts(second, "changes") == (0, 0, 0)  # no pull request changed
    assert verify_jobs(build_order(load_jobs([JOBS_DIR])), CLIENT, second, per_branch=1)

    # The next full run no longer has KAFKA-3: it was deleted, and drops out.
    write_raw(tmp_path, "jira_issues", [i for i in ISSUES if i["key"] != "KAFKA-3"], "full2")
    write_raw(tmp_path, "github_pulls", TYPED_PULLS, "full2")
    third = build(tmp_path, ["full2"], "s3", second)
    assert "KAFKA-3" not in tickets_by_key(third)
    assert counts(third, "tickets") == (0, 1, 2)  # KAFKA-2 back to the full run's In Progress
