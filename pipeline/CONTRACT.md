# Table contract

Every table a job writes follows this contract, whatever language the job is written in. It lets
Waymark trace any row back to the raw records it came from, one hop at a time, without a separate
lineage manifest.

## Required columns

| Column     | Type                                            | Meaning                                    |
| ---------- | ----------------------------------------------- | ------------------------------------------ |
| `_row_id`  | `BIGINT`                                        | Identifies the row. Unique and never null. |
| `_sources` | `LIST<STRUCT("table" VARCHAR, row_id VARCHAR)>` | The input rows this row was built from.    |

- **`_row_id` comes from business keys**, never from load order, so the same ticket or the same
  "P1 / Platform" aggregate keeps its ID from one run to the next. Use `stable_id(kind, key)`: an
  md5-based 53-bit integer, so it survives a JavaScript number and does not change between DuckDB
  versions.
- **`_sources` lists one hop only**: the rows of this job's own inputs that the row was built from.
  Every row has at least one. Each entry's `table` must be one of the job's declared inputs and its
  `row_id` must exist in that input. Following entries hop by hop reaches raw data.
- **Raw tables are the root.** They are what dlt writes, named `raw.<table>`, and have no
  `_sources`. A raw row is identified by its `_dlt_id`.

Field-level lineage is out of scope for now.

## Jobs

A job is a folder named after the table it writes:

```
jobs/tickets/
  job.toml    # description and inputs
  query.sql   # one SELECT, for SQL jobs
```

```toml
description = "One row per Jira issue: the latest raw version of each."
inputs = ["raw.jira_issues"]
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

## Checks

The runner refuses to write a table that breaks the contract: a missing or mistyped column, a
null or repeated `_row_id`, a row with no `_sources`, or a source entry that names an undeclared
input or a row that does not exist. A failed job skips every job downstream of it.
