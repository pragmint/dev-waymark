-- Each ticket's issue type, lead time and last merge, from its metadata.
with tickets as (
  select
    entity_id,
    max(value) filter (key = 'issue_type') as issue_type,
    try_cast(max(value) filter (key = 'lead_time_hours') as double) as hours,
    try_cast(max(value) filter (key = 'last_merged_at') as timestamptz) as last_merged_at
  from entity_metadata
  where key in ('issue_type', 'lead_time_hours', 'last_merged_at')
  group by entity_id
  having hours is not null and last_merged_at is not null
)

select
  stable_id('lead_time_by_issue_type', coalesce(issue_type, '')) as _row_id,
  list(source_ref('entities', entity_id) order by entity_id) as _sources,
  map {
    'name': ['entities.issue_type'],
    -- An entity needs a date; an issue type's is its most recent merge.
    'created_at': [
      'entities.issue_type',
      'entities.last_merged_at',
      'entities.lead_time_hours'
    ],
    'issue_type': ['entities.issue_type'],
    -- Which tickets count depends on their issue type and having a lead time.
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
  coalesce(issue_type, 'No issue type') as name,
  iso_utc(max(last_merged_at)) as created_at,
  issue_type,
  count(*) as tickets,
  round(avg(hours), 1) as avg_lead_time_hours,
  round(median(hours), 1) as median_lead_time_hours
from tickets
group by issue_type
order by tickets desc, issue_type
