select
  stable_id('github', id) as _row_id,
  [source_ref('raw.github_pulls', _dlt_id)] as _sources,
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
