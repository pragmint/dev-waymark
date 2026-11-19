# Waymark pipeline

Extracts GitHub and Jira into raw Parquet with [dlt](https://dlthub.com/docs), then builds the
tables Waymark reads with jobs that follow the [table contract](CONTRACT.md): every row records the
rows it was built from, so any value traces back to raw records. Each build is a snapshot whose
manifest lists the exact files of every table, and `latest.json` names the published one (layout
in [CONTRACT.md](CONTRACT.md#snapshot-layout)):

- `<bucket>/raw/<table>/<run_id>.*.parquet`: append-only, one set of files per extract run
- `<bucket>/runs/<run_id>.json`: a finished run, and the runs a snapshot of it reads
- `<bucket>/tables/<name>/<snapshot_id>.parquet`: written once per snapshot, with
  `<snapshot_id>.changes.parquet` beside it
- `<bucket>/snapshots/<snapshot_id>.json` and `<bucket>/latest.json`

## Run it

Inside `devenv shell` (which provides `uv`), from this directory:

```sh
uv sync
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
the jobs it reads, then checks each table's lineage with `verify.py` (below), on the same files.
It saves the manifest either way and moves `latest.json` to it only if every job built and
verified; otherwise it exits non-zero. It also leaves `latest.json` alone if the published
snapshot is newer (a later extract, or the same extract built later), so a slow build that
finishes after a newer one can't point Waymark back at older data. `--no-verify` skips the check,
`--no-publish` leaves `latest.json` alone and `--snapshot-id` names the snapshot (default: the
current UTC time). Run the tests with `uv run pytest`.

Each table is also compared with the snapshot that was published when the build started: the
runner prints `N added, N changed, N removed` per table and writes those rows' `_row_id`s to
`tables/<name>/<snapshot_id>.changes.parquet`. A row counts as changed when any of its values
does; lineage columns aren't compared, so a record fetched again unchanged isn't a change.

Trace any row back to raw records:

```sh
uv run python trace.py \
  --bucket-url file:///tmp/waymark-bucket \
  --table lead_time_by_issue_type --row-id <_row_id>
```

Add `--field <column>` to trace one value instead of the whole row. Each row it reaches carries
the columns the value needs from it, so it follows only the sources those columns read, and a
filtered reference such as `entities[type=change].created_at` only the rows it matches. It ends
with the raw fields the value comes from:

```
avg_lead_time_hours = 1520.1
  computed from: entities[type=change].created_at, entities[type=change].merged_at, ticket_change_links._row_id
hop 0: lead_time_by_issue_type       1 rows  (_row_id 8767488532554951, ...)
hop 1: entities                    596 rows  (_row_id 100161251620229, ...)
hop 1: ticket_change_links         602 rows  (_row_id 1013311773604307, ...)
hop 2: entities                    983 rows  (_row_id 100161251620229, ...)
hop 2: raw.github_pulls            596 rows  (_dlt_id +Bhct76HSdz/fA, ...)
hop 3: raw.github_pulls            596 rows  (_dlt_id +Bhct76HSdz/fA, ...)
hop 3: raw.jira_issues             387 rows  (_dlt_id +5YaqEoUfFLz8Q, ...)
raw field: raw.github_pulls.created_at  e.g. 2021-02-04 20:57:09+00:00, ...
raw field: raw.github_pulls.merged_at  e.g. 2021-03-18 14:27:14+00:00, ...
```

Hop 1 reaches only the pull requests. A link's `_row_id` stands for the whole link, which
depends on the ticket and pull request it joins, so hop 2 reaches tickets too, and pull requests
again as whole rows. A row shows up at a later hop only when the value needs more of it than
before. Only the pull requests' `created_at` is read, so Jira's `created` isn't listed.

`trace.py` and `verify.py` read the published snapshot; add `--snapshot-id <id>` for another.
`runner.py` already verifies; run `verify.py` on its own to check one job or more rows:

```sh
uv run python verify.py \
  --client clients/apache-kafka.toml \
  --bucket-url file:///tmp/waymark-bucket
```

For a sample of rows (`--rows-per-branch`, default 2, per distinct `_fields`), it re-runs the job
on only the rows in the row's `_sources` and expects the same row back. Then it changes each input
column of those rows in turn and checks that every output column that changes names that input in
the row's `_fields`. Add `--job <name>` to check one job. It exits non-zero on an error; warnings
mark references no change affected, which can be correct for a filter or a threshold.

It replays the job's current files, so it won't check a job whose files changed since the snapshot
was built (the manifest records a hash of them): new SQL against old output would fail for reasons
that aren't the snapshot's. That job is reported as not checked and counts as an error; check out
the job as it was to verify that snapshot.

## Container jobs

A job can be a container image in place of a query, for logic that needs real code and unit tests
([CONTRACT.md](CONTRACT.md#container-jobs)). The runner stages its inputs as local Parquet and
runs it with `docker` (or the command in `WAYMARK_DOCKER`), with no network. Its output gets the
same checks and verification as a SQL job's.

`containers/lead-time/` is a TypeScript example. It computes `lead_time_by_issue_type` with the
same rows, `_sources` and `_fields` as the Kafka SQL job:

```sh
cd containers/lead-time && bun install && bun test && cd ../..
containers/lead-time/build.sh /tmp/ts-jobs     # builds the image, writes a job.toml pinning it
uv run python runner.py \
  --client clients/apache-kafka.toml \
  --bucket-url file:///tmp/waymark-bucket \
  --run-id <run_id> \
  --job-dir /tmp/ts-jobs
```

`--job-dir` adds a folder of jobs after the client's, replacing theirs by name, so the container
job replaces the SQL one. `verify.py` takes the same `--job-dir`, so it checks the job the
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
