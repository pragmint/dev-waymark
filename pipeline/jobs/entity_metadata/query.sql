-- Each value's _sources is the entity's own row, plus the rows on the other side of the links
-- for values rolled up across them (a ticket's change count, a change's ticket keys), and the
-- links that joined them.
with ticket_rollups as (
  select
    links.ticket_id,
    count(*) as change_count,
    min(try_cast(changes.created_at as timestamptz)) as first_change_at,
    max(changes.merged_at) as last_merged_at,
    list_concat(
      list(source_ref('entities', changes._row_id)),
      list(source_ref('ticket_change_links', links._row_id))
    ) as change_refs
  from ticket_change_links as links
  inner join entities as changes on changes._row_id = links.change_id
  group by links.ticket_id
),

change_tickets as (
  select
    change_id,
    string_agg(ticket_key, ',' order by ticket_key) as ticket_keys,
    list_concat(
      list(source_ref('entities', ticket_id)),
      list(source_ref('ticket_change_links', _row_id))
    ) as ticket_refs
  from ticket_change_links
  group by change_id
),

ticket_values as (
  select
    tickets.*,
    rollups.* exclude (ticket_id),
    [source_ref('entities', tickets._row_id)] as own_refs,
    list_concat(own_refs, rollups.change_refs) as rollup_refs
  from entities as tickets
  left join ticket_rollups as rollups on rollups.ticket_id = tickets._row_id
  where tickets.type = 'ticket'
),

change_values as (
  select
    changes.*,
    change_tickets.ticket_keys,
    [source_ref('entities', changes._row_id)] as own_refs,
    list_concat(own_refs, change_tickets.ticket_refs) as rollup_refs
  from entities as changes
  left join change_tickets on change_tickets.change_id = changes._row_id
  where changes.type = 'change'
),

ticket_rows as (
  select _row_id as entity_id, created_at, updated_at, unnest([
    {'key': 'summary', 'value': summary, 'value_type': 'string', 'refs': own_refs, 'fields': ['entities.summary']},
    {'key': 'project', 'value': project, 'value_type': 'string', 'refs': own_refs, 'fields': ['entities.project']},
    {'key': 'issue_type', 'value': issue_type, 'value_type': 'string', 'refs': own_refs, 'fields': ['entities.issue_type']},
    {'key': 'status', 'value': status, 'value_type': 'string', 'refs': own_refs, 'fields': ['entities.status']},
    {'key': 'status_group', 'value': status_group, 'value_type': 'string', 'refs': own_refs, 'fields': ['entities.status_group']},
    {'key': 'priority', 'value': priority, 'value_type': 'string', 'refs': own_refs, 'fields': ['entities.priority']},
    {'key': 'resolution', 'value': resolution, 'value_type': 'string', 'refs': own_refs, 'fields': ['entities.resolution']},
    {'key': 'assignee', 'value': assignee, 'value_type': 'string', 'refs': own_refs, 'fields': ['entities.assignee']},
    {'key': 'reporter', 'value': reporter, 'value_type': 'string', 'refs': own_refs, 'fields': ['entities.reporter']},
    {'key': 'url', 'value': url, 'value_type': 'string', 'refs': own_refs, 'fields': ['entities.url']},
    {'key': 'updated_at', 'value': iso_utc(updated_at), 'value_type': 'date', 'refs': own_refs, 'fields': ['entities.updated_at']},
    {'key': 'resolved_at', 'value': iso_utc(resolved_at), 'value_type': 'date', 'refs': own_refs, 'fields': ['entities.resolved_at']},
    {'key': 'change_count', 'value': cast(change_count as varchar), 'value_type': 'number', 'refs': rollup_refs, 'fields': ['entities[type=change]._row_id', 'ticket_change_links._row_id']},
    {'key': 'first_change_at', 'value': iso_utc(first_change_at), 'value_type': 'date', 'refs': rollup_refs, 'fields': ['entities[type=change].created_at', 'ticket_change_links._row_id']},
    {'key': 'last_merged_at', 'value': iso_utc(last_merged_at), 'value_type': 'date', 'refs': rollup_refs, 'fields': ['entities[type=change].merged_at', 'ticket_change_links._row_id']},
    -- First pull request opened to last one merged; none until one has merged.
    {'key': 'lead_time_hours', 'value': cast(round(date_diff('minute', first_change_at, last_merged_at) / 60.0, 2) as varchar), 'value_type': 'number', 'refs': rollup_refs, 'fields': ['entities[type=change].created_at', 'entities[type=change].merged_at', 'ticket_change_links._row_id']}
  ]) as m
  from ticket_values
),

