-- Each link's ticket and change, from the link's metadata.
with links as (
  select
    entity_id as link_id,
    try_cast(max(value) filter ("key" = 'ticket_id') as bigint) as ticket_id,
    try_cast(max(value) filter ("key" = 'change_id') as bigint) as change_id
  from entity_metadata
  where entity_type = 'ticket_change_link' and "key" in ('ticket_id', 'change_id')
  group by entity_id
),

merges as (
  select entity_id as change_id, try_cast(value as timestamptz) as merged_at
  from entity_metadata
  where entity_type = 'change' and "key" = 'merged_at'
),

rollups as (
  select
    links.ticket_id,
    count(*) as change_count,
    min(try_cast(changes.created_at as timestamptz)) as first_change_at,
    max(merges.merged_at) as last_merged_at,
    list_concat(
      list(source_ref('entities', links.link_id) order by links.link_id),
      list(source_ref('entities', changes._row_id) order by changes._row_id)
    ) as refs
  from links
  inner join entities as changes on changes._row_id = links.change_id
  left join merges on merges.change_id = links.change_id
  group by links.ticket_id
)

-- Each row adds to the ticket whose id is its _row_id. A link names its ticket and change in its
-- metadata, and the change it names is the one whose values count.
select
  ticket_id as _row_id,
  refs as _sources,
  map {
    'change_count': [
      'entities[type=ticket_change_link].ticket_id',
      'entities[type=ticket_change_link].change_id',
      'entities[type=change]._row_id'
    ],
    'first_change_at': [
      'entities[type=ticket_change_link].ticket_id',
      'entities[type=ticket_change_link].change_id',
      'entities[type=change].created_at'
    ],
    'last_merged_at': [
      'entities[type=ticket_change_link].ticket_id',
      'entities[type=ticket_change_link].change_id',
      'entities[type=change].merged_at'
    ],
    -- First pull request opened to last one merged; none until one has merged.
    'lead_time_hours': [
      'entities[type=ticket_change_link].ticket_id',
      'entities[type=ticket_change_link].change_id',
      'entities[type=change].created_at',
      'entities[type=change].merged_at'
    ]
  } as _fields,
  change_count,
  first_change_at,
  last_merged_at,
  round(date_diff('minute', first_change_at, last_merged_at) / 60.0, 2) as lead_time_hours
from rollups
where ticket_id is not null
order by _row_id
