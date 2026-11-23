-- Each link's change and ticket key, from the link's metadata.
with links as (
  select
    entity_id as link_id,
    try_cast(max(value) filter ("key" = 'change_id') as bigint) as change_id,
    max(value) filter ("key" = 'ticket_key') as ticket_key
  from entity_metadata
  where "key" in ('change_id', 'ticket_key')
  group by entity_id
)

-- Each row adds to the change whose id is its _row_id.
select
  change_id as _row_id,
  list(source_ref('entities', link_id) order by link_id) as _sources,
  map {
    'ticket_keys': ['entities.change_id', 'entities.ticket_key']
  } as _fields,
  string_agg(ticket_key, ',' order by ticket_key) as ticket_keys
from links
where change_id is not null
group by change_id
order by _row_id