custom_rows as (
  select
    entity_id,
    created_at,
    updated_at,
    {
      'key': key,
      'value': case value_type
        when 'date' then iso_utc(try_cast(text as timestamptz))
        when 'number' then cast(try_cast(text as double) as varchar)
        when 'boolean' then cast(try_cast(text as boolean) as varchar)
        else text
      end,
      'value_type': value_type,
      'refs': refs,
      -- A reference can't name one key of a map, so every custom value reads all of them.
      'fields': ['entities.custom_fields']
    } as m
  from (
    select
      tickets._row_id as entity_id,
      tickets.created_at,
      tickets.updated_at,
      field.key,
      field.value_type,
      map_extract_value(tickets.custom_fields, field.key) as text,
      [source_ref('entities', tickets._row_id)] as refs
    from entities as tickets
    cross join params.jira_fields as field
    where tickets.type = 'ticket'
  )
),

change_rows as (
  select _row_id as entity_id, created_at, updated_at, unnest([
    {'key': 'title', 'value': title, 'value_type': 'string', 'refs': own_refs, 'fields': ['entities.title']},
    {'key': 'repo', 'value': repo, 'value_type': 'string', 'refs': own_refs, 'fields': ['entities.repo']},
    {'key': 'number', 'value': cast(number as varchar), 'value_type': 'number', 'refs': own_refs, 'fields': ['entities.number']},
    {'key': 'branch', 'value': branch, 'value_type': 'string', 'refs': own_refs, 'fields': ['entities.branch']},
    {'key': 'state', 'value': state, 'value_type': 'string', 'refs': own_refs, 'fields': ['entities.state']},
    {'key': 'is_draft', 'value': cast(is_draft as varchar), 'value_type': 'boolean', 'refs': own_refs, 'fields': ['entities.is_draft']},
    {'key': 'author', 'value': author, 'value_type': 'string', 'refs': own_refs, 'fields': ['entities.author']},
    {'key': 'url', 'value': url, 'value_type': 'string', 'refs': own_refs, 'fields': ['entities.url']},
    {'key': 'updated_at', 'value': iso_utc(updated_at), 'value_type': 'date', 'refs': own_refs, 'fields': ['entities.updated_at']},
    {'key': 'closed_at', 'value': iso_utc(closed_at), 'value_type': 'date', 'refs': own_refs, 'fields': ['entities.closed_at']},
    {'key': 'merged_at', 'value': iso_utc(merged_at), 'value_type': 'date', 'refs': own_refs, 'fields': ['entities.merged_at']},
    {'key': 'ticket_keys', 'value': ticket_keys, 'value_type': 'string', 'refs': rollup_refs, 'fields': ['ticket_change_links.ticket_key']}
  ]) as m
  from change_values
),

all_rows as (
  select * from ticket_rows
  union all
  select * from custom_rows
  union all
  select * from change_rows
)

-- Sorted by key so a chart reading a few keys can skip the other row groups.
select
  stable_id('metadata', concat_ws(':', entity_id, m.key)) as _row_id,
  m.refs as _sources,
  map {
    'id': ['entities._row_id'],
    'entity_id': ['entities._row_id'],
    'key': [],
    'value': m.fields,
    'value_type': [],
    'created_at': ['entities.created_at'],
    'updated_at': [if(updated_at is null, 'entities.created_at', 'entities.updated_at')]
  } as _fields,
  stable_id('metadata', concat_ws(':', entity_id, m.key)) as id,
  entity_id,
  m.key,
  m.value,
  m.value_type,
  created_at,
  coalesce(iso_utc(updated_at), created_at) as updated_at
from all_rows
where m.value is not null
order by m.key, entity_id
