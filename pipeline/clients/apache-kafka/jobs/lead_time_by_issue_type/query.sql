with ticket_lead_times as (
  select
    tickets._row_id as ticket_id,
    tickets.issue_type,
    date_diff('minute', min(changes.created_at), max(changes.merged_at)) / 60.0 as hours,
    list_concat(
      list(source_ref('changes', changes._row_id)),
      list(source_ref('ticket_change_links', links._row_id))
    ) as change_refs
  from tickets
  inner join ticket_change_links as links on links.ticket_id = tickets._row_id
  inner join changes on changes._row_id = links.change_id
  group by tickets._row_id, tickets.issue_type
  having max(changes.merged_at) is not null
)

select
  stable_id('lead_time_by_issue_type', coalesce(issue_type, '')) as _row_id,
  list_concat(list(source_ref('tickets', ticket_id)), flatten(list(change_refs))) as _sources,
  map {
    'issue_type': ['tickets.issue_type'],
    -- Which changes count toward a ticket depends on its links; a ticket counts once one merged.
    'tickets': ['tickets._row_id', 'ticket_change_links._row_id', 'changes.merged_at'],
    'avg_lead_time_hours':
      ['changes.created_at', 'changes.merged_at', 'ticket_change_links._row_id'],
    'median_lead_time_hours':
      ['changes.created_at', 'changes.merged_at', 'ticket_change_links._row_id']
  } as _fields,
  issue_type,
  count(*) as tickets,
  round(avg(hours), 1) as avg_lead_time_hours,
  round(median(hours), 1) as median_lead_time_hours
from ticket_lead_times
group by issue_type
order by tickets desc
