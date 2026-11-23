-- One change per GitHub pull request, the latest raw version of each. Every column but the
-- contract's, name and created_at is the change's metadata.
with latest as (
  select
    *,
    coalesce(
      json_extract_string(base, '$.repo'),
      regexp_extract(html_url, 'github\.com/([^/]+/[^/]+)/', 1)
    ) as repo_name,
    -- The URL is the fallback for a pull request whose base repo is gone.
    case
      when json_extract_string(base, '$.repo') is not null then ['raw.github_pulls.base:$.repo']
      else ['raw.github_pulls.html_url']
    end as repo_refs
  from raw.github_pulls
  qualify row_number() over (
    partition by id order by updated_at desc nulls last, _dlt_load_id desc
  ) = 1
)

select
  stable_id('github', id) as _row_id,
  [source_ref('raw.github_pulls', _dlt_id)] as _sources,
  map {
    'name': list_concat(repo_refs, ['raw.github_pulls.number']),
    'created_at': ['raw.github_pulls.created_at'],
    'source_id': ['raw.github_pulls.id'],
    'url': ['raw.github_pulls.html_url'],
    'updated_at': ['raw.github_pulls.updated_at'],
    'repo': repo_refs,
    'number': ['raw.github_pulls.number'],
    'title': ['raw.github_pulls.title'],
    'body': ['raw.github_pulls.body'],
    'branch': ['raw.github_pulls.head:$.ref'],
    'state': ['raw.github_pulls.state'],
    'is_draft': ['raw.github_pulls.draft'],
    'author': ['raw.github_pulls.user:$.login'],
    'closed_at': ['raw.github_pulls.closed_at'],
    'merged_at': ['raw.github_pulls.merged_at']
  } as _fields,
  concat(repo_name, '#', number) as name,
  iso_utc(cast(created_at as timestamptz)) as created_at,
  cast(id as varchar) as source_id,
  html_url as url,
  cast(updated_at as timestamptz) as updated_at,
  repo_name as repo,
  number,
  title,
  body,
  json_extract_string(head, '$.ref') as branch,
  state,
  draft as is_draft,
  json_extract_string("user", '$.login') as author,
  cast(closed_at as timestamptz) as closed_at,
  cast(merged_at as timestamptz) as merged_at
from latest
order by _row_id
