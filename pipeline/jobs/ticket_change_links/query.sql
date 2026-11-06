-- Underscores count as word characters, so feature/kafka-1_fix would not match without this.
with mentions as (
  select
    _row_id as change_id,
    unnest(regexp_extract_all(
      replace(upper(concat_ws(' ', title, branch, body)), '_', ' '),
      '\b(?:' || getvariable('ticket_key_pattern') || ')\b'
    )) as ticket_key
  from changes
),

distinct_mentions as (
  select distinct change_id, ticket_key from mentions
)

select
  stable_id('link', concat_ws(':', mentions.change_id, tickets._row_id)) as _row_id,
  [source_ref('changes', mentions.change_id), source_ref('tickets', tickets._row_id)] as _sources,
  mentions.change_id,
  tickets._row_id as ticket_id,
  mentions.ticket_key
from distinct_mentions as mentions
inner join tickets on tickets.ticket_key = mentions.ticket_key
order by _row_id
