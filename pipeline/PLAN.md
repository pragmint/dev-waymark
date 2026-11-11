# Row-lineage pipeline plan

Working plan for replacing the dbt + derived-tables prototype with a language-agnostic, row-level
lineage pipeline. Status as of 2026-11-09.

- **Worktree:** `/Users/pratt/Developer/dev-waymark-lineage`
- **Branch:** `row-lineage-pipeline` (from `main`)
- **Old exploration (reference only):** branch `duckdb-pipeline` in
  `/Users/pratt/Developer/dev-waymark`, mostly uncommitted. It has the dbt project, `derive.py` and
  the in-Waymark derived-tables engine. Don't build on it.

## Why

From the call with Dave Moore (stakeholder):

- **The goal:** click a number on a Waymark chart (e.g. average lead time for P1 tickets on team
  X) and drill through every derivation, over several hops, to the raw Jira or GitHub records
  behind it.
- **Lineage travels with the row.** Dave doesn't want a manifest that grows huge.
- **Transforms in any language.** Some client logic (e.g. "Team A deploys with Jenkins, Team C
  with Gearset") needs real code with unit tests, such as TypeScript. SQL can't be the only option.
- **dbt forces dbt's conventions** and only gives table-level lineage, so it was dropped.
- **dlt for extraction stays.** Bulk-pull everything, then work offline.
- **Transforms live outside Waymark.** Waymark only reads what the pipeline wrote.
- **Incremental loading is preferred.**
- **Per-client jobs should be able to live in a bucket**, not only a repo.

## Decisions

1. **Row-level contract.** It's in [CONTRACT.md](CONTRACT.md), which is the source of truth. Every
   table has:
   - `_row_id BIGINT`: a stable 53-bit md5 hash of business keys, never load order;
   - `_sources LIST<STRUCT("table" VARCHAR, row_id VARCHAR)>`: the input rows one hop up.

   Raw tables are the root, named `raw.<table>`, and a raw row's ID is its `_dlt_id`.

   **Field-level lineage** (added 2026-11-06, moved into the rows 2026-11-09): every row has
   `_fields MAP(VARCHAR, VARCHAR[])`, giving the input columns (and JSON paths) behind each of its
   values. It holds column names only, never row ids, so it stays small. The runner checks it and
   stores the union over the table's rows in the Parquet metadata as the table's column map.
   Combined with `_sources`, it traces one value to the exact raw fields behind it. Per-value
   row sources were rejected as too costly per row.

2. **Jobs are folders** with `job.toml` (description, inputs) and `query.sql`, which returns
   the three contract columns. Shared jobs are in
   `pipeline/jobs/`; client jobs are in `pipeline/clients/<client>/jobs/` and override shared jobs
   by name. Container jobs come later; see Phase 5.
3. **Incremental v1 means "compute in full, write the diff".** Each job recomputes its output.
   The runner compares the result with the previous snapshot by `_row_id` plus a row hash and
   writes the changes. True input-incremental is an optional later optimization.
4. **Raw is append-only.** A raw row never changes once written, so lineage to the exact version
   of a record stays valid.
5. **Storage:** one Parquet file per table per snapshot, found through the snapshot's manifest
   (Phase 2e). Consider DuckLake once full rewrites get slow.
6. **Central orchestrator.** It builds the job graph from declared inputs, rejects cycles, and
   runs only what's downstream of a change. Jobs don't decide for themselves. Dagster was
   considered, but jobs registered in a bucket at runtime fit it awkwardly, so lean toward a small
   in-house orchestrator.

## Phases

### Phase 0: fresh branch (done)

- Branched from `main` and brought in `extract.py`, its tests and `clients/apache-kafka.toml`
  from commit `a7d5e76`.
- Brought in the DuckDB source adapter (`src/db/source/duckdb.ts`, its tests, and the factory,
  config, build and package changes) and the `CASE` fix in `src/db/entityRepository.ts`. Without
  that fix DuckDB casts non-number values and errors.
- Removed dbt from `pyproject.toml`.

### Phase 1: contract, runner, jobs (done)

- Added `CONTRACT.md`, `runner.py`, `trace.py` and `tests/test_runner.py`.
- Shared jobs: `tickets`, `changes`, `ticket_change_links`, `entities`, `entity_metadata`. Kafka
  job: `lead_time_by_issue_type`.
- On the Kafka run (`/Users/pratt/Developer/dev-waymark/pipeline/.data/runs/full/raw`):
  - all jobs build in about 1.4 s;
  - `entities` and `entity_metadata` are identical to the old dbt output, ignoring the contract
    columns and the metadata `id`;
  - the "Task" lead-time row traces to 387 Jira issues and 596 PRs in two hops.
- Tests: 34 pytest, 548 bun, and `bun check` all pass.
- **Not yet done:** viewing the new tables in Waymark in a browser. Zod drops the extra columns, so
  it should work. Command in [README.md](README.md).
- **Not committed yet.**

### Phase 2: drill-down in Waymark (done)

- **Adapter** (`src/db/source/duckdb.ts`): registers every `tables/*.parquet` as a view, and every
  raw table in the run's sibling `raw/` folder as `raw.<table>`, skipping dlt's `_dlt*` tables. It
  still requires `entities` and `entity_metadata`. It sets the DuckDB session to UTC so timestamps
  read the same on any host. Adapters that aren't a pipeline run don't implement
  `listLineageTables()`, and lineage is hidden.
- **Hop planner** (`src/domain/lineage.ts`, pure): `groupSourcesByTable` and `planHop` (one lookup
  per table, by `_row_id` or `_dlt_id`). `expandToRaw` takes the fetcher as a parameter, follows
  every hop, expands each row once, and collects raw rows found at any depth. A hop limit stops
  malformed cycles.
- **Repository** (`src/db/lineageRepository.ts`): ids are passed as one JSON parameter, as
  `inList` does. Listings cut text columns to 160 characters in SQL, so Jira's `fields` never
  ships in full except on the raw record's own page.
- **Routes:**
  - `GET /lineage/:table/:rowId`: the row, then its parents grouped by table, each linked onward,
    100 per table (`?limit=all` shows up to 5000). Raw rows render as JSON, with nested JSON text
    such as Jira's `fields` parsed.
  - `GET /lineage/:table/:rowId/raw`: expand to raw. Shows the rows at each hop and the leaf set.
  - The entity detail page has a "Trace lineage" link when the source is a pipeline run.
- **On the Kafka run:** the "Task" lead-time row expands to 387 Jira issues and 596 PRs, the same
  as `trace.py`. The row page loads in about 60 ms and expand-to-raw in about 130 ms.
- **Tests:**
  - unit tests in `src/domain/lineage.test.ts` and `src/db/lineageRepository.test.ts`, which use a
    small fixture run in `src/db/source/lineageFixture.ts`;
  - E2E in `test/lineage.spec.ts`: entity → tickets → raw Jira, plus expand-to-raw and 404s;
  - `strictTest.ts` gained a worker option, `test.use({ sourceFixture: 'lineage' })`, which boots
    that worker's server on the fixture through DuckDB.

  577 bun, 110 E2E and 34 pytest tests pass, as does `bun check`.

- **Not yet done:**
  - clicking a chart value to open lineage. Charts are built from `entities`, so this needs a way
    to map a chart point to rows of a pipeline table;
  - paging past 5000 rows per table;
  - a CSV of the leaf set.
- **Not committed yet.**

### Phase 2b: field-level lineage (done)

- **Contract:** `[columns]` in every `job.toml`, written into the Parquet key-value metadata.
  Details are in [CONTRACT.md](CONTRACT.md#column-lineage).
- **Runner:** checks that the map covers every output column, and that each referenced input,
  column, JSON path and `by` column exists. All six jobs have maps.
- **SQL jobs declare their map rather than having it derived.** sqlglot can't trace
  `json_extract_string(fields, [paths])[n]` back to a JSON path, so it would miss the paths
  `tickets` needs most. It could still serve later as a cross-check.
- **Waymark:**
  - `src/domain/columnLineage.ts` computes a field's closure over the maps, plus a `follow`
    filter for `expandToRaw`;
  - field names on a row page link to `?field=`, which shows only the sources that field reads,
    with those columns highlighted;
  - expand-to-raw takes `?field=` too and extracts JSON paths as columns.
- **On the Kafka run:**
  - "Task" `avg_lead_time_hours` reaches 596 PRs, using only `created_at` and `merged_at`, with
    the 387 tickets dropped;
  - an `entity_metadata` value keyed `author` reaches `raw.github_pulls.user:$.login`.
- **`trace.py --field <column>`** runs the same walk as Waymark's `traceField`, reusing the
  runner's reference parser. It prints the hops and a few sample values of each raw field.
- **Tests:** 50 pytest, 599 bun and 111 E2E pass.
- **Not yet done:**
  - an optional sqlglot cross-check of declared maps;
  - a chart click that opens field lineage directly.

### Phase 2c: lineage verification (done, 2026-11-09)

- **`verify.py`** tests the contract by re-running a job on small inputs. It samples a few rows
  per value of each `by` column, picked by a hash of `_row_id`.
  - **Replay:** run the job on only the rows in a row's `_sources`. It must reproduce the row. If
    it doesn't, it swaps in each input table in full to name the one with unlisted rows.
  - **Perturb:** change each input column of those rows three ways (shift, replace, swap null) and
    re-run. An output that changes must declare the input. For a JSON column, it changes every
    leaf except the declared paths, then narrows to the undeclared path. A declared reference no
    change affects is a warning, unless the row disappeared, which counts as a use.
  - It reads only the run's files and the job, so it works for any job language once Phase 5
    exists. It's the natural gate for `promote` in Phase 4.
- **On the Kafka run, 10 rows per branch, about 2 min:** every job passes. It found three gaps,
  now fixed:
  - **`_sources` missed the links.** Rollups in `entity_metadata` (`change_count`,
    `first_change_at`, `last_merged_at`, `ticket_keys`) and every `lead_time_by_issue_type` row
    read `ticket_change_links` rows they didn't list. They now list them and declare
    `ticket_change_links._row_id`, so the "Task" lead time traces in three hops (via the 602
    links) to the same 387 issues and 596 PRs.
  - **`lead_time_by_issue_type.tickets`** didn't declare `changes.merged_at`, which its `having`
    filter reads.
  - **`entity_metadata` `ticket_keys`** declared `tickets.ticket_key` but reads
    `ticket_change_links.ticket_key`.
  - **Warnings that remain, all correct supersets:** `changes.repo` from `html_url` (fallback only);
    `tickets.status_group` from `$.status.name` (Kafka maps no statuses);
    `ticket_change_links.ticket_key` from title, branch and body (a key is in one of them);
    `entity_metadata.updated_at` from `created_at` (fallback only). Per-row `_fields` would make
    these exact.
- **Limits:** a test, not a proof; a change a query absorbs (non-max value in `max()`) hides a
  dependency. Jobs that read the whole table (ranks, percentiles) fail replay by design.
- **Tests:** 8 in `tests/test_verify.py`; 58 pytest pass.
- **Not yet done:** running it from the runner or `promote`; speed (`entity_metadata` is
  most of the time, about 0.4 s a row).

### Phase 2d: `_fields` in the rows (done, 2026-11-09)

- **The `[columns]` table in `job.toml` is gone.** Each query returns `_fields` beside
  `_sources`, so the map sits next to the expressions it describes and works for any job
  language. `load_job` rejects a leftover `[columns]`.
- **`by`/`when`/`else` is gone.** A row names the branch it took, with `CASE`. This made the four
  Phase 2c warnings exact: `changes.repo` names `base:$.repo` or `html_url`, `tickets.status_group`
  names `$.status.name` only when the client mapped the status, a link's `ticket_key` names the
  texts the key was found in, and `entity_metadata.updated_at` names `created_at` only when it
  fell back to it.
- **Runner:** checks `_fields` on `SELECT DISTINCT _fields`: every row maps exactly the output
  columns, and every reference parses and exists. It writes the union as `waymark_columns`, a
  plain `{column: [refs]}`.
- **Verification is required.** `runner.py` runs `verify.py` over every table it built and fails
  the run on an error; `--no-verify` skips it. `verify.py` samples per distinct `_fields` rather
  than per `by` value. `test_every_shared_job_passes_verification` runs it on every shared job, so
  a wrong `_fields` fails `pytest` too (about 13 s).
- **Waymark:** a row's own `_fields` gives the first hop; past it, the table maps. The plain views
  leave out `_fields` along with `_row_id` and `_sources`.
- **Tests:** 60 pytest, 601 bun and 4 lineage E2E pass.
- **Not yet done:**
  - re-running the Kafka extract and build. No run was on disk, so storage cost and verify time
    on real data are unmeasured;
  - exact deeper hops: reading each source row's `_fields` rather than the union. Phase 2c's
    custom-field values still name all of `tickets.custom_fields`, since a reference can't name
    one key of a map.

### Phase 2e: snapshots and S3 (done, 2026-11-09)

From the 11/9 call with Dave: data can change between a build and its verification, so verify
must read the same snapshot; Waymark should read only the latest one; S3 retention should handle
old versions.

- **Layout** (`snapshot.py`, [CONTRACT.md](CONTRACT.md#snapshot-layout)):
  - `raw/<table>/<run_id>.<load>.<file>.parquet`: dlt now appends, with the run id in each file
    name (`extra_placeholders`), so raw is append-only, as decision 4 requires;
  - `tables/<name>/<snapshot_id>.parquet`, written once;
  - `snapshots/<id>.json`: every table's exact files (raw included), rows, inputs, job version
    hash, status and verify result;
  - `latest.json`: moved last, only when everything built and verified.
- **Identity:** a table version is `(name, snapshot_id)`. The runner, `verify.py`, `trace.py`
  and Waymark all resolve tables through a manifest to explicit file lists, never globs, so a
  later extract can't change what a snapshot reads. Tested both ways: a unit test lands a new run
  between build and load, and the Waymark fixture has decoy files from an older run and snapshot.
- **Waymark:** `DEV_WAYMARK_SOURCE_DB_URL` is the bucket root; the adapter reads `latest.json`,
  then the manifest (Zod, `src/schemas/pipelineSnapshot.ts`). A manifest URL pins a snapshot; a
  plain folder still works. It resolves once at startup.
- **S3 and Azure: configuration only, no custom adapter.** Checked against SeaweedFS (S3) and
  Azurite, from Python DuckDB 1.5.6 and `@duckdb/node-api` (DuckDB 2.0.0): `COPY ... TO` with
  `KV_METADATA`, `read_parquet` lists, `glob`, `parquet_kv_metadata` and `read_text` all work, on
  Azure too (writes included). Extensions autoload. Three catches:
  - DuckDB's `credential_chain` ignores `AWS_ENDPOINT_URL` (it went to real AWS), so the endpoint
    for MinIO or R2 is passed explicitly; `secret_statements` / `secretStatements` turn the
    standard env vars into one `CREATE SECRET`. dlt and fsspec read `AWS_ENDPOINT_URL` as is.
  - Object stores can't rename, so the runner's `.partial` then `replace()` had to go. Write-once
    keys plus the pointer replace it.
  - Extensions download on first use; an offline image must `INSTALL` them at build time.
- **Kafka, end to end:**
  - built from the existing raw (copied into the new layout as run `20261102T000000Z`) in 35 s
    locally and 38 s on SeaweedFS, verification included (it was about 2 min in Phase 2c);
  - every job verified; one remaining warning: a link's `ticket_key` lists title, branch and
    body, and a key found in two of them survives perturbing either alone (a correct superset);
  - storage: 97 MB raw, 29 MB of tables per snapshot (`entity_metadata` is 20 MB of it);
  - `trace.py` and Waymark on `s3://` give the same "Task" lead-time trace as before (602 links,
    596 PRs, 387 issues); the row page takes 88 ms and expand-to-raw 182 ms;
  - a live `extract.py --max-pages 1` to S3 appended beside the old run; a `--no-publish`
    snapshot of it read only its 100 issues and left `latest.json` alone.
- **Tests:** 69 pytest (11 in `tests/test_snapshot.py`), 609 bun and 4 lineage E2E pass.
- **Not yet done:**
  - provisioning: Dave is setting up an AWS account to test on real S3;
  - Waymark picking up a new `latest.json` without a restart;
  - dlt's own Azure credentials (it doesn't take a connection string);
  - a retention rule. Fine by age today, since each snapshot reads only its own run's raw.
    Phase 3 changes that: an incremental snapshot reads older raw, so expiry must outlive the
    `--full` interval or follow the manifests.

### Phase 3: incremental (1–2 days)

- **Extract:**
  - ~~one stable dataset path per client~~ and ~~`write_disposition="append"`~~: done in 2e;
  - drop the throwaway `pipelines_dir` so dlt can restore cursor state from the bucket.
- **Cursors:**
  - Jira: add `updated >= "<cursor>"` to the JQL. JQL has minute precision, so allow overlap; the
    dedupe absorbs it.
  - GitHub pulls: there's no `since` filter, so sort by `updated` descending and stop at the
    cursor.
- **`--full`:** marks a full load. "Current" means the IDs in the last full load plus anything
  changed since, which is how deletes are detected. Run it weekly.
- **Layout:** the 2e layout, plus `<snapshot>.changes.parquet` beside each table file. A
  snapshot's raw entry lists the last full run's files plus every run since.
- **Runner:** writes the diff by `_row_id` plus a row hash.

### Phase 4: registry and orchestrator (1 day)

- **Bucket layout:**
  ```
  customers/<client>/jobs/<name>/versions/<content-hash>/{job.toml,query.sql}
  customers/<client>/jobs/<name>/active      # one line: the version hash
  shared/jobs/...                            # client job with the same name overrides
  ```
- **`orchestrate.py`:** extract → load the registry → build the graph and check for cycles → run,
  in topological order, the jobs whose inputs changed, whose active version changed, or all of
  them with `--full` → write the snapshot → move `latest.json`.
- **`promote`:** run a draft version into `preview/`, check it against the contract, then move
  `active`. This is also the hook for agent-written SQL.
- **Isolation:** a job's credentials are scoped to its client's prefix.

### Phase 5: container jobs (1 day)

- `job.toml` sets `kind = "container"` and `image = "...@sha256:..."`. The code lives in a normal
  repo with CI; the bucket only pins the image digest.
- The orchestrator runs `docker run` with:
  - `WAYMARK_INPUTS`: table → Parquet URI;
  - `WAYMARK_CHANGES`: table → change-file URI;
  - `WAYMARK_PARAMS`;
  - `WAYMARK_OUTPUT`.

  The runner then applies the same contract check and diff as for SQL jobs.

- Build one example TypeScript job with `bun test` that produces the same lead-time table as the
  SQL job.

## Gotchas found so far

- **Jira's raw `fields` JSON is large:** 412 MB for 20k Kafka issues, up to 1.8 MB per issue.
  - Read every path in one `json_extract_string(fields, [paths])` call; separate calls ran out of
    memory and were about 17× slower.
  - Never carry `fields` through a job; `tickets` keeps only the configured custom fields as a
    map.
  - Never use a correlated subquery over `fields`: DuckDB decorrelates by grouping on the whole
    JSON value.
- **Spilling:** in-memory DuckDB only spills to disk with an explicit `temp_directory`. The runner
  gives each job its own and removes it afterwards.
- **Waymark expects:**
  - dates as ISO UTC text (`iso_utc`), because it compares them as strings;
  - entity IDs that fit in 53 bits.
- **Ticket-key matching** replaces `_` with a space first, so `feature/kafka-1_fix` matches.
- **dlt** drops a column that is all null in a load, so `extract.py` declares the GitHub columns
  the jobs read.

## Open questions for Dave

- Should Waymark manage the job registry, or only display it?
- Is review in Waymark (version diff plus preview output) enough in place of PRs for jobs kept in
  a bucket?
