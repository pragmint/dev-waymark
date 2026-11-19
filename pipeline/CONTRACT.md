# Table contract

Every table a job writes follows this contract. It lets Waymark trace any row back to the raw
records it came from, one hop at a time, without a separate lineage manifest. The contract is
about the tables, not the language that builds them, but the runner only runs SQL jobs today.

## Required columns

| Column     | Type                                            | Meaning                                     |
| ---------- | ----------------------------------------------- | ------------------------------------------- |
| `_row_id`  | `BIGINT`                                        | Identifies the row. Unique and never null.  |
| `_sources` | `LIST<STRUCT("table" VARCHAR, row_id VARCHAR)>` | The input rows this row was built from.     |
| `_fields`  | `MAP(VARCHAR, VARCHAR[])`                       | The input columns each value is built from. |

- **`_row_id` comes from business keys**, never from load order, so the same ticket or the same
  "P1 / Platform" aggregate keeps its ID from one run to the next. Use `stable_id(kind, key)`: an
  md5-based 53-bit integer, so it survives a JavaScript number and does not change between DuckDB
  versions. Two keys of the same kind could in principle hash to the same ID; if they do, the
  repeated-`_row_id` check fails the job rather than writing merged rows.
- **`_sources` lists one hop only**: the rows of this job's own inputs that the row was built from.
  Every row has at least one. Each entry's `table` must be one of the job's declared inputs and its
  `row_id` must exist in that input. Following entries hop by hop reaches raw data. Repeated
  entries are allowed, and tracing reads each one once. There is no limit on entries: an aggregate
  lists every input row it summarizes, so its `_sources` grows with its input.
- **Raw tables are the root.** They are what dlt writes, named `raw.<table>`, and have no
  `_sources`. A raw row is identified by its `_dlt_id`.
- **Only derived IDs are stable across runs.** dlt assigns a new `_dlt_id` on every load, so a
  derived row keeps its `_row_id` from run to run, but the raw row it traces to changes whenever
  its record is fetched again. Raw `row_id` values are only meaningful within a snapshot.
