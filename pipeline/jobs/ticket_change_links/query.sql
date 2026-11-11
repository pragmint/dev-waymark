-- Underscores count as word characters, so feature/kafka-1_fix would not match without this.
with normalized as (
  select
    _row_id,
    replace(upper(coalesce(cast(title as varchar), '')), '_', ' ') as title,
    replace(upper(coalesce(cast(branch as varchar), '')), '_', ' ') as branch,
    replace(upper(coalesce(cast(body as varchar), '')), '_', ' ') as body
  from changes
),

mentions as (
  select
    _row_id as change_id,
    unnest(regexp_extract_all(
      concat_ws(' ', title, branch, body),
      '\b(?:' || getvariable('ticket_key_pattern') || ')\b'
    )) as ticket_key
  from normalized
),

distinct_mentions as (
  select distinct change_id, ticket_key from mentions
)

select
  stable_id('link', concat_ws(':', mentions.change_id, tickets._row_id)) as _row_id,
  [source_ref('changes', mentions.change_id), source_ref('tickets', tickets._row_id)] as _sources,
  map {
    'change_id': ['changes._row_id'],
    'ticket_id': ['tickets._row_id'],
    -- The ticket's key, found in whichever of the change's texts mention it.
    'ticket_key': flatten([
      ['tickets.ticket_key'],
      case when regexp_matches(text.title, '\b' || mentions.ticket_key || '\b')
        then ['changes.title'] else [] end,
      case when regexp_matches(text.branch, '\b' || mentions.ticket_key || '\b')
        then ['changes.branch'] else [] end,
      case when regexp_matches(text.body, '\b' || mentions.ticket_key || '\b')
        then ['changes.body'] else [] end
    ])
  } as _fields,
  mentions.change_id,
  tickets._row_id as ticket_id,
  mentions.ticket_key
from distinct_mentions as mentions
inner join tickets on tickets.ticket_key = mentions.ticket_key
inner join normalized as text on text._row_id = mentions.change_id
order by _row_id
