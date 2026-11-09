# Table contract

Every table a job writes follows this contract. It lets Waymark trace any row back to the raw
records it came from, one hop at a time, without a separate lineage manifest. The contract is
about the tables, not the language that builds them, but the runner only runs SQL jobs today.

## Required columns

| Column     | Type                                            | Meaning                                    |
| ---------- | ----------------------------------------------- | ------------------------------------------ |
| `_row_id`  | `BIGINT`                                        | Identifies the row. Unique and never null. |
| `_sources` | `LIST<STRUCT("table" VARCHAR, row_id VARCHAR)>` | The input rows this row was built from.    |

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
  derived row keeps its `_row_id` from run to run, but the raw rows it traces to have different
  IDs in each run. Raw `row_id` values are only meaningful within the run that wrote them.
- **`_sources.row_id` is text** because it holds both derived `_row_id` values (`BIGINT`) and raw
  `_dlt_id` values (text) in one column.

`_sources` says which rows a row came from. Which columns of those rows feed each field is
declared once per job, in its column map (see [Column lineage](#column-lineage)).

## Jobs

A job is a folder named after the table it writes:

```
jobs/tickets/
  job.toml    # description, inputs and column map
  query.sql   # one SELECT
```

```toml
description = "One row per Jira issue: the latest raw version of each."
inputs = ["raw.jira_issues"]

[columns]
ticket_key = ["raw.jira_issues.key"]
priority = ["raw.jira_issues.fields:$.priority.name"]
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

Every job declares, under `[columns]` in `job.toml`, the input columns each output column is
computed from. Together with each row's `_sources`, this traces any single value to the exact
fields of the exact raw records behind it, with nothing stored per row.

- **References** are `<input>.<column>`, where `<input>` is one of the job's declared inputs. For
  a value inside JSON text, add a JSON path: `raw.jira_issues.fields:$.priority.name`.
- **Every output column** except `_row_id` and `_sources` has an entry. `[]` marks a constant,
  such as a fixed label, that reads no input column.
- **`_row_id` as a reference** means the row's identity rather than one of its values, as in a
  count of tickets: `tickets = ["tickets._row_id"]`. Tracing follows all of that row's sources.
  For a raw input, `_dlt_id` plays the same role: `issues = ["raw.jira_issues._dlt_id"]`.
- **A column whose source depends on another column** is keyed `by` that column. `when` maps
  each value of the key to its references, and `else` covers any other value:

  ```toml
  [columns.value]
  by = "key"
  else = ["tickets.custom_fields"]

  [columns.value.when]
  priority = ["tickets.priority"]
  author = ["changes.author"]
  ```

  For one row, the row's own key value picks the branch. For a table as a whole, every branch
  counts. TOML keys are always text, so the key value is compared as text, and a null key
  value matches as the empty string.

The runner writes the map into the output file's Parquet key-value metadata, under
`waymark_columns` as JSON, so it travels with the table and needs no manifest. A job written in
another language, once the runner supports one, will declare the same `[columns]` table.

Tracing a field narrows the row walk: from each table it follows only the source tables that
the field's columns read. A map must be a superset of what a row really used. For example,
`coalesce(a, b)` lists both `a` and `b`, even for a row whose value came from `a`.

**The runner cannot check that a map is complete.** It checks that every reference exists, not
that the query reads nothing else. A map that leaves out a column the query reads still passes,
and tracing that field quietly misses the inputs behind it. Keep the map in step with
`query.sql` by hand.

## Checks

The runner refuses to write a table that breaks the contract:

- a missing or mistyped `_row_id` or `_sources` column;
- a null or repeated `_row_id`;
- a row with no `_sources`;
- a source entry that names an undeclared input or a row that does not exist;
- a column map that leaves out an output column, declares a column the job doesn't output, or
  references a table that isn't an input, a column that the input doesn't have, a JSON path on
  a column that isn't text, or a `by` column the job doesn't output.

A failed job skips every job downstream of it.

## Run layout

Each run writes one folder. Readers find tables by path, so the layout is part of the contract:

```
<bucket>/runs/<run_id>/
  raw/<table>/*.parquet     # what dlt wrote; read as raw.<table>
  tables/<name>.parquet     # one file per job, named after the job
```

- **`raw/`**: every Parquet file under `raw/<table>/` together makes up `raw.<table>`, read
  with `union_by_name`, because dlt can add columns between loads. Folders starting with `_dlt`
  hold dlt's own bookkeeping and are not tables.
- **Names**: table and job names use only letters, digits and `_`, and don't start with a
  digit. Readers skip any other name.
- **`raw/` sits next to `tables/`**: Waymark is pointed at `tables/` and looks for raw data in
  `../raw`. Without it, lineage stops at the last derived table and shows only counts for the raw
  rows.

## What Waymark reads

- `tables/` must contain `entities` and `entity_metadata`, the tables Waymark browses.
- In `entities`, `id` equals `_row_id`, so every entity is also its own lineage row.
- Entity queries read a view of each table without `_row_id` and `_sources`, so they never
  read the lineage columns. Lineage reads the full table from the `lineage` schema.
- Waymark compares the date columns of `entities` and `entity_metadata` as text, so they hold
  `iso_utc` text. Other timestamps are shown in UTC.
- For a derived table, Waymark converts `_sources.row_id` back to `BIGINT` to match `_row_id`.
- Waymark reads each table's column map from its Parquet metadata. A table without a valid map
  still shows row lineage, but its fields can't be traced one at a time.

Phase 3 of [PLAN.md](PLAN.md) replaces this layout with per-snapshot files and `latest.json`.
Waymark's DuckDB adapter (`src/db/source/duckdb.ts`) has to change with it.
