# Waymark pipeline

Extracts GitHub and Jira into raw Parquet with [dlt](https://dlthub.com/docs), then builds the
entities Waymark reads with jobs that follow the [table contract](CONTRACT.md). Every job writes
entities, or metadata on existing ones, and every row records the rows it was built from, so any
value traces back to raw records. Raw data aside, there are only the two tables Waymark reads,
`entities` and `entity_metadata`, and each job writes its own part of them. Each build is a
snapshot whose manifest lists the exact files of every table, and `latest.json` names the
published one (layout in [CONTRACT.md](CONTRACT.md#snapshot-layout)):

- `<bucket>/raw/<table>/<run_id>.*.parquet`: append-only, one set of files per extract run
- `<bucket>/runs/<run_id>.json`: a finished run, and the runs a snapshot of it reads
- `<bucket>/tables/<entities|entity_metadata>/<snapshot_id>.<job>.parquet`: one job's part,
  written once per snapshot, with its diff in `<bucket>/changes/<job>/<snapshot_id>.parquet`
- `<bucket>/snapshots/<snapshot_id>.json` and `<bucket>/latest.json`

This README is in three parts: a [quick start](#quick-start), a [reference](#reference) for the
commands, environment variables and client config, and then [how each step works](#run-it).

## Quick start

### Set up

1. Install [Nix and devenv](https://devenv.sh/getting-started/). If the first `devenv` command
   fails with `authentication required`, see the [root README](../README.md#first-run-gotcha-insteadof-git-rewrite).
2. From the repo root, run `devenv shell`, or run `direnv allow` once to load it whenever you
   `cd` in. It provides Python 3.13, `uv`, the GitHub CLI (`gh`) and the DuckDB CLI, and runs
   `uv sync` in `pipeline/` so `python` and `uv run` have the pipeline's packages. The first time
   takes a minute or two.
3. Run `gh auth login` if you haven't: the extract reads your GitHub token from it. The Kafka
   client's Jira is public, so it needs no Jira credentials.

Without devenv, install `uv`, `gh` and `duckdb` yourself and run `uv sync` in `pipeline/`; `uv`
downloads a matching Python. Either way, check the setup with the tests (about 100 seconds):

```sh
cd pipeline
uv run pytest -q
```

### Try it

Every step runs from `pipeline/`, against a local bucket:

```sh
export BUCKET=file:///tmp/waymark-bucket
```

**1. Extract.** `--max-pages 1` fetches one page from each source, which takes a few seconds:

```sh
GITHUB_TOKEN=$(gh auth token) uv run python extract.py \
  --client clients/apache-kafka.toml --bucket-url $BUCKET --full --max-pages 1
```

It ends by printing the run's id, `run_id=20261119T165653Z` for example.

**2. Build a snapshot.** This runs every job, verifies each job's lineage and publishes the
snapshot, in about 5 seconds:

```sh
uv run python runner.py \
  --client clients/apache-kafka.toml --bucket-url $BUCKET --run-id <run_id>
```

```
changes: 100 rows (no base to compare)
tickets: 100 rows (no base to compare)
ticket_change_links: 0 rows (no base to compare)
change_ticket_keys: 0 rows (no base to compare)
ticket_lead_time: 0 rows (no base to compare)
changes: 2 entities checked in 1.4s, ok
tickets: 5 entities checked in 3.5s, ok
...
published snapshot 20261123T200650Z
```

One page fetches the oldest 100 Kafka tickets and the newest 100 pull requests, so nothing links
them and no ticket has a `lead_time_hours` yet. Leave out `--max-pages` for the whole project.

**3. Trace a value.** Pick a ticket, then trace its summary back to the raw Jira record:

```sh
duckdb -c "select id, name from '/tmp/waymark-bucket/tables/entities/*.tickets.parquet'
  order by name limit 3"

uv run python trace.py --bucket-url $BUCKET --table entities --row-id <id> --field summary
```

```
summary = 'The log4j appender still uses the SyncProducer API'
  computed from: raw.jira_issues.fields:$.summary
hop 0: entities                      1 rows  (_row_id 3276073428148143, ...)
hop 1: raw.jira_issues               1 rows  (_dlt_id 6fSbgH/tOIFD0A, ...)
raw field: raw.jira_issues.fields:$.summary  e.g. The log4j appender still uses the SyncProducer API
```

Nothing sits between the ticket and the raw record: the `tickets` job wrote the summary as the
ticket's metadata, with the lineage of the row it computed. Lineage only ever names entities and
raw records; a metadata value is followed through its entity.

**4. Add a job.** A job is a folder holding `job.toml` and `query.sql`
([CONTRACT.md](CONTRACT.md#jobs) has the rules). Every job writes entities: `entity_type` makes
a new type of them, one per row, and `adds_to` adds metadata to an existing type's entities. Try
one in a scratch folder, which makes an entity per status group:

```sh
mkdir -p /tmp/my-jobs/tickets_by_status_group
cat > /tmp/my-jobs/tickets_by_status_group/job.toml <<'EOF'
description = "How many tickets are in each status group."
inputs = ["entities[type=ticket]", "entity_metadata[entity_type=ticket]"]
entity_type = "status_group"
EOF
cat > /tmp/my-jobs/tickets_by_status_group/query.sql <<'EOF'
select
  stable_id('tickets_by_status_group', value) as _row_id,
  list(source_ref('entities', entity_id) order by entity_id) as _sources,
  map {
    'name': ['entities.status_group'],
    'created_at': ['entities.created_at'],
    'tickets': ['entities._row_id']
  } as _fields,
  value as name,
  min(created_at) as created_at,
  count(*) as tickets
from entity_metadata
where key = 'status_group'
group by value
order by value
EOF
uv run python runner.py \
  --client clients/apache-kafka.toml --bucket-url $BUCKET --run-id <run_id> \
  --job-dir /tmp/my-jobs
```

Each row needs a text `name` and an `iso_utc` `created_at`, and its other columns become the
entity's metadata. It lists the tickets it counts in `_sources`, and in `_fields` the columns each
value reads: the name reads each ticket's `status_group` value, named `entities.status_group` as if
it were a column of the ticket, and `tickets` counts tickets, so it names their identity. It reads
the tickets' metadata but cites the tickets, so it reads `entities[type=ticket]` too. A job names
the types it reads and runs after the jobs that write them. The runner checks
the output against the contract and writes it as the job's part of both tables. To keep a job,
move its folder into `clients/<client>/jobs/`, or into `jobs/` for every client.

**5. See verify catch a mistake.** Add `max(length(value)) as name_length` to the select and
declare it as reading nothing, `'name_length': []`. Build again with `--no-publish`. The runner
exits 1:

```
tickets_by_status_group: 1 entities checked in 0.2s, 1 errors
  error   undeclared name_length: changes with entities.status_group  (1 rows, ...)
```

Verify re-ran the job with the tickets' `status_group` values changed, saw `name_length` change,
and found no reference to them in `_fields`.

**6. View it in Waymark.** From the repo root, then open an entity and follow its lineage links.
On a fresh clone, run `bun install` and `bun b` once first:

```sh
DEV_WAYMARK_SOURCE_DB_ADAPTER=duckdb DEV_WAYMARK_SOURCE_DB_URL=/tmp/waymark-bucket bun dev
```

Next, the [job registry](#job-registry) runs the same jobs from the bucket instead of this repo.

## Reference

### Commands

Run each from this directory with `uv run python <script>`. Every `--bucket-url` takes `file://`,
`s3://` or `az://` ([S3 and Azure](#s3-and-azure)). `--client` is a client config such as
`clients/apache-kafka.toml` ([Client config](#client-config)).

**`extract.py`** runs each source module into `raw/` and records the run. It prints `run_id=<id>`.
What a client fetches is its own: the modules in its `sources/` folder, which start as copies of
[templates/client-app/sources/](templates/client-app/sources/) (GitHub and Jira; the module
interface is in the template's README, "Running it"). The lock, run records and raw layout are
the pipeline's, the same for every client.

| Flag                 | Default          | Meaning                                                              |
| -------------------- | ---------------- | -------------------------------------------------------------------- |
| `--client`           |                  | Client config. Required unless `--adopt-run` or `--break-lock`.      |
| `--bucket-url`       | required         | Bucket to write to.                                                  |
| `--sources DIR`      | the template's   | Folder of source modules to run.                                     |
| `--run-id`           | current UTC time | Id of this run, `YYYYMMDDTHHMMSSZ`.                                  |
| `--full`             | off              | Fetch everything. Without it, fetch what changed since the last run. |
| `--max-pages N`      | no limit         | Stop each source after N pages. The run is marked limited.           |
| `--adopt-run RUN_ID` |                  | Record a full run extracted before run records existed, then stop.   |
| `--break-lock`       | off              | Remove the lock a crashed extract left behind, then stop.            |

**`orchestrate.py`** runs the pipeline from the job registry ([Job registry](#job-registry)).
Each command takes `--client`, `--bucket-url` (the client's root) and `--shared-url` (the shared
registry, optional) before it, and exits non-zero if a build or verify fails.

| Command               | Meaning                                                                                                                      |
| --------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `run`                 | Extract, build every active job, verify, publish. Reuses each job whose parts would come out the same as the published ones. |
| `run --extract full`  | The same with a full extract; `--extract none` builds the last complete run (or `--run-id`) without extracting.              |
| `run --rebuild`       | Build every job, reusing nothing.                                                                                            |
| `run --sources DIR`   | Extract with the source modules in `DIR` rather than the template's.                                                         |
| `preview JOB VERSION` | Build the last run with one job at another version. Saved, never published. `VERSION` can be a job folder to push.           |
| `promote JOB VERSION` | A preview, then make the version active if it passed. `--shared` promotes in the shared registry.                            |

**`registry.py`** keeps job versions in a bucket. `--bucket-url` is the registry's root: a
client's bucket, or the shared registry.

| Command                     | Meaning                                                                   |
| --------------------------- | ------------------------------------------------------------------------- |
| `push FOLDER...`            | Upload job folders, or folders of jobs, as versions. Prints each version. |
| `push --activate FOLDER...` | The same, and make each active without a preview. For seeding.            |
| `list`                      | Every job's versions, the active one starred.                             |

**`runner.py`** builds a snapshot from a run with the jobs in this repo, verifies it, and moves
`latest.json` to it. It reuses unchanged tables like `orchestrate.py run`. It exits non-zero if any
job fails to build or verify.

| Flag            | Default          | Meaning                                                             |
| --------------- | ---------------- | ------------------------------------------------------------------- |
| `--client`      | required         | Client config.                                                      |
| `--bucket-url`  | required         | Bucket to read raw from and write the snapshot to.                  |
| `--run-id`      | required         | Run to build from, as `extract.py` printed it.                      |
| `--snapshot-id` | current UTC time | Id of the new snapshot.                                             |
| `--job-dir DIR` |                  | Another folder of jobs, replacing the client's by name. Repeatable. |
| `--no-verify`   | off              | Skip the lineage check.                                             |
| `--no-publish`  | off              | Save the snapshot but leave `latest.json` alone.                    |
| `--rebuild`     | off              | Run every job, reusing nothing from the published snapshot.         |

**`verify.py`** re-checks the lineage of a snapshot that `runner.py` built. It exits non-zero on
any error; warnings don't fail it.

| Flag                  | Default   | Meaning                                                             |
| --------------------- | --------- | ------------------------------------------------------------------- |
| `--client`            | required  | Client config.                                                      |
| `--bucket-url`        | required  | Bucket holding the snapshot.                                        |
| `--snapshot-id`       | published | Snapshot to check.                                                  |
| `--job NAME`          | all jobs  | Check only this job. Repeatable.                                    |
| `--job-dir DIR`       |           | The same extra job folders the snapshot was built with.             |
| `--registry`          | off       | Check each job with the version that ran it, from the registry.     |
| `--shared-url URL`    |           | With `--registry`, the shared registry too.                         |
| `--rows-per-branch N` | 2         | Entities to check per distinct `_fields` of each value a job wrote. |

**`trace.py`** prints the rows, hop by hop, that a row or one of its values was built from.

| Flag            | Default   | Meaning                      |
| --------------- | --------- | ---------------------------- |
| `--bucket-url`  | required  | Bucket holding the snapshot. |
| `--snapshot-id` | published | Snapshot to read.            |
| `--table`       | required  | Table the row is in.         |
| `--row-id`      | required  | The row's `_row_id`.         |
| `--field`       | whole row | Trace only this column.      |

**Tests:** `uv run pytest` runs the pipeline tests (about 100 seconds). The container example has
its own: `cd containers/lead-time && bun test`. Both run in the pre-commit hook when a commit
touches `pipeline/` (see the repo's `bun install-hooks`).

### Environment variables

| Variable                                                   | Read by                  | Meaning                                                                                |
| ---------------------------------------------------------- | ------------------------ | -------------------------------------------------------------------------------------- |
| `GITHUB_TOKEN`                                             | `extract.py`             | Required. `gh auth token` works.                                                       |
| `JIRA_EMAIL`, `JIRA_API_TOKEN`                             | `extract.py`             | Required for Jira Cloud. On Jira Server the token is optional, sent as a bearer token. |
| `AWS_*`, `AWS_ENDPOINT_URL`                                | every script             | S3 credentials, region and endpoint ([S3 and Azure](#s3-and-azure)).                   |
| `AZURE_STORAGE_CONNECTION_STRING`, `AZURE_STORAGE_ACCOUNT` | every script             | Azure credentials ([S3 and Azure](#s3-and-azure)).                                     |
| `WAYMARK_DOCKER`                                           | `runner.py`, `verify.py` | Container runtime for container jobs. Default `docker`.                                |

### Client config

A client is one TOML file in `clients/`, plus its own jobs in `clients/<client>/jobs/`.
[`clients/apache-kafka.toml`](clients/apache-kafka.toml) is a complete example.

| Key                          | Meaning                                                                                                          |
| ---------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| `client`                     | The client's name. Names its jobs folder and namespaces every `_row_id`.                                         |
| `github.repos`               | Repositories to fetch pull requests from, as `owner/name`.                                                       |
| `jira.flavor`                | `server` for Jira Server or Data Center, `cloud` for `*.atlassian.net`.                                          |
| `jira.base_url`              | Jira's base URL.                                                                                                 |
| `jira.jql`                   | Which issues to fetch. Order by a stable field, such as `key`, so paging can't skip issues.                      |
| `mapping.ticket_key_pattern` | Regex for a ticket key in pull request text, uppercase, such as `KAFKA-[0-9]+`.                                  |
| `[mapping.statuses]`         | Jira status to status group, such as `"In Review" = "In Progress"`. An unlisted status uses Jira's own category. |
| `[[mapping.jira_fields]]`    | Extra Jira fields to keep as entity metadata, one table per field (below).                                       |

Each `[[mapping.jira_fields]]` entry has a `key` (the metadata name: lowercase letters, digits and
`_`), a `path` into the issue's `fields` JSON (`$.votes.votes`) and a `value_type` (`string`,
`number`, `date` or `boolean`). Jobs see all of this as `params` tables and variables
([CONTRACT.md](CONTRACT.md#jobs)), and container jobs as `WAYMARK_PARAMS`.

## Run it

Inside `devenv shell` ([Set up](#set-up)), from this directory:

```sh
GITHUB_TOKEN=$(gh auth token) uv run python extract.py \
  --client clients/apache-kafka.toml \
  --bucket-url file:///tmp/waymark-bucket \
  --full
```

`--full` fetches everything. Without it, a run is incremental: it fetches only what changed since
the last finished run started, less an overlap (an hour for GitHub, a day for Jira, whose JQL
dates are in the Jira user's time zone). Fetching a record twice is harmless, since the jobs keep
the latest version of each. A run writes `runs/<run_id>.json` once every source has loaded, and a
run without one is never built, so a failed run is simply retried by the next.

Only one extract runs against a bucket at a time. Each holds `runs/extract.lock` while it runs, and
a second one exits with an error naming the holder instead of waiting. A crashed extract that
didn't release the lock leaves it behind: once you're sure nothing is running, clear it with
`extract.py --bucket-url <bucket> --break-lock`.

A snapshot of an incremental run reads the last full run plus every run since. A deleted record
stays in that until the next full run leaves it out, so run `--full` regularly (weekly, say).

`--max-pages 1` makes a quick smoke test. Its run is marked limited: it can be built, but no
incremental run builds on it. A full run extracted before run records existed can be recorded
with `extract.py --bucket-url <bucket> --adopt-run <run_id>`. Its id must be the UTC time it
started, which the next incremental run fetches from. A bucket whose `raw/` was copied in rather than extracted
works too: the extract writes the `raw/init` marker dlt expects before loading.

Then build a snapshot from that run, using the `run_id` line `extract.py` prints:

```sh
uv run python runner.py \
  --client clients/apache-kafka.toml \
  --bucket-url file:///tmp/waymark-bucket \
  --run-id <run_id>
```

This runs the shared jobs in `jobs/` and the client's own in `clients/<client>/jobs/`, each after
the jobs whose entities it reads, then checks each job's lineage with `verify.py` (below), on the
same files.
It saves the manifest either way and moves `latest.json` to it only if every job built and
verified; otherwise it exits non-zero. It also leaves `latest.json` alone if the published
snapshot is newer (a later extract, or the same extract built later), so a slow build that
finishes after a newer one can't point Waymark back at older data. `--no-verify` skips the check,
`--no-publish` leaves `latest.json` alone and `--snapshot-id` names the snapshot (default: the
current UTC time). Run the tests with `uv run pytest`.

Each job is also compared with the snapshot that was published when the build started: the
runner prints `N added, N changed, N removed` per job and writes those entities' ids to
`changes/<job>/<snapshot_id>.parquet`. An entity counts as changed when any value the job wrote
for it does; lineage columns aren't compared, so a record fetched again unchanged isn't a change.

Trace any row back to raw records:

```sh
uv run python trace.py \
  --bucket-url file:///tmp/waymark-bucket \
  --table entities --row-id <id>
```

Add `--field <column>` to trace one value instead of the whole row; on an entity, that can be any
of its metadata keys. Each row it reaches carries the columns the value needs from it, and follows
only the sources its own `_fields` name for them, and a filtered reference such as
`entities[type=change].merged_at` only the rows it matches. It ends with the raw fields the value
comes from. A ticket's `lead_time_hours` (first pull request opened to last one merged) is
metadata the `ticket_lead_time` job added to it, so tracing it reaches, at hop 1, the ticket's
links and its pull requests, as entities; then the raw rows behind them; and at the end
`raw.github_pulls.created_at` and `raw.github_pulls.merged_at`. A link's id values stand for the
whole link, which depends on the ticket and pull request it joins, so the ticket's raw row is
reached too, but as a whole row: Jira's `created` isn't one of the fields listed. A row shows up
at a later hop only when the value needs more of it than before. No hop shows a metadata row: a
value is reached through its entity.

`trace.py` and `verify.py` read the published snapshot; add `--snapshot-id <id>` for another.
`runner.py` already verifies; run `verify.py` on its own to check one job or more rows:

```sh
uv run python verify.py \
  --client clients/apache-kafka.toml \
  --bucket-url file:///tmp/waymark-bucket
```

For a sample of rows (`--rows-per-branch`, default 2, per distinct `_fields`), it re-runs the job
on only the rows in the row's `_sources`, with the metadata of the entities among them, and
expects the same row back. Then it changes each input
column of those rows in turn and checks that every output column that changes names that input in
the row's `_fields`. When a change renames the row, because its `_row_id` comes from that column
as a grouping key's does, it follows the row to its new id. Add `--job <name>` to check one job. It exits non-zero on an error; warnings
mark references no change affected, which can be correct for a filter or a threshold.

It replays the job's current files, so it won't check a job whose files changed since the snapshot
was built (the manifest records a hash of them): new SQL against old output would fail for reasons
that aren't the snapshot's. That job is reported as not checked and counts as an error; check out
the job as it was to verify that snapshot.

## Job registry

In production the jobs live in the bucket, not this repo, so a client can have its own and a new
version can be checked before it goes live. `registry.py` keeps every version of a job under
`jobs/<name>/versions/<version>/`, written once. A version is the hash of the job's files, the same
hash the manifest records beside each job, so a snapshot names the exact code that built it.
`jobs/<name>/active` names the version that runs.

A client's jobs are the shared registry's active jobs, with the client's own replacing them by
name. To try it on the [quick start](#quick-start)'s bucket, give the shared registry a folder of
its own, seed both from this repo, then run:

```sh
export SHARED=file:///tmp/waymark-shared
uv run python registry.py --bucket-url "$SHARED" push --activate jobs
uv run python registry.py --bucket-url "$BUCKET" push --activate clients/apache-kafka/jobs
uv run python orchestrate.py --client clients/apache-kafka.toml \
  --bucket-url "$BUCKET" --shared-url "$SHARED" run --extract none --run-id <run_id>
```

`--extract none` builds the last complete run without extracting. The quick start's run was
limited by `--max-pages`, so it never counts as the last and has to be named with `--run-id`;
leave that out once the bucket has a full run. The jobs are the versions `runner.py` built with,
so every job is reused.

To change a job, promote a new version. `promote` builds the last extract with that version swapped
in, reusing every job it doesn't affect, and verifies it. It moves `active` only if that passed,
and the next `run` publishes it. The job from quick start step 5 still fails verify, so promoting
it is refused; declare `'name_length': ['entities.status_group']` and promote it again:

```sh
uv run python orchestrate.py --client clients/apache-kafka.toml \
  --bucket-url "$BUCKET" --shared-url "$SHARED" \
  promote tickets_by_status_group /tmp/my-jobs/tickets_by_status_group --run-id <run_id>
```

A job folder in place of a version is pushed to the client's registry first (`--shared` pushes and
promotes in the shared one).

`preview` does the same build without moving `active`. Its snapshot is saved under
`snapshots/preview-*.json` and never published; its change files are the diff against what's live.

A second `run` with nothing new reuses every job, and promoting a new version of one job builds
and verifies only it and the jobs that read its entities.

## Container jobs

A job can be a container image in place of a query, for logic that needs real code and unit tests
([CONTRACT.md](CONTRACT.md#container-jobs)). The runner stages its inputs as local Parquet and
runs it with `docker` (or the command in `WAYMARK_DOCKER`), with no network. Its output gets the
same checks and verification as a SQL job's.

`containers/lead-time/` is a TypeScript example. It makes a `lead_time_by_issue_type` entity per
issue type, with the average and median of its tickets' `lead_time_hours`, and writes the same
entities and metadata, with the same `_sources` and `_fields`, as the SQL job in
`containers/lead-time/reference/`, which is the client template's job of that name:

```sh
cd containers/lead-time && bun install && bun test && cd ../..
containers/lead-time/build.sh /tmp/ts-jobs     # builds the image, writes a job.toml pinning it
uv run python runner.py \
  --client clients/apache-kafka.toml \
  --bucket-url file:///tmp/waymark-bucket \
  --run-id <run_id> \
  --job-dir /tmp/ts-jobs
```

`--job-dir` adds a folder of jobs after the client's, replacing theirs by name; here it adds an
entity type no other job makes. `verify.py` takes the same `--job-dir`, so it checks the job the
snapshot was built with.

## S3 and Azure

Every script takes `s3://bucket/prefix` or `az://container/prefix` in place of `file://`, and
Waymark takes the same URL. Credentials come from the standard environment variables, which
dlt, fsspec and DuckDB all read:

- **AWS S3**: the AWS credential chain (env vars, `AWS_PROFILE`/SSO, instance or task role),
  plus `AWS_REGION`.
- **S3-compatible (MinIO, Cloudflare R2)**: also set `AWS_ENDPOINT_URL`. DuckDB's credential
  chain ignores it, so `snapshot.py` and Waymark's `duckdbStorage.ts` pass it to DuckDB as an
  explicit endpoint, path style.
- **Azure Blob**: `AZURE_STORAGE_CONNECTION_STRING`, or `AZURE_STORAGE_ACCOUNT` with the Azure
  credential chain (`az login`, managed identity). dlt reads its own Azure settings; see dlt's
  filesystem destination docs.

DuckDB downloads its `httpfs`, `aws` and `azure` extensions on first use. On a host without
internet access, install them when building the image:
`duckdb -c "INSTALL httpfs; INSTALL aws; INSTALL azure"`.

To try S3 locally, run SeaweedFS (MinIO no longer publishes images to Docker Hub):

```sh
docker run -d --name waymark-s3 -p 8333:8333 chrislusf/seaweedfs:3.80 server -s3 -dir=/data
curl -X PUT http://localhost:8333/waymark   # make the bucket
export AWS_ACCESS_KEY_ID=any AWS_SECRET_ACCESS_KEY=any AWS_REGION=us-east-1 \
  AWS_ENDPOINT_URL=http://localhost:8333
```

Then use `--bucket-url s3://waymark/apache-kafka` throughout.

## View it in Waymark

Point Waymark at the bucket, from the repo root. It reads the snapshot `latest.json` names, once,
at startup; restart it to pick up a newer one. A manifest URL
(`<bucket>/snapshots/<id>.json`) pins one snapshot instead.

```sh
DEV_WAYMARK_SOURCE_DB_ADAPTER=duckdb \
DEV_WAYMARK_SOURCE_DB_URL=/tmp/waymark-bucket \
bun dev
```

Then open `/lineage/<table>/<_row_id>` to see a row and the rows it was built from, and follow the
links down to raw records. Add `/raw` to the path to list every raw record behind the row. Each
entity's page links to its own lineage. A plain folder of `<name>.parquet` files also works, with
raw read from a sibling `raw/` folder, but without a manifest nothing pins which files it reads.
