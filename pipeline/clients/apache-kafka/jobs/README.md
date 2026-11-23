# Apache Kafka's own jobs

Jobs only this client runs go here, one folder each, as in [`../../../jobs/`](../../../jobs/). A job
here replaces a shared job of the same name.

- **`lead_time_by_issue_type`**: an entity per issue type, with how many tickets have a merged pull
  request and their average and median `lead_time_hours`, dated by the issue type's most recent
  merge.
- **`lead_time_by_issue_type_monthly`**: the same per issue type and month of the last merge (UTC),
  dated the first of its month so the date range applies.

Both read the `lead_time_hours` and `last_merged_at` that the shared `ticket_lead_time` job adds to
each ticket. They are the same as the client template's examples in
[`../../../templates/client-app/jobs/`](../../../templates/client-app/jobs/).
