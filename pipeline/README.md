# Waymark pipeline

Extracts GitHub and Jira into raw Parquet with [dlt](https://dlthub.com/docs), then builds the
tables Waymark reads with jobs that follow the [table contract](CONTRACT.md): every row records the
rows it was built from, so any value traces back to raw records. Each run is a full snapshot in
its own folder:

- `<bucket>/runs/<run_id>/raw/<table>/`
- `<bucket>/runs/<run_id>/tables/<name>.parquet`

## Run it

Inside `devenv shell` (which provides `uv`), from this directory:

```sh
uv sync
GITHUB_TOKEN=$(gh auth token) uv run python extract.py \
  --client clients/apache-kafka.toml \
  --bucket-url file:///tmp/waymark-bucket
```

Add `--max-pages 1` for a quick smoke test. Then build the tables from that run, using the run ID
in the `run_url` line `extract.py` prints:

```sh
uv run python runner.py \
  --client clients/apache-kafka.toml \
  --bucket-url file:///tmp/waymark-bucket \
  --run-id <run_id>
```

This runs the shared jobs in `jobs/` and the client's own in `clients/<client>/jobs/`, each after
the jobs it reads. `runner.py` exits non-zero if any job failed or was skipped. Run the tests with
`uv run pytest`.

Trace any row back to raw records:

```sh
uv run python trace.py \
  --bucket-url file:///tmp/waymark-bucket --run-id <run_id> \
  --table lead_time_by_issue_type --row-id <_row_id>
```

Add `--field <column>` to trace one value instead of the whole row. It follows only the sources
that column reads, using each job's column map, and ends with the raw fields the value comes from:

```
avg_lead_time_hours = 1520.1
  computed from: changes.created_at, changes.merged_at
hop 0: lead_time_by_issue_type       1 rows  (_row_id 8767488532554951, ...)
hop 1: changes                     596 rows  (_row_id 100161251620229, ...)
hop 2: raw.github_pulls            596 rows  (_dlt_id +Bhct76HSdz/fA, ...)
raw field: raw.github_pulls.created_at  e.g. 2021-02-04 20:57:09+00:00, ...
raw field: raw.github_pulls.merged_at  e.g. 2021-03-18 14:27:14+00:00, ...
```

Check that each table's lineage holds, by re-running jobs on small inputs:

```sh
uv run python verify.py \
  --client clients/apache-kafka.toml \
  --bucket-url file:///tmp/waymark-bucket --run-id <run_id>
```

For a sample of rows (`--rows-per-branch`, default 2, per value of any `by` column), it re-runs
the job on only the rows in the row's `_sources` and expects the same row back. Then it changes
each input column of those rows in turn and checks that every output column that changes declares
that input in `[columns]`. Add `--job <name>` to check one job. It exits non-zero on an error;
warnings mark references no change affected, which can be correct for `coalesce` or a filter.

Only local paths work for now. S3 and Azure need DuckDB's storage extensions and credentials.

## View it in Waymark

Point Waymark at a run's `tables/` folder, from the repo root:

```sh
DEV_WAYMARK_SOURCE_DB_ADAPTER=duckdb \
DEV_WAYMARK_SOURCE_DB_URL=/tmp/waymark-bucket/runs/<run_id>/tables \
bun dev
```

Then open `/lineage/<table>/<_row_id>` to see a row and the rows it was built from, and follow the
links down to raw records. Add `/raw` to the path to list every raw record behind the row. Each
entity's page links to its own lineage. Raw rows show only if the run's `raw/` folder sits next
to `tables/`.
