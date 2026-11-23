-- One ticket per Jira issue, the latest raw version of each. Every column but the contract's,
-- name and created_at is the ticket's metadata; _metadata holds the client's custom fields, whose
-- keys come from its config.

-- Only the client's configured fields: the full JSON is often megabytes per issue.
with custom_fields as (
  select
    issues._dlt_id,
    list(
      {
        'key': field.key,
        'value': case field.value_type
          when 'date' then iso_utc(try_cast(json_extract_string(issues.fields, field.path) as timestamptz))
          when 'number' then cast(try_cast(json_extract_string(issues.fields, field.path) as double) as varchar)
          when 'boolean' then cast(try_cast(json_extract_string(issues.fields, field.path) as boolean) as varchar)
          else json_extract_string(issues.fields, field.path)
        end,
        'value_type': field.value_type
      }
      order by field.key
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
  stable_id('jira', issue.source_id) as _row_id,
  [source_ref('raw.jira_issues', issue._dlt_id)] as _sources,
  map {
    'name': ['raw.jira_issues.key'],
    'created_at': ['raw.jira_issues.fields:$.created'],
    'source_id': ['raw.jira_issues.id'],
    'url': ['raw.jira_issues.key'],
    'updated_at': ['raw.jira_issues.fields:$.updated'],
    'summary': ['raw.jira_issues.fields:$.summary'],
    'project': ['raw.jira_issues.fields:$.project.key'],
    'issue_type': ['raw.jira_issues.fields:$.issuetype.name'],
    'status': ['raw.jira_issues.fields:$.status.name'],
    'status_category': ['raw.jira_issues.fields:$.status.statusCategory.name'],
    'status_group': case
      when status_map.status_group is not null then ['raw.jira_issues.fields:$.status.name']
      else ['raw.jira_issues.fields:$.status.statusCategory.name']
    end,
    'priority': ['raw.jira_issues.fields:$.priority.name'],
    'resolution': ['raw.jira_issues.fields:$.resolution.name'],
    'assignee': ['raw.jira_issues.fields:$.assignee.displayName'],
    'reporter': ['raw.jira_issues.fields:$.reporter.displayName'],
    'resolved_at': ['raw.jira_issues.fields:$.resolutiondate'],
    -- A reference can't name one entry of a list, so every custom value reads all of them.
    '_metadata': (
      select coalesce(list('raw.jira_issues.fields:' || path order by path), [])
      from params.jira_fields
    )
  } as _fields,
  issue.ticket_key as name,
  iso_utc(issue.created_at) as created_at,
  cast(issue.source_id as varchar) as source_id,
  getvariable('jira_base_url') || '/browse/' || issue.ticket_key as url,
  issue.updated_at,
  issue.summary,
  issue.project,
  issue.issue_type,
  issue.status,
  issue.status_category,
  -- A status the client has not mapped falls back to Jira's own category.
  coalesce(status_map.status_group, issue.status_category) as status_group,
  issue.priority,
  issue.resolution,
  issue.assignee,
  issue.reporter,
  issue.resolved_at,
  cast(
    custom_fields.custom_fields as struct("key" varchar, "value" varchar, value_type varchar)[]
  ) as _metadata
from latest as issue
left join custom_fields on custom_fields._dlt_id = issue._dlt_id
left join params.status_map as status_map on status_map.status = issue.status
order by _row_id
