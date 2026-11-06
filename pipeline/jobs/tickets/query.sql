-- Only the client's configured fields: the full JSON is often megabytes per issue.
with custom_fields as (
  select
    issues._dlt_id,
    map_from_entries(
      list({'key': field.key, 'value': json_extract_string(issues.fields, field.path)})
    ) as custom_fields
  from raw.jira_issues as issues
  cross join params.jira_fields as field
  group by issues._dlt_id
),

-- One json_extract_string call with a list of paths parses each document once.
extracted as (
  select
    id as source_id,
    key as ticket_key,
    json_extract_string(fields, [
      '$.summary', '$.project.key', '$.issuetype.name', '$.status.name',
      '$.status.statusCategory.name', '$.priority.name', '$.resolution.name',
      '$.assignee.displayName', '$.reporter.displayName', '$.created', '$.updated',
      '$.resolutiondate'
    ]) as v,
    _dlt_id,
    _dlt_load_id
  from raw.jira_issues
),

parsed as (
  select
    source_id,
    ticket_key,
    v[1] as summary,
    v[2] as project,
    v[3] as issue_type,
    v[4] as status,
    v[5] as status_category,
    v[6] as priority,
    v[7] as resolution,
    v[8] as assignee,
    v[9] as reporter,
    try_cast(v[10] as timestamptz) as created_at,
    try_cast(v[11] as timestamptz) as updated_at,
    try_cast(v[12] as timestamptz) as resolved_at,
    _dlt_id,
    _dlt_load_id
  from extracted
),

latest as (
  select * from parsed
  qualify row_number() over (
    partition by source_id order by updated_at desc nulls last, _dlt_load_id desc
  ) = 1
)

select
  stable_id('jira', latest.source_id) as _row_id,
  [source_ref('raw.jira_issues', latest._dlt_id)] as _sources,
  latest.* exclude (_dlt_id, _dlt_load_id),
  custom_fields.custom_fields,
  -- A status the client has not mapped falls back to Jira's own category.
  coalesce(status_map.status_group, latest.status_category) as status_group,
  getvariable('jira_base_url') || '/browse/' || latest.ticket_key as url
from latest
left join custom_fields on custom_fields._dlt_id = latest._dlt_id
left join params.status_map as status_map on status_map.status = latest.status
order by _row_id