- **Raw holds every version a snapshot's runs fetched.** An incremental snapshot reads the last
  full run plus every run since (see [Snapshot layout](#snapshot-layout)), so the same record can
  appear more than once. A job reading raw keeps the latest version of each, by the source's own
  `updated` time and then `_dlt_load_id`, and lists only that version in `_sources`.
- **`_sources.row_id` is text** because it holds both derived `_row_id` values (`BIGINT`) and raw
  `_dlt_id` values (text) in one column.

`_sources` says which rows a row came from; `_fields` says which columns of those rows feed each
of its values (see [Column lineage](#column-lineage)). Neither holds both, so a row stores its
row ids once and its column names once.

## Jobs

A job is a folder named after the table it writes:

```
jobs/entities/
  job.toml    # description and inputs
  query.sql   # one SELECT, returning _row_id, _sources and _fields
```

```toml
description = "One row per Jira issue and per pull request: the latest raw version of each."
inputs = ["raw.jira_issues", "raw.github_pulls"]
```

A job sees only its declared inputs: `raw.<table>` for raw data and the bare name for another
job's table. Shared jobs live in `pipeline/jobs/`. A client's jobs live in
`clients/<client>/jobs/`, and a client job with the same name as a shared one replaces it.

SQL jobs run in DuckDB with these helpers:

| Helper                  | Returns                                                         |
| ----------------------- | --------------------------------------------------------------- |
| `stable_id(kind, key)`  | A `_row_id` for `key`, namespaced by the client and `kind`      |
| `source_ref(table, id)` | One `_sources` entry                                            |
| `iso_utc(ts)`           | `YYYY-MM-DDTHH:MM:SSZ` text, the date format Waymark compares   |
| `getvariable(name)`     | `client`, `jira_base_url` or `ticket_key_pattern`               |
| `params.status_map`     | `(status, status_group)` from the client's `[mapping.statuses]` |
| `params.jira_fields`    | `(key, path, value_type)` from `[[mapping.jira_fields]]`        |

A row's order in the output follows the query's `ORDER BY`.

## Column lineage

`_fields` says, for each row, which input columns each of its values is computed from. With
`_sources` saying which input rows, this traces any single value to the exact fields of the exact
raw records behind it. Each job writes its own, in the query:

```sql
map {
  'name': ['raw.jira_issues.key'],
  'priority': ['raw.jira_issues.fields:$.priority.name']
} as _fields
```

- **References** are `<input>.<column>`, where `<input>` is one of the job's declared inputs. For
  a value inside JSON text, add a JSON path: `raw.jira_issues.fields:$.priority.name`.
- **Every row maps every output column** except the three contract columns. `[]` marks a
  constant, such as a fixed label, that reads no input column.
- **`_row_id` as a reference** means the row's identity rather than one of its values, as in a
  count of tickets: `'tickets': ['entities._row_id']`. Tracing follows all of that row's sources.
  For a raw input, `_dlt_id` plays the same role: `'issues': ['raw.jira_issues._dlt_id']`.
- **A filter names a subset of an input's rows**: `<input>[<column>=<value>].<column>` reads the
  column only in the source rows whose filter column holds that value, compared as text. Use it
  when a row's `_sources` mix kinds of rows and a value reads only one kind: a ticket's lead time
  lists the ticket and its pull requests, but reads only the pull requests' times, so it names
  `entities[type=change].created_at`. It also works on identity, as in
  `entities[type=change]._row_id` for a count of pull requests. The filter column must be text,
  and a filtered reference can't also take a JSON path. The value can hold anything but `[` and
  `]`, spaces included.
- **A value that can come from more than one place names the one it came from in that row.**
  `coalesce(a, b)` gets `case when a is not null then [...a] else [...b] end`, and a row of
  `entity_metadata` names the column its key reads:

  ```sql
  case key
    when 'priority' then map {..., 'value': ['entities.priority']}
    when 'author' then map {..., 'value': ['entities.author']}
    else map {..., 'value': ['entities.custom_fields']}
  end as _fields
  ```

  Every branch produces the same map type, `MAP(VARCHAR, VARCHAR[])`; an empty list types itself
  from its neighbours.

The runner also writes each table's **column map**, the union of every row's `_fields`, into the
output file's Parquet key-value metadata under `waymark_columns` as JSON. It lets a reader trace a
column across the whole table without scanning it, and needs no manifest.

Tracing one value carries, for every row it reaches, the columns of that row the value needs. At
the first hop they come from the row's own `_fields`, which are exact; past it, from each table's
column map. A row follows only those of its own `_sources` that its needed columns' references
name, and only the rows a filter matches; an identity reference, or a column no map declares,
follows all of the row's sources. A column map is the union over a table's rows, so it can name
a column of a table that this particular row doesn't read from. Following only the row's own
sources drops those, and a filter drops the rows of the right table that the value doesn't read.

**The runner can't tell that `_fields` is complete.** It checks that every reference exists, not
that the query reads nothing else. That is what `verify.py` is for, and the runner runs it after
building (see [Verification](#verification)).

## Checks

The runner refuses to write a table that breaks the contract:

- a missing or mistyped `_row_id` or `_sources` column;
- a null or repeated `_row_id`;
- a row with no `_sources`;
- a source entry that names an undeclared input or a row that does not exist;
- a missing or mistyped `_fields` column;
- a row whose `_fields` doesn't map exactly the output columns;
- a reference that is null or malformed, or names a table that isn't an input, a column that the
  input doesn't have, or a JSON path on a column that isn't text;
- a filter on a column the input doesn't have or that isn't text, or a filter together with a
  JSON path.

A failed job skips every job downstream of it.

## Verification

After building, the runner runs `verify.py` over every table it wrote, and the run fails if it
finds an error. For a few rows per distinct `_fields`, it re-runs the job on only the rows in
the row's `_sources` and expects the same row back, then changes each input column of those rows
in turn: every output column that changes must name that input in the row's `_fields`. A filtered
reference covers only the rows it matches, so the column is then changed in the other rows alone,
and the output must stay the same. It is a
test, not a proof: a change the query absorbs, such as a value that isn't the largest in a
`max()`, hides that dependency. `--no-verify` skips it.

## Snapshot layout

A client's files live under one bucket URL (`file://`, `s3://` or `az://`). Readers find tables
through a manifest, never by listing folders, so the layout is part of the contract:

```
<bucket>/
  raw/<table>/<run_id>.<load_id>.<file_id>.parquet   # what dlt wrote; append-only
  runs/<run_id>.json                                  # a finished extract run
  tables/<name>/<snapshot_id>.parquet                 # one file per job per snapshot
  tables/<name>/<snapshot_id>.changes.parquet         # its diff against the base snapshot
  snapshots/<snapshot_id>.json                        # the manifest
  latest.json                                         # {"snapshot", "manifest"}: the published one
```

- **An extract run is full or incremental**, and its run record, written once every source has
  loaded, says which. It also gives the run's `started_at`, which is the next incremental run's
  cursor, and its `chain`: the last full run, then every run after it, ending with this one. A
  run with no record failed or is still going, and is never built. A `limited` run (a smoke test)
  is never built on.

- **A snapshot is the unit of identity.** Its manifest lists every table's exact files, raw
  (`raw.<table>`, from every run in the chain) and derived, plus each built table's row count,
  inputs and `job` (a hash of the job's files), the status of each job and whether verification
  passed. It also names the run it was built from (`extract`), that run's chain (`runs`) and the
  `base`: the snapshot published when the build started.
- **Each built table's `changes`** lists the `_row_id`s added, changed or removed since the
  base, with a `change` column, plus their counts in the manifest. A row changed if any column
  other than `_row_id`, `_sources` and `_fields` did. `changes` is null when the base has no such
  table. A table version is
  `(name, snapshot_id)`. A job, `verify.py`, `trace.py` and Waymark all read a snapshot's tables
  from its manifest, so raw or tables written later can't change what a snapshot reads.
- **Nothing is rewritten.** Raw files are named after their run and dlt appends them; a table is
  written once per snapshot; a snapshot id is never reused. Only `latest.json` changes, and only
  after every job built and verified, and never back to an older snapshot. That's also what object stores require, since they can't
  rename: no reader ever trusts a file that may still be half written.
- **`raw.<table>`** is the union of the manifest's files for it, read with `union_by_name`,
  because dlt can add columns between loads. Folders starting with `_dlt` hold dlt's own
  bookkeeping and are not tables.
- **Names**: table and job names use only letters, digits and `_`, and don't start with a
  digit. Run and snapshot ids use letters, digits, `_` and `-`. Manifest file keys are relative
  to the bucket and never contain `..`.
- **Retention**: old snapshots can be expired by age (an object-store lifecycle rule on `raw/`
  and `tables/`), as long as nothing still published reads an expired file. A snapshot reads raw
  as old as its chain's full run, so a rule on `raw/` must outlive the interval between full runs
  plus the run interval, or follow the manifests.

## What Waymark reads

- A snapshot must contain `entities` and `entity_metadata`, the tables Waymark browses.
- In `entities`, `id` equals `_row_id`, so every entity is also its own lineage row.
- Entity queries read a view of each table without `_row_id`, `_sources` and `_fields`, so
  they never read the lineage columns. Lineage reads the full table from the `lineage` schema.
- Waymark compares the date columns of `entities` and `entity_metadata` as text, so they hold
  `iso_utc` text. Other timestamps are shown in UTC.
- For a derived table, Waymark converts `_sources.row_id` back to `BIGINT` to match `_row_id`.
- Waymark traces a field from the row's own `_fields`, then each table's column map from its
  Parquet metadata. A table without a valid map still shows row lineage, and a field traced
  through it follows all of its sources.
