# Table contract

Every job writes entities. Raw data aside, a snapshot has two tables, `entities` and
`entity_metadata`, and each job adds its own part to them: a job never writes a table of its own.
Every row of those tables follows this contract. It lets Waymark trace any entity, and any one of
its values, back to the raw records it came from, one hop at a time, without a separate lineage
manifest. The contract is about the rows, not the language that builds them: a job is a SQL
query or a container image (see [Container jobs](#container-jobs)).

## Required columns

A job returns these, and the runner carries them onto every entity and metadata row it writes:

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
  `row_id` must exist in that input.
- **`_sources` cites entities, never metadata rows.** A job that reads an entity's metadata lists
  the entity, `source_ref('entities', entity_id)`, and so also reads `entities[type=x]` for it.
  Lineage then always names something Waymark shows: a ticket or a pull request, not one of its
  metadata rows. Following entries hop by hop reaches raw data. Repeated
  entries are allowed, and tracing reads each one once. There is no limit on entries: an aggregate
  lists every input row it summarizes, so its `_sources` grows with its input.
- **Raw tables are the root.** They are what dlt writes, named `raw.<table>`, and have no
  `_sources`. A raw row is identified by its `_dlt_id`.
- **Only derived IDs are stable across runs.** dlt assigns a new `_dlt_id` on every load, so an
  entity keeps its `_row_id` from run to run, but the raw row it traces to changes whenever its
  record is fetched again. Raw `row_id` values are only meaningful within a snapshot.
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

A job is a folder named after the job:

```
jobs/tickets/
  job.toml    # description, inputs, and the entity type it makes or adds to
  query.sql   # one SELECT, returning _row_id, _sources and _fields
```

```toml
description = "One ticket per Jira issue: the latest raw version of each."
inputs = ["raw.jira_issues"]
entity_type = "ticket"
```

A job sees only its declared inputs: `raw.<table>` for raw data, read whole, and an entity table
narrowed to the types it reads, `entities[type=ticket]` or `entity_metadata[entity_type=ticket]`.
A job that reads a type's metadata reads its entities too, since it cites them in `_sources`, and
reads only `entity_id`, `key` and `value` (or `value_type`) of a metadata row: its date and type
are its entity's, read from `entities`.
A job can name several types of one table; the query still reads it as `entities` or
`entity_metadata`, holding only those types' rows. An entity table can't be read whole, since
every job adds to it. Shared jobs live in `pipeline/jobs/`. A client's jobs live in
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

## What a job writes

Every job's `job.toml` sets exactly one of these:

- **`entity_type = "x"`: each row is a new entity of type `x`.** The row names it: a text `name`,
  and `created_at` as `iso_utc` text, which is what Waymark's date range filters on. Neither may
  be null or empty. Its `_row_id` is the entity's `id`, and can't be an existing entity's. Name
  rows with `stable_id('<job name>', <key>)` to stay clear of other jobs. No two jobs make one type.
- **`adds_to = "x"`: each row adds metadata to the existing `x` entity whose id is its
  `_row_id`.** A row whose `_row_id` isn't an `x` entity's id is refused. Lead time is added to
  each ticket this way, by a job that reads the links between tickets and pull requests.

Either way, **every other column is metadata**: one `entity_metadata` row per entity and column,
skipping nulls. The key is the column's name, so it must be lowercase letters, digits and `_`, and
not `id`, `type`, `name` or `created_at`, which are the entity's own. No two jobs write the same
key for one type. The value type comes from the column's type: text is `string`, any number is
`number`, a boolean is `boolean`, and a date or timestamp is `date`, written as `iso_utc` text (a
timestamp without a zone is taken as UTC). Lists, structs and maps are refused, except one:

- **`_metadata`, of type `LIST<STRUCT("key" VARCHAR, "value" VARCHAR, value_type VARCHAR)>`,
  holds metadata whose keys the query can't name in advance**, such as a client's configured Jira
  fields. Each entry with a value becomes one more metadata row, with the key rules above;
  `value_type` is `string`, `number`, `date` or `boolean`, and a key can appear once per row.

**What a job reads decides when it runs.** Reading `entities[type=x]` waits for the job that makes
`x`. Reading `entity_metadata[entity_type=x]` waits for that job and every job that adds to `x`,
except one that reads the reading job itself, directly or not: a job can't see metadata computed
from its own entities. So the links job reads pull requests' titles, but not the ticket keys the
links themselves add to them. A job can't read the type it makes, and a job that adds to a type
waits for the job that makes it. The manifest records the exact files each input read.

**The runner writes each job's part of both tables**, and nothing else. An entity's `name` and
`created_at`, and each metadata value, keep the `_sources` of the job's row and the `_fields`
entry of their own column, so lineage goes straight from them to whatever the job read. Metadata
rows name their type in `entity_type` and are dated like their entity. Every part follows
[Required columns](#required-columns), and an `entities` row's `id` equals its `_row_id`.

## Container jobs

A job that needs real code, with its own unit tests, is a container image instead of a query. Its
folder holds only `job.toml`:

```toml
description = "Lead time by issue type, from each ticket's metadata."
kind = "container"
image = "ghcr.io/acme/lead-time@sha256:<64 hex digits>"
inputs = ["entity_metadata[entity_type=ticket]"]
entity_type = "lead_time_by_issue_type"
```

- **The image is pinned by digest**, `<repository>@sha256:<digest>`, or by a local image id
  (`sha256:<id>`) for a local build. A tag can move, so it is refused. The code lives in a normal
  repository with its own CI; the job folder only pins what that CI built. The job's version
  hash covers `job.toml`, so a new digest is a new version.
- **Inputs are staged, not shared.** The runner copies each declared input, resolved through the
  snapshot's manifest and narrowed to its types, to one Parquet file and mounts the folder
  read-only at `/waymark/in`. The container runs with no network, a read-only filesystem apart
  from `/tmp`, and the runner's user, so it can't read anything it didn't declare or reach the
  bucket.
- **It is told where things are** in environment variables:

  | Variable          | Holds                                                                               |
  | ----------------- | ----------------------------------------------------------------------------------- |
  | `WAYMARK_INPUTS`  | JSON: input table → Parquet path, such as `/waymark/in/entity_metadata.parquet`     |
  | `WAYMARK_CHANGES` | JSON: `entities` → its change file, when the snapshot diffed every type it reads    |
  | `WAYMARK_PARAMS`  | JSON: `client`, `jira_base_url`, `ticket_key_pattern`, `statuses` and `jira_fields` |
  | `WAYMARK_OUTPUT`  | The path to write the output to, as one Parquet file                                |

  Raw inputs keep their `raw.<table>` names. A change file has a row per entity id that was added,
  changed or removed since the base snapshot (see [Snapshot layout](#snapshot-layout)). It is a
  hint for a job that can use it: the output is still every row.

- **The output follows the same contract** and gets the same checks and diff as a SQL job's.
  `_row_id`, `_sources` and `_fields` must have the types in
  [Required columns](#required-columns), so write them with a Parquet writer that sets them
  exactly. To get the `_row_id`s a SQL job's `stable_id` would, use its formula: the first 14
  hex digits of `md5("<client>:<kind>:<key>")`, as an integer, masked to 53 bits.
- **A non-zero exit, or no output file, fails the job**, and everything downstream of it is
  skipped. The tail of its stderr is in the runner's log.
- **Verification re-runs the container**, on the same small inputs it gives a SQL job. Each
  replay runs the whole container, so a container job takes longer to verify (about 0.35 s per
  run with Docker on a laptop); outputs are reused when a lookup's inputs are ones it already ran.

`containers/lead-time/` is an example: a TypeScript job, tested with `bun test`, that writes the
same entities as the SQL job in `containers/lead-time/reference/lead_time_by_issue_type`.

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

- **References** are `<input>.<column>`, where `<input>` is one of the job's declared inputs,
  named as its query reads it: `entities` or `raw.<table>`. For a value inside JSON text, add a
  JSON path: `raw.jira_issues.fields:$.priority.name`.
- **An entity's metadata value is `entities.<key>`**, as if it were a column of the entity:
  `entities.merged_at` is a pull request's merge time. The key must be one the job's
  `entity_metadata` input holds, and can't take a JSON path. A reference never names
  `entity_metadata`: tracing `entities.merged_at` goes from the entity to that one value's own
  `_sources` and `_fields`, found by entity id and key, so it is as exact as naming the metadata
  row, and the hop shows the entity.
- **Every row maps every output column** except the three contract columns, `_metadata`
  included: its references cover all of its entries. `[]` marks a constant, such as a fixed
  label, that reads no input column.
- **`_row_id` as a reference** means the row's identity rather than one of its values, as in a
  count of tickets: `'tickets': ['entities._row_id']`. Tracing follows all of that row's sources.
  An entity's own sources are the ones its making job listed: its identity doesn't stand for the
  metadata other jobs added to it, so a value that reads one names its key.
  For a raw input, `_dlt_id` plays the same role: `'issues': ['raw.jira_issues._dlt_id']`.
- **A filter names a subset of an input's rows**: `<input>[<column>=<value>].<column>` reads the
  column only in the source rows whose filter column holds that value, compared as text. A job
  that cites entities of several types needs it most: a ticket's lead time cites its links and
  their pull requests, and names `entities[type=change].merged_at` for the merge times alone. It
  also works on identity, as in `entities[type=change]._row_id` for a count of pull requests. The
  filter column must be one of the input's own text columns, not a metadata key, and a filtered
  reference can't also take a JSON path. The value can hold anything but `[` and `]`, spaces
  included.
- **A value that can come from more than one place names the one it came from in that row.**
  `coalesce(a, b)` gets `case when a is not null then [...a] else [...b] end`. Every branch
  produces the same map type, `MAP(VARCHAR, VARCHAR[])`; an empty list types itself from its
  neighbours.

The runner also writes each part's **column map**, the union of its rows' `_fields`, into the
file's Parquet key-value metadata under `waymark_columns` as JSON. A table's column map is the
union of its parts' maps.

Tracing one value carries, for every row it reaches, the columns of that row the value needs, and
follows only those of the row's own `_sources` that the row's own `_fields` for those columns
name, and only the rows a filter matches. An identity reference follows all of the row's sources.
An entity needed for a metadata key follows that key's metadata row instead, within the same hop.
Only a row that declares nothing for a column falls back to its table's column map, which is the
union over every job that writes the table, so it is coarse.

**The runner can't tell that `_fields` is complete.** It checks that every reference exists, not
that the query reads nothing else. That is what `verify.py` is for, and the runner runs it after
building (see [Verification](#verification)).

## Checks

The runner refuses to write a job's parts when its output breaks the contract:

- a missing or mistyped `_row_id` or `_sources` column;
- a null or repeated `_row_id`;
- a row with no `_sources`;
- a source entry that names an undeclared input or a row that does not exist, or names
  `entity_metadata` at all;
- a missing or mistyped `_fields` column;
- a row whose `_fields` doesn't map exactly the output columns;
- a reference that is null or malformed, names `entity_metadata` or a table that isn't an input,
  names a column the input doesn't have (or, on `entities`, a metadata key its `entity_metadata`
  input doesn't hold), or puts a JSON path on a column that isn't text or on a metadata key;
- a filter on a column the input doesn't have or that isn't text, or a filter together with a
  JSON path;
- anything [What a job writes](#what-a-job-writes) rules out: a missing name or date, a metadata
  key or type that can't be one, a malformed `_metadata`, an entity id that already exists, an id
  to add to that isn't its type's, or a key another job already writes for the type.

A failed job skips every job downstream of it.

## Verification

After building, the runner runs `verify.py` over every job it ran, and the run fails if it finds
an error. It checks a job by what its rows became: each entity's name and date, and each metadata
value as the text and value type it was written as. For a few entities per distinct `_fields` of
each key, it re-runs the job on only the rows in the row's `_sources`, and the metadata of the
entities among them, and expects the same
values back, then changes each input column of those rows in turn: every value that changes must
name that input in the row's `_fields`. A `_metadata` key answers to `_metadata`'s references.
Metadata a job read is changed one key at a time, value and value type together, and answers to
`entities.<key>`; a metadata row's `created_at`, `updated_at` and `entity_type` answer to
`entities.created_at` and `entities.type`, the entity's own. A
filtered reference covers only the rows it matches, so the column is then changed in the other
rows alone, and the output must stay the same. A change to a column the `_row_id` is built from,
such as a grouping key, renames the row; verify then compares the one new row built from the same
`_sources`, so a group key's own value must be declared like any other. Only a row that no longer
appears at all (a filter or join dropped it) counts as depending on the input to exist. It is a
test, not a proof: a change the query absorbs, such as a value that isn't the largest in a
`max()`, hides that dependency. `--no-verify` skips it.

## Snapshot layout

A client's files live under one bucket URL (`file://`, `s3://` or `az://`). Readers find tables
through a manifest, never by listing folders, so the layout is part of the contract:

```
<bucket>/
  raw/<table>/<run_id>.<load_id>.<file_id>.parquet   # what dlt wrote; append-only
  runs/<run_id>.json                                  # a finished extract run
  tables/entities/<snapshot_id>.<job>.parquet         # a job's entities, if it makes a type
  tables/entity_metadata/<snapshot_id>.<job>.parquet  # a job's metadata
  changes/<job>/<snapshot_id>.parquet                 # a job's diff against the base snapshot
  snapshots/<snapshot_id>.json                        # the manifest
  latest.json                                         # {"snapshot", "manifest"}: the published one
  jobs/<name>/versions/<version>/                     # the client's job registry (registry.py)
  jobs/<name>/active                                  # the active version
```

- **An extract run is full or incremental**, and its run record, written once every source has
  loaded, says which. It also gives the run's `started_at`, which is the next incremental run's
  cursor, and its `chain`: the last full run, then every run after it, ending with this one. A
  run with no record failed or is still going, and is never built. A `limited` run (a smoke test)
  is never built on.
- **A snapshot is the unit of identity.** Its manifest (version 2) has `tables`: every table's
  exact files, raw (`raw.<table>`, from every run in the chain) and the two entity tables, each
  the parts of its jobs in build order, keyed by job under `parts`. It has `jobs`: for each job,
  the `files` of its parts, its row count, `inputs` and `read` (the exact files each input
  resolved to), the type it makes or adds to, `job` (a hash of the job's files, which is also its
  version in the registry) and `params` (a hash of the client's parameters). And it has the
  status of each job (`built`, `reused`, `failed` or `skipped`), whether verification passed, the
  run it was built from (`extract`), that run's chain (`runs`) and the `base`: the snapshot
  published when the build started. A preview's manifest has `preview`: the job and version it
  tried; it's never published. A base in an older manifest version is ignored, and everything is
  built.
- **A job can be reused.** When the base was verified and ran a job with the same `job`, `params`,
  inputs and input files, the snapshot lists the base's parts for it instead of running it again.
  Its entry has `built_in`, the snapshot that wrote the parts, and an empty change file.
- **Each job's `changes`** lists the entity ids whose values from that job were added, changed or
  removed since the base, with a `change` column, plus their counts in the manifest. An entity
  changed if its name, date or any of the job's metadata values for it did; lineage doesn't count.
  `changes` is null when the base has no parts from the job. A job, `verify.py`, `trace.py` and
  Waymark all read a snapshot's files from its manifest, so raw or parts written later can't
  change what a snapshot reads.
- **Nothing is rewritten.** Raw files are named after their run and dlt appends them; a part is
  written at most once per snapshot; a snapshot id and a job version are never reused. Only
  `latest.json` and a job's `active` change, and `latest.json` only after every job ran or was
  reused and verified, and never back to an older snapshot. That's also what object stores
  require, since they can't rename: no reader ever trusts a file that may still be half written.
- **`raw.<table>`** is the union of the manifest's files for it, read with `union_by_name`,
  because dlt can add columns between loads. Folders starting with `_dlt` hold dlt's own
  bookkeeping and are not tables.
- **Names**: entity types and job names use only lowercase letters, digits and `_`, and don't
  start with a digit. Run and snapshot ids use letters, digits, `_` and `-`. Manifest file keys
  are relative to the bucket and never contain `..`.
- **Retention**: old snapshots can be expired, as long as nothing still published reads an
  expired file. A snapshot reads raw as old as its chain's full run, and a reused job's parts are
  as old as the snapshot that wrote them, however long that job has gone unchanged. So expire by
  following the manifests, not by age alone: an age rule on `tables/` could delete a file the
  published snapshot still reads. Never expire `jobs/`; manifests name versions in it.

## What Waymark reads

- A snapshot's `entities` and `entity_metadata`, every file their manifest entries list. Waymark
  accepts manifest versions 1 and 2, which list files alike.
- In `entities`, `id` equals `_row_id`, so every entity is also its own lineage row.
- Entity queries read a view of each table without `_row_id`, `_sources` and `_fields`, so
  they never read the lineage columns. Lineage reads the full table from the `lineage` schema.
- Waymark compares the date columns of `entities` and `entity_metadata` as text, so they hold
  `iso_utc` text. Other timestamps are shown in UTC.
- For a derived table, Waymark converts `_sources.row_id` back to `BIGINT` to match `_row_id`.
- Waymark traces a field through each row's own `_fields`, falling back to the table's column
  map, the union of its parts' Parquet metadata, only where a row declares nothing. A row without
  either still shows row lineage, and a field traced through it follows all of its sources.
