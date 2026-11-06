with ticket_lead_times as (
  select
    tickets._row_id as ticket_id,
    tickets.issue_type,
    date_diff('minute', min(changes.created_at), max(changes.merged_at)) / 60.0 as hours,
    list(source_ref('changes', changes._row_id)) as change_refs
  from tickets
  inner join ticket_change_links as links on links.ticket_id = tickets._row_id
  inner join changes on changes._row_id = links.change_id
  group by tickets._row_id, tickets.issue_type
  having max(changes.merged_at) is not null
)

select
  stable_id('lead_time_by_issue_type', coalesce(issue_type, '')) as _row_id,
  list_concat(list(source_ref('tickets', ticket_id)), flatten(list(change_refs))) as _sources,
  issue_type,
  count(*) as tickets,
  round(avg(hours), 1) as avg_lead_time_hours,
  round(median(hours), 1) as median_lead_time_hours
from ticket_lead_times
group by issue_type
order by tickets desc
