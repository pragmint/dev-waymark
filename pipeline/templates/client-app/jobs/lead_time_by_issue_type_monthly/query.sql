-- Each ticket's issue type, lead time and last merge, from its metadata.
with tickets as (
  select
    entity_id,
    max(value) filter (key = 'issue_type') as issue_type,
    try_cast(max(value) filter (key = 'lead_time_hours') as double) as hours,
    -- In UTC, so a month's boundaries don't depend on where the pipeline runs.
    date_trunc(
      'month', try_cast(max(value) filter (key = 'last_merged_at') as timestamptz) at time zone 'UTC'
    ) as month_start
  from entity_metadata
  where key in ('issue_type', 'lead_time_hours', 'last_merged_at')
  group by entity_id
  having hours is not null and month_start is not null
)

select
  stable_id('lead_time_by_issue_type_monthly', concat_ws(':', coalesce(issue_type, ''), month_start)) as _row_id,
  list(source_ref('entities', entity_id) order by entity_id) as _sources,
  map {
    'name': [
      'entities.issue_type', 'entities.last_merged_at'
    ],
    'created_at': ['entities.last_merged_at'],
    'issue_type': ['entities.issue_type'],
    'year': ['entities.last_merged_at'],
    'month': ['entities.last_merged_at'],
    -- Which tickets count depends on their issue type, merge month, and having a lead time.
    'tickets': [
      'entities.issue_type',
      'entities.last_merged_at',
      'entities.lead_time_hours'
    ],
    'avg_lead_time_hours': [
      'entities.issue_type',
      'entities.last_merged_at',
      'entities.lead_time_hours'
    ],
    'median_lead_time_hours': [
      'entities.issue_type',
      'entities.last_merged_at',
      'entities.lead_time_hours'
    ]
  } as _fields,
  concat_ws(' ', coalesce(issue_type, 'No issue type'), strftime(month_start, '%Y-%m')) as name,
  strftime(month_start, '%Y-%m-%dT%H:%M:%SZ') as created_at,
  issue_type,
  year(month_start) as year,
  month(month_start) as month,
  count(*) as tickets,
  round(avg(hours), 1) as avg_lead_time_hours,
  round(median(hours), 1) as median_lead_time_hours
from tickets
group by issue_type, month_start
order by month_start, issue_type
