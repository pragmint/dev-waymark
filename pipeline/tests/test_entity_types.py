"""What every job writes: entities of a type it makes (`entity_type`), or metadata it adds to an
existing type's entities (`adds_to`), as its parts of the snapshot's `entities` and
`entity_metadata` (CONTRACT.md, "What a job writes")."""

from pathlib import Path

import pytest

import snapshot as snapshots
from runner import (
    JOBS_DIR,
    ContractError,
    Job,
    build_order,
    dependencies,
    entity_types,
    input_tables,
    load_job,
    load_jobs,
    plan,
    run_job,
    run_jobs,
)
from snapshot import Snapshot
from test_runner import CLIENT, ISSUES, RUN, TYPED_PULLS, write_raw
from trace import trace
from verify import verify_job, verify_jobs

# One entity per status group: how many tickets are in it. It reads only ticket metadata, and
# cites the tickets it read it of. A metadata row's created_at is its ticket's.
STATUS_GROUPS = """
select
  stable_id('status_group', value) as _row_id,
  list(source_ref('entities', entity_id) order by entity_id) as _sources,
  map {
    'name': ['entities.status_group'],
    'created_at': ['entities.created_at'],
    'tickets': ['entities._row_id'],
    'first_ticket_at': ['entities.created_at']
  } as _fields,
  value as name,
  min(created_at) as created_at,
  count(*) as tickets,
  try_cast(min(created_at) as timestamptz) as first_ticket_at
from entity_metadata
where key = 'status_group'
group by value
"""

# How long each ticket's summary is, added to the ticket.
SUMMARY_LENGTH = """
select
  entity_id as _row_id,
  [source_ref('entities', entity_id)] as _sources,
  map {'summary_length': ['entities.summary']} as _fields,
  length(value) as summary_length
from entity_metadata
where key = 'summary'
"""


TICKET_METADATA = ("entities[type=ticket]", "entity_metadata[entity_type=ticket]")


def status_groups(sql: str = STATUS_GROUPS, **changes) -> Job:
    fields = {
        "name": "status_groups",
        "inputs": TICKET_METADATA,
        "sql": sql,
        "entity_type": "status_group",
        **changes,
    }
    return Job(**fields)


def summary_length(sql: str = SUMMARY_LENGTH, **changes) -> Job:
    fields = {
        "name": "summary_length",
        "inputs": TICKET_METADATA,
        "sql": sql,
        "adds_to": "ticket",
        **changes,
    }
    return Job(**fields)


@pytest.fixture
def root(tmp_path: Path) -> Path:
    write_raw(tmp_path, "jira_issues", ISSUES)
    write_raw(tmp_path, "github_pulls", TYPED_PULLS)
    return tmp_path


def build(root: Path, jobs: list[Job], snapshot_id: str = "s1", base=None) -> Snapshot:
    snap = snapshots.start(str(root), [RUN], snapshot_id, {}, base)
    statuses = run_jobs(jobs, CLIENT, snap, reuse=base is not None)
    assert set(statuses.values()) <= {"built", "reused"}, statuses
    snap.verified = True
    snapshots.save(snap)
    return snap


def shared() -> list[Job]:
    return load_jobs([JOBS_DIR])


def metadata_of(snap: Snapshot, entity_type: str) -> list[tuple]:
    with snap.connect() as con:
        return con.sql(f"""
            SELECT e.name, m.key, m.value, m.value_type, m.entity_type
            FROM {snap.source("entity_metadata")} AS m
            JOIN {snap.source("entities")} AS e ON e.id = m.entity_id
            WHERE e.type = '{entity_type}' ORDER BY e.name, m.key
        """).fetchall()


# ── Inputs and build order ────────────────────────────────────────────────────


def test_an_input_names_the_entity_types_it_reads():
    job = Job("j", ("entities[type=ticket]", "entities[type=change]", "raw.x"), "select 1")
    assert input_tables(job) == {"entities": {"ticket", "change"}, "raw.x": None}


