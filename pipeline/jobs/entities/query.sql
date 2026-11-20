-- One row per Jira issue and one per GitHub pull request, each the latest raw version of its
-- record. Waymark reads id, name, type and created_at; the rest are the fields the other jobs
-- read. A ticket's pull request columns are null, and a pull request's ticket columns.

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

latest_issues as (
  select * from parsed
  qualify row_number() over (
    partition by source_id order by updated_at desc nulls last, _dlt_load_id desc
  ) = 1
),

latest_pulls as (
  select
    *,
    coalesce(
      json_extract_string(base, '$.repo'),
      regexp_extract(html_url, 'github\.com/([^/]+/[^/]+)/', 1)
    ) as repo_name,
    -- The URL is the fallback for a pull request whose base repo is gone.
    case
      when json_extract_string(base, '$.repo') is not null then ['raw.github_pulls.base:$.repo']
      else ['raw.github_pulls.html_url']
    end as repo_refs
  from raw.github_pulls
  qualify row_number() over (
    partition by id order by updated_at desc nulls last, _dlt_load_id desc
  ) = 1
),

tickets as (
  select
    stable_id('jira', issue.source_id) as _row_id,
    [source_ref('raw.jira_issues', issue._dlt_id)] as _sources,
    map {
      'id': ['raw.jira_issues.id'],
      'name': ['raw.jira_issues.key'],
      'type': [],
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
      'custom_fields': (
        select coalesce(list('raw.jira_issues.fields:' || path order by path), [])
        from params.jira_fields
      ),
      -- Pull request columns, null on a ticket.
      'repo': [], 'number': [], 'title': [], 'body': [], 'branch': [], 'state': [],
      'is_draft': [], 'author': [], 'closed_at': [], 'merged_at': []
    } as _fields,
    stable_id('jira', issue.source_id) as id,
    issue.ticket_key as name,
    'ticket' as type,
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
    custom_fields.custom_fields
  from latest_issues as issue
  left join custom_fields on custom_fields._dlt_id = issue._dlt_id
  left join params.status_map as status_map on status_map.status = issue.status
),

changes as (
  select
    stable_id('github', id) as _row_id,
    [source_ref('raw.github_pulls', _dlt_id)] as _sources,
    map {
      'id': ['raw.github_pulls.id'],
      'name': list_concat(repo_refs, ['raw.github_pulls.number']),
      'type': [],
      'created_at': ['raw.github_pulls.created_at'],
      'source_id': ['raw.github_pulls.id'],
      'url': ['raw.github_pulls.html_url'],
      'updated_at': ['raw.github_pulls.updated_at'],
      -- Ticket columns, null on a pull request.
      'summary': [], 'project': [], 'issue_type': [], 'status': [], 'status_category': [],
      'status_group': [], 'priority': [], 'resolution': [], 'assignee': [], 'reporter': [],
      'resolved_at': [], 'custom_fields': [],
      'repo': repo_refs,
      'number': ['raw.github_pulls.number'],
      'title': ['raw.github_pulls.title'],
      'body': ['raw.github_pulls.body'],
      'branch': ['raw.github_pulls.head:$.ref'],
      'state': ['raw.github_pulls.state'],
      'is_draft': ['raw.github_pulls.draft'],
      'author': ['raw.github_pulls.user:$.login'],
      'closed_at': ['raw.github_pulls.closed_at'],
      'merged_at': ['raw.github_pulls.merged_at']
    } as _fields,
    stable_id('github', id) as id,
    concat(repo_name, '#', number) as name,
    'change' as type,
    iso_utc(cast(created_at as timestamptz)) as created_at,
    cast(id as varchar) as source_id,
    html_url as url,
    cast(updated_at as timestamptz) as updated_at,
    repo_name as repo,
    number,
    title,
    body,
    json_extract_string(head, '$.ref') as branch,
    state,
    draft as is_draft,
    json_extract_string("user", '$.login') as author,
    cast(closed_at as timestamptz) as closed_at,
    cast(merged_at as timestamptz) as merged_at
  from latest_pulls
)

select * from tickets
union all by name
select * from changes
order by id
