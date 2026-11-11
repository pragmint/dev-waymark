select
  _row_id,
  [source_ref('tickets', _row_id)] as _sources,
  map {
    'id': ['tickets._row_id'],
    'name': ['tickets.ticket_key'],
    'type': [],
    'created_at': ['tickets.created_at']
  } as _fields,
  _row_id as id,
  ticket_key as name,
  'ticket' as type,
  iso_utc(created_at) as created_at
from tickets
union all
select
  _row_id,
  [source_ref('changes', _row_id)],
  map {
    'id': ['changes._row_id'],
    'name': ['changes.repo', 'changes.number'],
    'type': [],
    'created_at': ['changes.created_at']
  },
  _row_id,
  concat(repo, '#', number),
  'change',
  iso_utc(created_at)
from changes
order by id