@pytest.mark.parametrize(
    ("toml", "problem"),
    [
        ('inputs = ["raw.x"]', "every job writes entities"),
        ('inputs = ["raw.x"]\nentity_type = "a"\nadds_to = "b"', "every job writes entities"),
        ('inputs = ["raw.x"]\nentity_type = "Not A Name"', "invalid entity_type"),
        ('inputs = ["raw.x"]\nadds_to = "Not A Name"', "invalid adds_to"),
        ('inputs = ["entities"]\nentity_type = "x"', "must name the type it reads"),
        ('inputs = ["ticket_change_links"]\nentity_type = "x"', "isn't a table"),
        ('inputs = ["raw.x[type=y]"]\nentity_type = "x"', "can't be filtered"),
        ('inputs = ["entities[entity_type=ticket]"]\nentity_type = "x"', "can't be filtered"),
    ],
)
def test_load_job_rejects_bad_entity_settings(tmp_path: Path, toml: str, problem: str):
    folder = tmp_path / "j"
    folder.mkdir()
    (folder / "job.toml").write_text(toml)
    (folder / "query.sql").write_text("select 1")
    with pytest.raises(ValueError, match=problem):
        load_job(folder)


def test_load_job_reads_what_the_job_writes(tmp_path: Path):
    for setting in ('entity_type = "x"', 'adds_to = "ticket"'):
        folder = tmp_path / "j"
        folder.mkdir(exist_ok=True)
        (folder / "job.toml").write_text(f'inputs = ["entities[type=ticket]"]\n{setting}')
        (folder / "query.sql").write_text("select 1")
        job = load_job(folder)
        assert (job.entity_type, job.adds_to) == (
            ("x", None) if "entity_type" in setting else (None, "ticket")
        )


def test_reading_a_types_entities_waits_for_the_job_that_makes_it():
    reader = Job("reader", ("entities[type=status_group]",), "select 1", entity_type="r")
    assert dependencies([*shared(), status_groups(), reader])["reader"] == ["status_groups"]


def test_reading_a_types_metadata_waits_for_every_job_that_adds_to_it():
    deps = dependencies([*shared(), status_groups(), summary_length()])
    assert deps["status_groups"] == ["summary_length", "ticket_lead_time", "tickets"]


def test_metadata_computed_from_a_jobs_own_entities_is_left_out_of_what_it_reads():
    # change_ticket_keys adds to changes from the links, so the links job can't wait for it.
    reads = plan(shared())
    assert reads["ticket_change_links"]["entity_metadata[entity_type=change]"] == ["changes"]
    assert reads["ticket_lead_time"]["entity_metadata[entity_type=change]"] == [
        "change_ticket_keys",
        "changes",
    ]


def test_adding_to_a_type_waits_for_the_job_that_makes_it():
    job = Job("adder", ("raw.jira_issues",), "select 1", adds_to="ticket")
    assert dependencies([*shared(), job])["adder"] == ["tickets"]


def test_adding_to_a_type_no_job_makes_is_refused():
    job = Job("adder", ("raw.jira_issues",), "select 1", adds_to="nothing")
    with pytest.raises(ValueError, match="no job makes entity type nothing"):
        build_order([*shared(), job])


@pytest.mark.parametrize(
    "inputs", [("entities[type=status_group]",), ("entity_metadata[entity_type=status_group]",)]
)
def test_a_job_cant_read_the_type_it_makes(inputs):
    with pytest.raises(ValueError, match="makes entity type status_group, so it can't read it"):
        build_order([*shared(), status_groups(inputs=inputs)])


def test_two_jobs_cant_make_the_same_type():
    with pytest.raises(ValueError, match="both make entity type status_group"):
        build_order([*shared(), status_groups(), status_groups(name="again")])
    with pytest.raises(ValueError, match="tickets and again both make entity type ticket"):
        build_order([*shared(), status_groups(name="again", entity_type="ticket")])


# ── Building ──────────────────────────────────────────────────────────────────


