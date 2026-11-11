select
  stable_id('github', id) as _row_id,
  [source_ref('raw.github_pulls', _dlt_id)] as _sources,
  map {
    'source_id': ['raw.github_pulls.id'],
    -- The URL is the fallback for a pull request whose base repo is gone.
    'repo': case
      when json_extract_string(base, '$.repo') is not null then ['raw.github_pulls.base:$.repo']
      else ['raw.github_pulls.html_url']
    end,
    'number': ['raw.github_pulls.number'],
    'title': ['raw.github_pulls.title'],
    'body': ['raw.github_pulls.body'],
    'branch': ['raw.github_pulls.head:$.ref'],
    'state': ['raw.github_pulls.state'],
    'is_draft': ['raw.github_pulls.draft'],
    'author': ['raw.github_pulls.user:$.login'],
    'url': ['raw.github_pulls.html_url'],
    'created_at': ['raw.github_pulls.created_at'],
    'updated_at': ['raw.github_pulls.updated_at'],
    'closed_at': ['raw.github_pulls.closed_at'],
    'merged_at': ['raw.github_pulls.merged_at']
  } as _fields,
  id as source_id,
  coalesce(
    json_extract_string(base, '$.repo'),
    regexp_extract(html_url, 'github\.com/([^/]+/[^/]+)/', 1)
  ) as repo,
  number,
  title,
  body,
  json_extract_string(head, '$.ref') as branch,
  state,
  draft as is_draft,
  json_extract_string("user", '$.login') as author,
  html_url as url,
  cast(created_at as timestamptz) as created_at,
  cast(updated_at as timestamptz) as updated_at,
  cast(closed_at as timestamptz) as closed_at,
  cast(merged_at as timestamptz) as merged_at
from raw.github_pulls
qualify row_number() over (
  partition by id order by updated_at desc nulls last, _dlt_load_id desc
) = 1
order by _row_id
