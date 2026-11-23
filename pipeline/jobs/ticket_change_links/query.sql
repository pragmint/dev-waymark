-- Each change's title, branch and body, from its metadata. Underscores count as word characters,
-- so feature/kafka-1_fix would not match without replacing them.
with texts as (
  select
    entity_id as change_id,
    replace(upper(coalesce(max(value) filter ("key" = 'title'), '')), '_', ' ') as title,
    replace(upper(coalesce(max(value) filter ("key" = 'branch'), '')), '_', ' ') as branch,
    replace(upper(coalesce(max(value) filter ("key" = 'body'), '')), '_', ' ') as body
  from entity_metadata
  where "key" in ('title', 'branch', 'body')
  group by entity_id
),

mentions as (
  select distinct
    change_id,
    unnest(regexp_extract_all(
      concat_ws(' ', title, branch, body),
      '\b(?:' || getvariable('ticket_key_pattern') || ')\b'
    )) as ticket_key
  from texts
)

select
  stable_id('link', concat_ws(':', mentions.change_id, tickets._row_id)) as _row_id,
  [source_ref('entities', changes._row_id), source_ref('entities', tickets._row_id)] as _sources,
  map {
    'name': ['entities.name'],
    'created_at': ['entities[type=change].created_at'],
    'change_id': ['entities._row_id'],
    'ticket_id': ['entities._row_id'],
    -- The ticket's key, found in whichever of the change's texts mention it.
    'ticket_key': flatten([
      ['entities[type=ticket].name'],
      case when regexp_matches(text.title, '\b' || mentions.ticket_key || '\b')
        then ['entities[type=change].title'] else [] end,
      case when regexp_matches(text.branch, '\b' || mentions.ticket_key || '\b')
        then ['entities[type=change].branch'] else [] end,
      case when regexp_matches(text.body, '\b' || mentions.ticket_key || '\b')
        then ['entities[type=change].body'] else [] end
    ])
  } as _fields,
  tickets.name || ' in ' || changes.name as name,
  changes.created_at,
  mentions.change_id,
  tickets._row_id as ticket_id,
  mentions.ticket_key
from mentions
inner join entities as tickets
  on tickets.type = 'ticket' and tickets.name = mentions.ticket_key
inner join entities as changes
  on changes.type = 'change' and changes._row_id = mentions.change_id
inner join texts as text on text.change_id = mentions.change_id
order by _row_id