def test_rows_become_entities_with_their_columns_as_metadata(root: Path):
    snap = build(root, [*shared(), status_groups()])
    with snap.connect() as con:
        entities = con.sql(f"""
            SELECT name, created_at FROM {snap.source("entities")}
            WHERE type = 'status_group' ORDER BY name
        """).fetchall()
    assert entities == [("Doing", "2026-01-01T00:00:00Z"), ("To Do", "2026-01-01T00:00:00Z")]
    assert metadata_of(snap, "status_group") == [
        ("Doing", "first_ticket_at", "2026-01-01T00:00:00Z", "date", "status_group"),
        ("Doing", "tickets", "1", "number", "status_group"),
        ("To Do", "first_ticket_at", "2026-01-01T00:00:00Z", "date", "status_group"),
        ("To Do", "tickets", "2", "number", "status_group"),
    ]


def test_rows_that_add_to_a_type_become_more_of_its_metadata(root: Path):
    snap = build(root, [*shared(), summary_length()])
    lengths = [row for row in metadata_of(snap, "ticket") if row[1] == "summary_length"]
    assert lengths == [
        ("KAFKA-1", "summary_length", "15", "number", "ticket"),
        ("KAFKA-2", "summary_length", "15", "number", "ticket"),
        ("KAFKA-3", "summary_length", "15", "number", "ticket"),
    ]
    assert "entities" not in snap.jobs["summary_length"]["files"]


def test_the_manifest_lists_each_jobs_parts_in_build_order(root: Path):
    snap = build(root, [*shared(), status_groups()])
    order = [job.name for job in build_order([*shared(), status_groups()])]
    metadata = snap.tables["entity_metadata"]
    assert metadata["files"] == [f"tables/entity_metadata/s1.{name}.parquet" for name in order]
    assert metadata["parts"]["status_groups"] == "tables/entity_metadata/s1.status_groups.parquet"
    makers = [name for name in order if snap.jobs[name]["adds"] is False]
    assert snap.tables["entities"]["files"] == [
        f"tables/entities/s1.{name}.parquet" for name in makers
    ]
    assert snap.jobs["status_groups"]["read"] == {
        "entities[type=ticket]": ["tables/entities/s1.tickets.parquet"],
        "entity_metadata[entity_type=ticket]": [
            "tables/entity_metadata/s1.ticket_lead_time.parquet",
            "tables/entity_metadata/s1.tickets.parquet",
        ]
    }


def test_a_filtered_input_sees_only_its_types(root: Path):
    reader = Job(
        "reader",
        ("entities[type=status_group]",),
        "select _row_id + 1 as _row_id, [source_ref('entities', _row_id)] as _sources,"
        " map {'name': ['entities.name'], 'created_at': ['entities.created_at'],"
        " 'seen_type': ['entities.type']} as _fields,"
        " name, created_at, type as seen_type from entities",
        entity_type="reader",
    )
    snap = build(root, [*shared(), status_groups(), reader])
    assert {row[2] for row in metadata_of(snap, "reader")} == {"status_group"}


def test_an_entity_traces_straight_to_what_its_job_read(root: Path):
    snap = build(root, [*shared(), status_groups()])
    with snap.connect() as con:
        (row_id,) = con.sql(f"""
            SELECT _row_id FROM {snap.source("entities")}
            WHERE type = 'status_group' AND name = 'To Do'
        """).fetchone()
    result = trace(snap, "entities", str(row_id))
    assert result is not None
    # Straight to the tickets it counted: never their metadata rows.
    assert set(result.hops[1]) == {"entities"}
    assert result.hops[-1] == {"raw.jira_issues": {"j1-new", "j3"}}


def test_every_job_verifies(root: Path):
    snap = snapshots.start(str(root), [RUN], "s1", {})
    jobs = build_order([*shared(), status_groups(), summary_length()])
    assert set(run_jobs(jobs, CLIENT, snap).values()) == {"built"}
    assert verify_jobs(jobs, CLIENT, snap, per_branch=1)


