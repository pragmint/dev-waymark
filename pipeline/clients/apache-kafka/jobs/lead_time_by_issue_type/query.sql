with ticket_lead_times as (
  select
    tickets._row_id as ticket_id,
    tickets.issue_type,
    date_diff(
      'minute', min(try_cast(changes.created_at as timestamptz)), max(changes.merged_at)
    ) / 60.0 as hours,
    list_concat(
      list(source_ref('entities', changes._row_id)),
      list(source_ref('ticket_change_links', links._row_id))
    ) as change_refs
  from entities as tickets
  inner join ticket_change_links as links on links.ticket_id = tickets._row_id
  inner join entities as changes on changes._row_id = links.change_id
  where tickets.type = 'ticket'
  group by tickets._row_id, tickets.issue_type
  having max(changes.merged_at) is not null
)

select
  stable_id('lead_time_by_issue_type', coalesce(issue_type, '')) as _row_id,
  list_concat(list(source_ref('entities', ticket_id)), flatten(list(change_refs))) as _sources,
  map {
    'issue_type': ['entities.issue_type'],
    -- Which changes count toward a ticket depends on its links; a ticket counts once one merged.
    'tickets': ['entities._row_id', 'ticket_change_links._row_id', 'entities.merged_at'],
    'avg_lead_time_hours':
      ['entities.created_at', 'entities.merged_at', 'ticket_change_links._row_id'],
    'median_lead_time_hours':
      ['entities.created_at', 'entities.merged_at', 'ticket_change_links._row_id']
  } as _fields,
  issue_type,
  count(*) as tickets,
  round(avg(hours), 1) as avg_lead_time_hours,
  round(median(hours), 1) as median_lead_time_hours
from ticket_lead_times
group by issue_type
order by tickets desc
