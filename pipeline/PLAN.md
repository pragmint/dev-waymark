# Row-lineage pipeline plan

Working plan for replacing the dbt + derived-tables prototype with a language-agnostic, row-level
lineage pipeline. Status as of 2026-11-06.

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

   Raw tables are the root, named `raw.<table>`, and a raw row's ID is its `_dlt_id`. Field-level
   lineage is out of scope for now.

2. **Jobs are folders** with `job.toml` (description, inputs) and `query.sql`. Shared jobs are in
   `pipeline/jobs/`; client jobs are in `pipeline/clients/<client>/jobs/` and override shared jobs
   by name. Container jobs come later; see Phase 5.
3. **Incremental v1 means "compute in full, write the diff".** Each job recomputes its output.
   The runner compares the result with the previous snapshot by `_row_id` plus a row hash and
   writes the changes. True input-incremental is an optional later optimization.
4. **Raw is append-only.** A raw row never changes once written, so lineage to the exact version
   of a record stays valid.
5. **Storage:** start with one Parquet file per table per snapshot, so Waymark's DuckDB adapter
   barely changes. Consider DuckLake once full rewrites get slow.
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

### Phase 3: incremental (1–2 days)

- **Extract:**
  - one stable dataset path per client instead of `runs/<run_id>`;
  - drop the throwaway `pipelines_dir` so dlt can restore cursor state from the bucket;
  - `write_disposition="append"`.
- **Cursors:**
  - Jira: add `updated >= "<cursor>"` to the JQL. JQL has minute precision, so allow overlap; the
    dedupe absorbs it.
  - GitHub pulls: there's no `since` filter, so sort by `updated` descending and stop at the
    cursor.
- **`--full`:** marks a full load. "Current" means the IDs in the last full load plus anything
  changed since, which is how deletes are detected. Run it weekly.
- **Layout:**
  - `tables/<t>/<snapshot>.parquet` with `<snapshot>.changes.parquet`;
  - `snapshots/<id>.json`, recording each table's file, job version and status;
  - `latest.json`, moved last.
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