def test_verify_catches_an_undeclared_column_of_an_added_value(root: Path):
    sql = SUMMARY_LENGTH.replace("length(value)", "length(value) + length(entity_type)")
    snap = build(root, [*shared(), summary_length(sql=sql)])
    _, found = verify_job(summary_length(sql=sql), CLIENT, snap, per_branch=1)
    details = {(f.check, f.column, f.detail) for f in found if f.level == "error"}
    assert details == {
        ("undeclared", "summary_length", "changes with entities.type")
    }


def test_verify_names_the_metadata_key_an_undeclared_value_reads(root: Path):
    # As in README step 5: a value that reads the tickets' status_group without declaring it.
    sql = STATUS_GROUPS.replace(
        "count(*) as tickets", "count(*) as tickets, max(length(value)) as name_length"
    ).replace("'tickets':", "'name_length': []::varchar[], 'tickets':")
    snap = build(root, [*shared(), status_groups(sql=sql)])
    _, found = verify_job(status_groups(sql=sql), CLIENT, snap, per_branch=1)
    details = {(f.check, f.column, f.detail) for f in found if f.level == "error"}
    assert details == {("undeclared", "name_length", "changes with entities.status_group")}


def test_a_rebuild_with_nothing_new_reuses_everything_and_lists_each_part_once(root: Path):
    jobs = [*shared(), status_groups()]
    first = build(root, jobs)
    second = build(root, jobs, "s2", first)
    assert set(second.status.values()) == {"reused"}
    assert second.tables["entities"]["files"] == first.tables["entities"]["files"]
    assert second.tables["entity_metadata"]["files"] == first.tables["entity_metadata"]["files"]


def test_a_changed_job_rebuilds_only_itself_and_what_reads_it(root: Path):
    first = build(root, [*shared(), status_groups(), summary_length()])
    changed = summary_length(sql=SUMMARY_LENGTH.replace("length(value)", "length(value) + 0"),
                             version="v2")  # fmt: skip
    second = build(root, [*shared(), status_groups(), changed], "s2", first)
    assert second.status["summary_length"] == "built"
    # status_groups reads ticket metadata, which now has a new part.
    assert second.status["status_groups"] == "built"
    assert {second.status[j.name] for j in shared()} == {"reused"}
    assert second.tables["entity_metadata"]["parts"]["tickets"] == (
        "tables/entity_metadata/s1.tickets.parquet"
    )


# ── What it refuses ───────────────────────────────────────────────────────────


@pytest.fixture
def base(root: Path) -> Snapshot:
    """A snapshot with the shared jobs built, for running one more job against."""
    snap = snapshots.start(str(root), [RUN], "s1", {})
    assert set(run_jobs(shared(), CLIENT, snap).values()) == {"built"}
    return snap


def run_one(job: Job, snap: Snapshot) -> int:
    jobs = [*shared(), job]
    return run_job(job, CLIENT, snap, plan(jobs)[job.name], entity_types(jobs))


@pytest.mark.parametrize(
    ("change", "problem"),
    [
        (("value as name,", "1 as name,"), "needs a text name column"),
        (("value as name,", "'' as name,"), "have no name"),
        (("min(created_at) as created_at", "'yesterday' as created_at"), "isn't iso_utc text"),
        (("count(*) as tickets", "count(*) as type"), "type is the entity's own"),
        (("count(*) as tickets", "list(key) as tickets"), "can't be metadata"),
        (("count(*) as tickets", "count(*) as Tickets"), "can't be a metadata key"),
    ],
)
def test_it_refuses_rows_that_cant_be_entities(base: Snapshot, change, problem):
    sql = STATUS_GROUPS.replace(*change)
    if "as type" in sql:
        sql = sql.replace("'tickets':", "'type':")
    if "as Tickets" in sql:
        sql = sql.replace("'tickets':", "'Tickets':")
    with pytest.raises(ContractError, match=problem):
        run_one(status_groups(sql=sql), base)
    assert "status_groups" not in base.jobs


