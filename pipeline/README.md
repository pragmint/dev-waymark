# Waymark pipeline

Extracts GitHub and Jira into raw Parquet with [dlt](https://dlthub.com/docs), then builds the
tables Waymark reads with jobs that follow the [table contract](CONTRACT.md): every row records the
rows it was built from, so any value traces back to raw records. Each build is a snapshot whose
manifest lists the exact files of every table, and `latest.json` names the published one (layout
in [CONTRACT.md](CONTRACT.md#snapshot-layout)):

- `<bucket>/raw/<table>/<run_id>.*.parquet`: append-only, one set of files per extract run
- `<bucket>/tables/<name>/<snapshot_id>.parquet`: written once per snapshot
- `<bucket>/snapshots/<snapshot_id>.json` and `<bucket>/latest.json`

## Run it

Inside `devenv shell` (which provides `uv`), from this directory:

```sh
uv sync
GITHUB_TOKEN=$(gh auth token) uv run python extract.py \
  --client clients/apache-kafka.toml \
  --bucket-url file:///tmp/waymark-bucket
```

Add `--max-pages 1` for a quick smoke test. Then build a snapshot from that run, using the
`run_id` line `extract.py` prints:

```sh
uv run python runner.py \
  --client clients/apache-kafka.toml \
  --bucket-url file:///tmp/waymark-bucket \
  --run-id <run_id>
```

This runs the shared jobs in `jobs/` and the client's own in `clients/<client>/jobs/`, each after
the jobs it reads, then checks each table's lineage with `verify.py` (below), on the same files.
It saves the manifest either way and moves `latest.json` to it only if every job built and
verified; otherwise it exits non-zero. `--no-verify` skips the check, `--no-publish` leaves
`latest.json` alone and `--snapshot-id` names the snapshot (default: the current UTC time). Run
the tests with `uv run pytest`.

Trace any row back to raw records:

```sh
uv run python trace.py \
  --bucket-url file:///tmp/waymark-bucket \
  --table lead_time_by_issue_type --row-id <_row_id>
```

Add `--field <column>` to trace one value instead of the whole row. It follows only the sources
that column reads, using the row's `_fields` and then each table's column map, and ends with the raw fields the value comes from:

```
avg_lead_time_hours = 1520.1
  computed from: changes.created_at, changes.merged_at
hop 0: lead_time_by_issue_type       1 rows  (_row_id 8767488532554951, ...)
hop 1: changes                     596 rows  (_row_id 100161251620229, ...)
hop 2: raw.github_pulls            596 rows  (_dlt_id +Bhct76HSdz/fA, ...)
raw field: raw.github_pulls.created_at  e.g. 2021-02-04 20:57:09+00:00, ...
raw field: raw.github_pulls.merged_at  e.g. 2021-03-18 14:27:14+00:00, ...
```

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
