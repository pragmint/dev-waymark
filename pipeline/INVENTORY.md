# Inventory: `row-lineage-pipeline` vs `main`

As of 2026-11-23, at 57a0b4a: 21 commits, 108 files changed, about 14.9k lines added. About 3.7k of
those lines are on the Waymark side (`src/`, `test/`, `scripts/`); the rest are the Python pipeline
in `pipeline/`.

## Pipeline foundation

`pipeline/` is a separate Python project, run with uv inside `devenv shell`.

- The dlt + dbt prototype is replaced by a pipeline where lineage is stored in every row.
- **`extract.py`** pulls GitHub pull requests and Jira issues (Server or Cloud) into raw Parquet
  with dlt. What it fetches is the client's own: one source module each, starting as copies of
  `templates/client-app/sources/` (`github.py`, `jira.py`), chosen with `--sources`. The lock, run
  records and raw layout stay the pipeline's.
- **Row contract** ([CONTRACT.md](CONTRACT.md)): every row a job writes has `_row_id` (a stable
  53-bit ID per client), `_sources` (the rows it came from) and `_fields` (which input columns each
  output column read).
- **Jobs are folders** with `job.toml` and `query.sql`. Shared jobs are in `jobs/`, and a client's
  own jobs replace them by name. Every job writes entities (see
  [Everything is an entity](#everything-is-an-entity)). The shared jobs are `tickets`, `changes`,
  `ticket_change_links`, `ticket_lead_time` and `change_ticket_keys`. Lead time is each ticket's
  `lead_time_hours` metadata, which Waymark groups by issue type. Kafka also runs its own
  `lead_time_by_issue_type` and `lead_time_by_issue_type_monthly` jobs, the client template's
  examples.
- **`runner.py`** builds jobs in dependency order, refuses cycles, and runs each job seeing only the
  inputs it declares. It refuses to write a job's output that breaks the contract, and skips
  everything downstream of a failed job.
- **Proof dataset:** Apache Kafka's public Jira and the `apache/kafka` repository.

## Lineage in Waymark (`src/`)

- **DuckDB source adapter:** Waymark reads the pipeline's Parquet directly. Entity queries see the
  tables without the lineage columns; lineage pages see a full `lineage.<table>` schema.
- **Drill-down at `/lineage/:table/:rowId`:** follows a row hop by hop back to the raw record, with
  pages for a row, a raw record and a row that isn't found.
- **Field-level drill-down:** shows which input columns, JSON paths and filtered rows a single value
  came from (`columnLineage.ts`, `walkField`).
- **Entity detail page** links into lineage.
- **Tests:** unit tests, a lineage fixture and a Playwright e2e test (`test/lineage.spec.ts`).

## Field-level lineage and verification

- **Field lineage** started as a per-job column map in `job.toml`. It was replaced by per-row
  `_fields`, so lineage stays in the data.
- **`verify.py`** reruns a job on a sample of each table's source rows and changes the inputs one at
  a time. It flags lineage that is missing or wrong.
  - It found real bugs in the shipped jobs: rollups and lead-time rows missing a source, two wrong
    column maps, and a grouping key that declared it read nothing. All are fixed.
  - It now follows a row whose `_row_id` changes when one of its inputs changes.
- **`trace.py`** prints a row's or one value's lineage, hop by hop, on the command line.

## Snapshots and storage

- **Write-once layout:**
  - append-only `raw/`;
  - `tables/<entities|entity_metadata>/<snapshot>.<job>.parquet`, each job's part;
  - a manifest per snapshot, `snapshots/<id>.json`, listing exact files;
  - `latest.json`, moved only after the build and verify pass and never back to an older snapshot.
- **S3 and Azure** work through configuration only. Tested on SeaweedFS and Azurite, and on
  Cloudflare R2, where the demo snapshot is uploaded (about 10× slower than local disk).
- **Waymark** reads exactly the files a manifest lists, so files written later can't change what a
  snapshot shows.
- **Demo snapshot** in `pipeline/.data/demo-bucket`, plus a rehearsal copy kept as a fallback.

## Incremental loads

- **Run records** (`runs/<id>.json`) chain incremental runs back to the last full run. A failed run
  leaves no record, so nothing builds on it.
- **A lock** stops two extracts running against the same bucket at once.
- **Change files:** each job gets `changes/<job>/<snapshot>.parquet`, the entities whose values
  from it were added, changed or removed since the published snapshot.
- **Entities read raw directly**: the `tickets` and `changes` jobs write their entities straight
  from raw, with nothing between them.
- **References can name a subset of rows**, such as `entities[type=change].created_at`.

## Container jobs

- **A job can be a container image** pinned by digest. It runs with no network, a read-only
  filesystem and no credentials.
- **The runner copies the inputs in** as local Parquet files, then applies the same contract
  checks, change files and verify as for SQL jobs.
- **TypeScript example** (`containers/lead-time/`), with 14 `bun test` cases. It makes the same
  `lead_time_by_issue_type` entities and metadata as the client template's SQL job, which a
  Docker test checks.

## Job registry and orchestrator

- **`registry.py`** keeps job versions in the bucket. Each version is named by the hash of its files
  and written once. An `active` file picks the running version, and a client registry overrides the
  shared one.
- **Only what changed is rebuilt.** A job is reused when its version, the client's parameters and
  its input files are all unchanged.
- **`orchestrate.py`** has three commands:
  - `run`: extract, then build, verify and publish.
  - `preview`: build with one job at a new version; it's saved but never published.
  - `promote`: run a preview and make the version active only if it passed.
- **`verify.py --registry`** checks each job with the version that ran it.
- **Kafka timings**, measured before every job wrote entities: first run 62 s; a rerun with
  nothing new 0.3 s; a promote 4 s. The one-page quick-start build has since gone from 35 s to
  5 s, mostly because verify no longer replays a whole `entity_metadata` job.

## Developer experience

- **devenv** provides Python 3.13, uv (which runs `uv sync` on entering the shell), gh, the DuckDB
  CLI, and Postgres.
- **`bun check:pipeline` pre-commit hook:** runs pytest when pipeline code is staged, and `bun test`
  in any container that changed.
- **Docs:** [README.md](README.md) (quick start, command reference, registry, containers, S3 and
  Azure) and [CONTRACT.md](CONTRACT.md). `PLAN.md` is kept out of commits.
- **Tests:** 208 pytest tests in the pipeline, plus Waymark unit and e2e tests.

## Everything is an entity

- **No job writes a table of its own.** Raw data aside, a snapshot has only `entities` and
  `entity_metadata`, and each job writes its part of both. `entity_type = "x"` makes each row an
  entity of type `x`; `adds_to = "x"` adds each row's columns as metadata to the `x` entity its
  `_row_id` names. Every other column becomes metadata, and `_metadata` holds keys only known at
  run time, such as a client's Jira fields.
- **The shared jobs are split by type:** `tickets` and `changes` read raw; `ticket_change_links`
  makes a link entity per mention; `ticket_lead_time` and `change_ticket_keys` add the rollups to
  tickets and pull requests.
- **Inputs name the types they read**, `entities[type=x]` or `entity_metadata[entity_type=x]`.
  Reading a type's metadata waits for every job that adds to it, except one that reads the reader.
- **Lineage has no extra hop:** each metadata value keeps its job row's `_sources` and its own
  column's `_fields`, so a ticket's summary traces straight to its raw Jira record. `trace.py`
  and Waymark follow each row's own `_fields` at every hop, not a table-wide column map.
- **Verify checks what a job's rows became**, converting a replay with the same code the runner
  writes with.
- **Manifest version 2** lists jobs separately from tables; Waymark reads versions 1 and 2, and a
  base in version 1 is treated as no base.
- **The client template** (`templates/client-app/`) is published as the
  `pragmint/dev-waymark-client-template` GitHub template repo. Its workflows stay off in the
  template repo itself. Its two lead time jobs are also Kafka's own jobs.

## Still open

- **Testing on real S3** is waiting on Dave's AWS account.
- **Registry and orchestrator:**
  - limiting each client's credentials to its own part of the bucket;
  - showing the registry in Waymark;
  - a command to retire a job;
  - cleaning up previews and old snapshots by following the manifests;
  - scheduling.
- **Container jobs:**
  - pushing images from CI;
  - a faster verify for containers;
  - CPU, memory and time limits per job;
  - staging all of raw Jira on every run.
- **Questions for Dave:**
  - Should Waymark manage the registry or only display it?
  - Is review in Waymark enough in place of PRs?
  - Should Waymark trigger the first-stage jobs?
  - How exactly should Kafka lead time be defined?
  - How fresh does the data need to be?
  - Is he fine with having no Postgres comparison?