def test_it_refuses_an_entity_with_the_id_of_one_that_exists(base: Snapshot):
    sql = SUMMARY_LENGTH.replace(
        "length(value) as summary_length", "'x' as name, '2026-01-01T00:00:00Z' as created_at"
    ).replace("{'summary_length': ['entities.summary']}",
              "{'name': []::varchar[], 'created_at': []::varchar[]}")  # fmt: skip
    job = Job("copies", TICKET_METADATA, sql, entity_type="copy")
    with pytest.raises(ContractError, match="3 rows have the _row_id of an entity that already"):
        run_one(job, base)


def test_it_refuses_to_add_to_an_entity_that_isnt_of_its_type(base: Snapshot):
    sql = SUMMARY_LENGTH.replace("entity_id as _row_id", "entity_id + 1 as _row_id")
    with pytest.raises(ContractError, match="3 rows have a _row_id that isn't a ticket's id"):
        run_one(summary_length(sql=sql), base)


def test_it_refuses_to_add_a_key_another_job_writes(base: Snapshot):
    sql = SUMMARY_LENGTH.replace("as summary_length", "as status").replace(
        "'summary_length':", "'status':"
    )
    with pytest.raises(ContractError, match="another job already writes ticket metadata status"):
        run_one(summary_length(sql=sql), base)


def test_added_metadata_cant_be_the_entitys_own_columns(base: Snapshot):
    sql = SUMMARY_LENGTH.replace("as summary_length", "as name").replace(
        "'summary_length':", "'name':"
    )
    with pytest.raises(ContractError, match="name is the entity's own"):
        run_one(summary_length(sql=sql), base)


EXTRA = "struct(\"key\" varchar, \"value\" varchar, value_type varchar)[]"


@pytest.mark.parametrize(
    ("extra", "problem"),
    [
        ("['a']", "_metadata must be"),
        (f"[{{'key': 'Bad', 'value': 'v', 'value_type': 'string'}}]::{EXTRA}", "key that isn't"),
        (f"[{{'key': 'summary_length', 'value': 'v', 'value_type': 'string'}}]::{EXTRA}",
         "already a column"),
        (f"[{{'key': 'k', 'value': 'v', 'value_type': 'text'}}]::{EXTRA}", "unknown value_type"),
        (f"[{{'key': 'k', 'value': 'v', 'value_type': 'string'}},"
         f" {{'key': 'k', 'value': 'w', 'value_type': 'string'}}]::{EXTRA}", "repeat a key"),
    ],
)  # fmt: skip
def test_it_refuses_bad_extra_metadata(base: Snapshot, extra: str, problem: str):
    sql = SUMMARY_LENGTH.replace(
        "length(value) as summary_length", f"length(value) as summary_length, {extra} as _metadata"
    ).replace("{'summary_length': ['entities.summary']}",
              "{'summary_length': ['entities.summary'], '_metadata': []}")  # fmt: skip
    with pytest.raises(ContractError, match=problem):
        run_one(summary_length(sql=sql), base)


def test_extra_metadata_becomes_one_value_per_entry(root: Path):
    sql = SUMMARY_LENGTH.replace(
        "length(value) as summary_length",
        "length(value) as summary_length, "
        f"[{{'key': 'first_word', 'value': split_part(value, ' ', 1), 'value_type': 'string'}}]"
        f"::{EXTRA} as _metadata",
    ).replace("{'summary_length': ['entities.summary']}",
              "{'summary_length': ['entities.summary'],"
              " '_metadata': ['entities.summary']}")  # fmt: skip
    snap = build(root, [*shared(), summary_length(sql=sql)])
    words = [row for row in metadata_of(snap, "ticket") if row[1] == "first_word"]
    assert words == [
        ("KAFKA-1", "first_word", "KAFKA-1", "string", "ticket"),
        ("KAFKA-2", "first_word", "KAFKA-2", "string", "ticket"),
        ("KAFKA-3", "first_word", "KAFKA-3", "string", "ticket"),
    ]
    _, found = verify_job(summary_length(sql=sql), CLIENT, snap, per_branch=1)
    assert [f for f in found if f.level == "error"] == []
