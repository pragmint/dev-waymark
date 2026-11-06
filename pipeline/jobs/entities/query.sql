select
  _row_id,
  [source_ref('tickets', _row_id)] as _sources,
  _row_id as id,
  ticket_key as name,
  'ticket' as type,
  iso_utc(created_at) as created_at
from tickets
union all
select
  _row_id,
  [source_ref('changes', _row_id)],
  _row_id,
  concat(repo, '#', number),
  'change',
  iso_utc(created_at)
from changes
order by id
