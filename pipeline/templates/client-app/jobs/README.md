# This client's own jobs

One folder per job, each a `job.toml` and a `query.sql` that follow the pipeline's
[table contract](https://github.com/pragmint/dev-waymark/blob/main/pipeline/CONTRACT.md). A job
here runs on top of the shared jobs, and replaces a shared job of the same name.

Every job writes entities: `entity_type` in its `job.toml` makes each of its rows an entity of
that type, and `adds_to` adds each row's columns as metadata to an existing type's entities. The
rules are in the pipeline's
[CONTRACT.md](https://github.com/pragmint/dev-waymark/blob/main/pipeline/CONTRACT.md#what-a-job-writes).

Two examples, each reading only tickets and their metadata (`entities[type=ticket]` and
`entity_metadata[entity_type=ticket]`):

- **`lead_time_by_issue_type`**: an entity per issue type, listed under `lead_time_by_issue_type`
  in the type dropdown and named for its issue type, with how many tickets have a merged pull
  request and their average and median lead time as metadata. An entity needs a date, so each is
  dated by its issue type's most recent merge, which is all the date range filters on. To see
  lead time over any range, chart the tickets' own `lead_time_hours` instead.
- **`lead_time_by_issue_type_monthly`**: the same, per issue type and month of the last merge
  (in UTC), named like `Bug 2024-05` and dated the first of its month so the date range applies.
  Its `year` and `month` are numbers, to filter on or chart by.

Delete either if this client doesn't want it.

Changes go through pull requests, and the `jobs` workflow does the rest:

1. **Open a PR.** The workflow previews each job the PR changes: it builds the last extract with
   that job at the PR's version, verifies the lineage of every table, and saves the snapshot
   without publishing it. A failed preview fails the check.
2. **Merge it.** The workflow promotes each changed job: the same preview, then the version is
   made active. The next hourly run of the `pipeline` workflow publishes it.

To try a job locally first, from a checkout of `pragmint/dev-waymark`, in `pipeline/`:

```sh
uv run python orchestrate.py --client <this repo>/clients/<client>.toml \
  --bucket-url "$BUCKET_URL" --shared-url "$SHARED_URL" \
  preview lead_time_by_issue_type <this repo>/jobs/lead_time_by_issue_type
```

Deleting a folder doesn't stop the job: the registry can't retire a job yet, so the workflow warns
and its last active version keeps running.
