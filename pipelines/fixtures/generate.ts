import { ParquetWriter, ParquetSchema } from '@dsnp/parquetjs';
import { mkdirSync } from 'node:fs';

mkdirSync(new URL('.', import.meta.url).pathname, { recursive: true });

type EntityRow = { id: string; source_id: string; created_at: string; updated_at: string };
type MetaRow = { entity_id: string; key: string; value: string | null; value_type: string };

function s(entity_id: string, key: string, value: string): MetaRow {
  return { entity_id, key, value, value_type: 'string' };
}
function n(entity_id: string, key: string, value: string): MetaRow {
  return { entity_id, key, value, value_type: 'number' };
}
function d(entity_id: string, key: string, value: string | null): MetaRow {
  return { entity_id, key, value, value_type: 'date' };
}

// ---------------------------------------------------------------------------
// Golden dataset
//
// 5 Jira tickets: a mix of types, priorities, and lead times — two of which
//   have linked GitHub PRs (ENG-3349, ENG-3411).
// 4 GitHub PRs: MERGED, with varying review times; two linked to tickets,
//   one version-bump chore (no ticket), one release PR.
// 3 WIP snapshots: first, mid, and latest board state for trend analysis.
// ---------------------------------------------------------------------------

const entityRows: EntityRow[] = [];
const metadataRows: MetaRow[] = [];

function addEntity(entity: EntityRow, meta: MetaRow[]): void {
  entityRows.push(entity);
  metadataRows.push(...meta);
}

// --- Jira tickets ---

addEntity(
  {
    id: 'jira:ENG-2',
    source_id: 'ENG-2',
    created_at: '2024-12-19T16:25:28Z',
    updated_at: '2026-05-06T03:49:26Z',
  },
  [
    s('jira:ENG-2', 'source', 'jira'),
    s('jira:ENG-2', 'type', 'jira_ticket'),
    s('jira:ENG-2', 'ticket_type', 'Story'),
    s('jira:ENG-2', 'priority', 'Medium'),
    s('jira:ENG-2', 'assignee', 'Alex Rivera'),
    s('jira:ENG-2', 'gh_author', 'arivera'),
    d('jira:ENG-2', 'jira_created_at', '2024-12-19T16:25:28Z'),
    d('jira:ENG-2', 'jira_in_progress_at', '2024-12-19T16:26:11Z'),
    d('jira:ENG-2', 'gh_first_commit_at', '2024-12-24T14:16:42Z'),
    d('jira:ENG-2', 'gh_first_pr_created_at', '2024-12-26T13:23:11Z'),
    d('jira:ENG-2', 'gh_last_pr_merged_at', '2024-12-26T13:33:17Z'),
    d('jira:ENG-2', 'gh_last_pr_merged_to_main_at', '2025-01-22T21:32:07Z'),
    d('jira:ENG-2', 'jira_done_at', '2024-12-26T13:24:01Z'),
    d('jira:ENG-2', 'computed_completed_at', '2025-01-22T21:32:07Z'),
    n('jira:ENG-2', 'gh_prs_merged', '1'),
    n('jira:ENG-2', 'gh_prs_closed', '0'),
    n('jira:ENG-2', 'gh_prs_open', '0'),
    n('jira:ENG-2', 'total_lead_time_seconds', '2955999'),
    n('jira:ENG-2', 'grooming_lead_time_seconds', '43'),
    n('jira:ENG-2', 'queued_for_dev_lead_time_seconds', '0'),
    n('jira:ENG-2', 'development_lead_time_seconds', '593820'),
    n('jira:ENG-2', 'review_lead_time_seconds', '2362136'),
    n('jira:ENG-2', 'quality_inspection_seconds', '0'),
    n('jira:ENG-2', 'release_seconds', '0'),
  ]
);

addEntity(
  {
    id: 'jira:ENG-7',
    source_id: 'ENG-7',
    created_at: '2024-12-19T17:02:00Z',
    updated_at: '2026-05-06T03:49:26Z',
  },
  [
    s('jira:ENG-7', 'source', 'jira'),
    s('jira:ENG-7', 'type', 'jira_ticket'),
    s('jira:ENG-7', 'ticket_type', 'Story'),
    s('jira:ENG-7', 'priority', 'Medium'),
    s('jira:ENG-7', 'assignee', 'Alex Rivera'),
    s('jira:ENG-7', 'gh_author', 'arivera'),
    d('jira:ENG-7', 'jira_created_at', '2024-12-19T17:02:00Z'),
    d('jira:ENG-7', 'jira_in_progress_at', '2024-12-19T17:02:11Z'),
    d('jira:ENG-7', 'gh_first_commit_at', '2025-01-02T13:11:54Z'),
    d('jira:ENG-7', 'gh_first_pr_created_at', '2025-01-02T13:12:32Z'),
    d('jira:ENG-7', 'gh_last_pr_merged_at', '2025-01-02T13:13:00Z'),
    d('jira:ENG-7', 'gh_last_pr_merged_to_main_at', '2025-01-22T21:32:07Z'),
    d('jira:ENG-7', 'jira_done_at', '2025-01-23T13:25:18Z'),
    d('jira:ENG-7', 'computed_completed_at', '2025-01-23T13:25:18Z'),
    n('jira:ENG-7', 'gh_prs_merged', '1'),
    n('jira:ENG-7', 'gh_prs_closed', '0'),
    n('jira:ENG-7', 'gh_prs_open', '0'),
    n('jira:ENG-7', 'total_lead_time_seconds', '3010998'),
    n('jira:ENG-7', 'grooming_lead_time_seconds', '11'),
    n('jira:ENG-7', 'queued_for_dev_lead_time_seconds', '0'),
    n('jira:ENG-7', 'development_lead_time_seconds', '1195821'),
    n('jira:ENG-7', 'review_lead_time_seconds', '1815166'),
    n('jira:ENG-7', 'quality_inspection_seconds', '0'),
    n('jira:ENG-7', 'release_seconds', '0'),
  ]
);

// Bug with Highest priority and very long lead time — good edge case for outlier detection
addEntity(
  {
    id: 'jira:OPS-15',
    source_id: 'OPS-15',
    created_at: '2024-08-01T11:17:44Z',
    updated_at: '2026-05-06T03:49:26Z',
  },
  [
    s('jira:OPS-15', 'source', 'jira'),
    s('jira:OPS-15', 'type', 'jira_ticket'),
    s('jira:OPS-15', 'ticket_type', 'Bug'),
    s('jira:OPS-15', 'priority', 'Highest'),
    s('jira:OPS-15', 'assignee', 'Priya Sharma'),
    s('jira:OPS-15', 'gh_author', 'psharma'),
    d('jira:OPS-15', 'jira_created_at', '2024-08-01T11:17:44Z'),
    d('jira:OPS-15', 'jira_todo_at', '2024-11-27T14:12:46Z'),
    d('jira:OPS-15', 'jira_in_progress_at', '2024-10-25T15:50:37Z'),
    d('jira:OPS-15', 'gh_first_commit_at', '2025-01-28T20:28:35Z'),
    d('jira:OPS-15', 'gh_first_pr_created_at', '2025-01-28T20:34:43Z'),
    d('jira:OPS-15', 'gh_last_ready_at', '2025-02-05T19:08:52Z'),
    d('jira:OPS-15', 'gh_last_review_at', '2025-02-05T19:13:19Z'),
    d('jira:OPS-15', 'quality_inspection_at', '2025-01-09T16:27:58Z'),
    d('jira:OPS-15', 'ready_for_release_at', '2025-01-28T16:41:09Z'),
    d('jira:OPS-15', 'gh_last_pr_merged_at', '2025-02-05T19:22:33Z'),
    d('jira:OPS-15', 'gh_last_pr_closed_at', '2025-05-12T16:26:16Z'),
    d('jira:OPS-15', 'jira_done_at', '2025-01-10T18:58:00Z'),
    d('jira:OPS-15', 'computed_completed_at', '2025-05-12T16:26:16Z'),
    n('jira:OPS-15', 'gh_prs_merged', '2'),
    n('jira:OPS-15', 'gh_prs_closed', '2'),
    n('jira:OPS-15', 'gh_prs_open', '0'),
    n('jira:OPS-15', 'total_lead_time_seconds', '24556112'),
    n('jira:OPS-15', 'grooming_lead_time_seconds', '7360373'),
    n('jira:OPS-15', 'queued_for_dev_lead_time_seconds', '0'),
    n('jira:OPS-15', 'development_lead_time_seconds', '8911095'),
    n('jira:OPS-15', 'review_lead_time_seconds', '267'),
    n('jira:OPS-15', 'quality_inspection_seconds', '0'),
    n('jira:OPS-15', 'release_seconds', '8284377'),
  ]
);

// Story with a linked PR (github:1029)
addEntity(
  {
    id: 'jira:ENG-3349',
    source_id: 'ENG-3349',
    created_at: '2026-04-02T15:38:13Z',
    updated_at: '2026-05-09T02:40:34Z',
  },
  [
    s('jira:ENG-3349', 'source', 'jira'),
    s('jira:ENG-3349', 'type', 'jira_ticket'),
    s('jira:ENG-3349', 'ticket_type', 'Story'),
    s('jira:ENG-3349', 'priority', 'Medium'),
    s('jira:ENG-3349', 'assignee', 'Jordan Kim'),
    s('jira:ENG-3349', 'gh_author', 'jkim'),
    d('jira:ENG-3349', 'jira_created_at', '2026-04-02T15:38:13Z'),
    d('jira:ENG-3349', 'jira_todo_at', '2026-04-07T19:40:14Z'),
    d('jira:ENG-3349', 'jira_in_progress_at', '2026-04-14T15:59:58Z'),
    d('jira:ENG-3349', 'gh_first_commit_at', '2026-04-21T14:20:37Z'),
    d('jira:ENG-3349', 'gh_first_pr_created_at', '2026-04-21T15:03:27Z'),
    d('jira:ENG-3349', 'gh_last_ready_at', '2026-04-21T15:03:27Z'),
    d('jira:ENG-3349', 'gh_last_review_at', '2026-04-23T15:27:29Z'),
    d('jira:ENG-3349', 'quality_inspection_at', '2026-04-24T15:15:58Z'),
    d('jira:ENG-3349', 'ready_for_release_at', '2026-05-07T17:51:37Z'),
    d('jira:ENG-3349', 'gh_last_pr_merged_at', '2026-05-07T21:30:49Z'),
    d('jira:ENG-3349', 'jira_done_at', null),
    d('jira:ENG-3349', 'computed_completed_at', null),
    n('jira:ENG-3349', 'gh_prs_merged', '1'),
    n('jira:ENG-3349', 'gh_prs_closed', '0'),
    n('jira:ENG-3349', 'gh_prs_open', '0'),
    n('jira:ENG-3349', 'total_lead_time_seconds', '3150142'),
    n('jira:ENG-3349', 'grooming_lead_time_seconds', '446521'),
    n('jira:ENG-3349', 'queued_for_dev_lead_time_seconds', '591584'),
    n('jira:ENG-3349', 'development_lead_time_seconds', '601409'),
    n('jira:ENG-3349', 'review_lead_time_seconds', '259951'),
    n('jira:ENG-3349', 'quality_inspection_seconds', '1132539'),
    n('jira:ENG-3349', 'release_seconds', '118138'),
  ]
);

// Task with a linked PR (github:1026) — fast turnaround example
addEntity(
  {
    id: 'jira:ENG-3411',
    source_id: 'ENG-3411',
    created_at: '2026-04-15T18:25:15Z',
    updated_at: '2026-05-09T02:40:34Z',
  },
  [
    s('jira:ENG-3411', 'source', 'jira'),
    s('jira:ENG-3411', 'type', 'jira_ticket'),
    s('jira:ENG-3411', 'ticket_type', 'Task'),
    s('jira:ENG-3411', 'priority', 'Medium'),
    s('jira:ENG-3411', 'assignee', 'Sam Chen'),
    s('jira:ENG-3411', 'gh_author', 'schen'),
    d('jira:ENG-3411', 'jira_created_at', '2026-04-15T18:25:15Z'),
    d('jira:ENG-3411', 'jira_todo_at', '2026-04-20T15:11:14Z'),
    d('jira:ENG-3411', 'jira_in_progress_at', '2026-04-20T16:00:25Z'),
    d('jira:ENG-3411', 'gh_first_commit_at', '2026-04-20T16:16:59Z'),
    d('jira:ENG-3411', 'gh_first_pr_created_at', '2026-04-20T16:18:26Z'),
    d('jira:ENG-3411', 'gh_last_ready_at', '2026-04-20T16:18:26Z'),
    d('jira:ENG-3411', 'gh_last_review_at', '2026-04-21T16:08:02Z'),
    d('jira:ENG-3411', 'quality_inspection_at', '2026-04-22T14:35:00Z'),
    d('jira:ENG-3411', 'ready_for_release_at', '2026-04-23T16:43:52Z'),
    d('jira:ENG-3411', 'gh_last_pr_merged_at', '2026-04-23T17:32:02Z'),
    d('jira:ENG-3411', 'gh_last_pr_merged_to_main_at', '2026-04-24T15:31:06Z'),
    d('jira:ENG-3411', 'jira_done_at', '2026-04-24T19:22:53Z'),
    d('jira:ENG-3411', 'computed_completed_at', '2026-04-24T19:22:53Z'),
    n('jira:ENG-3411', 'gh_prs_merged', '1'),
    n('jira:ENG-3411', 'gh_prs_closed', '0'),
    n('jira:ENG-3411', 'gh_prs_open', '0'),
    n('jira:ENG-3411', 'total_lead_time_seconds', '781058'),
    n('jira:ENG-3411', 'grooming_lead_time_seconds', '420359'),
    n('jira:ENG-3411', 'queued_for_dev_lead_time_seconds', '2951'),
    n('jira:ENG-3411', 'development_lead_time_seconds', '1081'),
    n('jira:ENG-3411', 'review_lead_time_seconds', '166594'),
    n('jira:ENG-3411', 'quality_inspection_seconds', '94132'),
    n('jira:ENG-3411', 'release_seconds', '95941'),
  ]
);

// --- GitHub PRs ---

// Feature PR linked to ENG-3349
addEntity(
  {
    id: 'github:1029',
    source_id: '1029',
    created_at: '2026-04-21T15:03:27Z',
    updated_at: '2026-05-07T21:30:49Z',
  },
  [
    s('github:1029', 'source', 'github'),
    s('github:1029', 'type', 'github_pr'),
    s('github:1029', 'repo', 'acme-corp/web-platform'),
    s('github:1029', 'creator', 'jkim'),
    s('github:1029', 'branch', 'feature/ENG-3349'),
    s('github:1029', 'target_branch', 'release'),
    s('github:1029', 'title', 'ENG-3349: Add rate limiting to booking confirmation flow'),
    s('github:1029', 'jira_ticket', 'ENG-3349'),
    s('github:1029', 'state', 'MERGED'),
    s('github:1029', 'first_reviewer', 'schen'),
    s('github:1029', 'last_reviewer', 'twright'),
    d('github:1029', 'first_commit_at', '2026-04-21T14:20:37Z'),
    d('github:1029', 'created_at', '2026-04-21T15:03:27Z'),
    d('github:1029', 'ready_for_review_at', '2026-04-21T15:03:27Z'),
    d('github:1029', 'last_ready_at', '2026-04-21T15:03:27Z'),
    d('github:1029', 'first_review_at', '2026-04-21T16:03:17Z'),
    d('github:1029', 'last_review_at', '2026-04-23T15:27:29Z'),
    d('github:1029', 'resolved_at', '2026-05-07T21:30:49Z'),
    d('github:1029', 'merged_to_main_at', null),
    n('github:1029', 'first_commit_to_pr_seconds', '2570'),
    n('github:1029', 'lines_changed', '301'),
    n('github:1029', 'times_set_to_draft', '0'),
    n('github:1029', 'time_in_draft_before_first_review_seconds', '0'),
    n('github:1029', 'first_review_wait_seconds', '3590'),
    n('github:1029', 'worded_comment_count', '1'),
    n('github:1029', 'review_count', '2'),
    n('github:1029', 'all_time_in_draft_seconds', '0'),
    n('github:1029', 'last_review_wait_seconds', '174242'),
    n('github:1029', 'last_review_to_resolution_seconds', '1231400'),
  ]
);

// Chore PR — no linked Jira ticket, tiny diff, very fast review
addEntity(
  {
    id: 'github:1028',
    source_id: '1028',
    created_at: '2026-04-21T14:54:33Z',
    updated_at: '2026-04-21T15:02:47Z',
  },
  [
    s('github:1028', 'source', 'github'),
    s('github:1028', 'type', 'github_pr'),
    s('github:1028', 'repo', 'acme-corp/web-platform'),
    s('github:1028', 'creator', 'schen'),
    s('github:1028', 'branch', 'chore/bump-v2.1.5'),
    s('github:1028', 'target_branch', 'release'),
    s('github:1028', 'title', 'chore: version bump to v2.1.5'),
    s('github:1028', 'jira_ticket', ''),
    s('github:1028', 'state', 'MERGED'),
    s('github:1028', 'first_reviewer', 'jkim'),
    s('github:1028', 'last_reviewer', 'mlopez'),
    d('github:1028', 'first_commit_at', '2026-04-21T14:51:23Z'),
    d('github:1028', 'created_at', '2026-04-21T14:54:33Z'),
    d('github:1028', 'ready_for_review_at', '2026-04-21T14:54:33Z'),
    d('github:1028', 'last_ready_at', '2026-04-21T14:54:33Z'),
    d('github:1028', 'first_review_at', '2026-04-21T14:57:00Z'),
    d('github:1028', 'last_review_at', '2026-04-21T14:57:15Z'),
    d('github:1028', 'resolved_at', '2026-04-21T15:02:47Z'),
    d('github:1028', 'merged_to_main_at', '2026-04-24T15:31:06Z'),
    n('github:1028', 'first_commit_to_pr_seconds', '190'),
    n('github:1028', 'lines_changed', '6'),
    n('github:1028', 'times_set_to_draft', '0'),
    n('github:1028', 'time_in_draft_before_first_review_seconds', '0'),
    n('github:1028', 'first_review_wait_seconds', '147'),
    n('github:1028', 'worded_comment_count', '0'),
    n('github:1028', 'review_count', '2'),
    n('github:1028', 'all_time_in_draft_seconds', '0'),
    n('github:1028', 'last_review_wait_seconds', '162'),
    n('github:1028', 'last_review_to_resolution_seconds', '332'),
    n('github:1028', 'merge_to_main_seconds', '260899'),
  ]
);

// Release PR — no ticket, large diff (accumulated sprint work)
addEntity(
  {
    id: 'github:1027',
    source_id: '1027',
    created_at: '2026-04-21T14:17:39Z',
    updated_at: '2026-04-21T14:36:56Z',
  },
  [
    s('github:1027', 'source', 'github'),
    s('github:1027', 'type', 'github_pr'),
    s('github:1027', 'repo', 'acme-corp/web-platform'),
    s('github:1027', 'creator', 'mlopez'),
    s('github:1027', 'branch', 'release'),
    s('github:1027', 'target_branch', 'main'),
    s('github:1027', 'title', 'Release'),
    s('github:1027', 'jira_ticket', ''),
    s('github:1027', 'state', 'MERGED'),
    s('github:1027', 'first_reviewer', 'arivera'),
    s('github:1027', 'last_reviewer', 'dlee'),
    d('github:1027', 'first_commit_at', '2026-04-17T20:05:13Z'),
    d('github:1027', 'created_at', '2026-04-21T14:17:39Z'),
    d('github:1027', 'ready_for_review_at', '2026-04-21T14:17:39Z'),
    d('github:1027', 'last_ready_at', '2026-04-21T14:17:39Z'),
    d('github:1027', 'first_review_at', '2026-04-21T14:23:52Z'),
    d('github:1027', 'last_review_at', '2026-04-21T14:24:42Z'),
    d('github:1027', 'resolved_at', '2026-04-21T14:36:56Z'),
    d('github:1027', 'merged_to_main_at', '2026-04-21T14:36:56Z'),
    n('github:1027', 'first_commit_to_pr_seconds', '324746'),
    n('github:1027', 'lines_changed', '1959'),
    n('github:1027', 'times_set_to_draft', '0'),
    n('github:1027', 'time_in_draft_before_first_review_seconds', '0'),
    n('github:1027', 'first_review_wait_seconds', '373'),
    n('github:1027', 'worded_comment_count', '5'),
    n('github:1027', 'review_count', '3'),
    n('github:1027', 'all_time_in_draft_seconds', '0'),
    n('github:1027', 'last_review_wait_seconds', '423'),
    n('github:1027', 'last_review_to_resolution_seconds', '734'),
    n('github:1027', 'merge_to_main_seconds', '0'),
  ]
);

// Data update PR linked to ENG-3411 — fast cycle time from commit to merge
addEntity(
  {
    id: 'github:1026',
    source_id: '1026',
    created_at: '2026-04-20T16:18:26Z',
    updated_at: '2026-04-23T17:32:02Z',
  },
  [
    s('github:1026', 'source', 'github'),
    s('github:1026', 'type', 'github_pr'),
    s('github:1026', 'repo', 'acme-corp/web-platform'),
    s('github:1026', 'creator', 'schen'),
    s('github:1026', 'branch', 'chore/ENG-3411/q2-pricing-data-refresh'),
    s('github:1026', 'target_branch', 'release'),
    s('github:1026', 'title', 'ENG-3411: refresh Q2 pricing reference data'),
    s('github:1026', 'jira_ticket', 'ENG-3411'),
    s('github:1026', 'state', 'MERGED'),
    s('github:1026', 'first_reviewer', 'jkim'),
    s('github:1026', 'last_reviewer', 'mlopez'),
    d('github:1026', 'first_commit_at', '2026-04-20T16:16:59Z'),
    d('github:1026', 'created_at', '2026-04-20T16:18:26Z'),
    d('github:1026', 'ready_for_review_at', '2026-04-20T16:18:26Z'),
    d('github:1026', 'last_ready_at', '2026-04-20T16:18:26Z'),
    d('github:1026', 'first_review_at', '2026-04-20T16:19:24Z'),
    d('github:1026', 'last_review_at', '2026-04-21T16:08:02Z'),
    d('github:1026', 'resolved_at', '2026-04-23T17:32:02Z'),
    d('github:1026', 'merged_to_main_at', '2026-04-24T15:31:06Z'),
    n('github:1026', 'first_commit_to_pr_seconds', '87'),
    n('github:1026', 'lines_changed', '293'),
    n('github:1026', 'times_set_to_draft', '0'),
    n('github:1026', 'time_in_draft_before_first_review_seconds', '0'),
    n('github:1026', 'first_review_wait_seconds', '58'),
    n('github:1026', 'worded_comment_count', '2'),
    n('github:1026', 'review_count', '2'),
    n('github:1026', 'all_time_in_draft_seconds', '0'),
    n('github:1026', 'last_review_wait_seconds', '85776'),
    n('github:1026', 'last_review_to_resolution_seconds', '177840'),
    n('github:1026', 'merge_to_main_seconds', '79144'),
  ]
);

// --- WIP snapshots (first, mid, latest) ---

addEntity(
  {
    id: 'jira_snapshot:2026-04-16T17:21:34Z',
    source_id: '2026-04-16T17:21:34Z',
    created_at: '2026-04-16T17:21:34Z',
    updated_at: '2026-04-16T17:21:34Z',
  },
  [
    s('jira_snapshot:2026-04-16T17:21:34Z', 'source', 'jira'),
    s('jira_snapshot:2026-04-16T17:21:34Z', 'type', 'wip_snapshot'),
    n('jira_snapshot:2026-04-16T17:21:34Z', 'in_progress', '21'),
    s(
      'jira_snapshot:2026-04-16T17:21:34Z',
      'in_progress_tickets',
      'ENG-3415,ENG-3407,ENG-3400,ENG-3368,ENG-3360,ENG-3349,ENG-3344,ENG-3331,ENG-3223,ENG-3212,ENG-3168,ENG-3121,ENG-3085,ENG-3084,ENG-3078,ENG-3070,ENG-3068,ENG-3041,ENG-3027,ENG-2996,ENG-1948'
    ),
    n('jira_snapshot:2026-04-16T17:21:34Z', 'in_pr_review', '12'),
    s(
      'jira_snapshot:2026-04-16T17:21:34Z',
      'in_pr_review_tickets',
      'ENG-3294,ENG-3293,ENG-3233,ENG-3211,ENG-3210,ENG-3171,ENG-3167,ENG-2865,ENG-2574,ENG-1900,ENG-925,ENG-440'
    ),
    n('jira_snapshot:2026-04-16T17:21:34Z', 'in_design_review', '0'),
    s('jira_snapshot:2026-04-16T17:21:34Z', 'in_design_review_tickets', ''),
    n('jira_snapshot:2026-04-16T17:21:34Z', 'ready_for_qa', '1'),
    s('jira_snapshot:2026-04-16T17:21:34Z', 'ready_for_qa_tickets', 'ENG-3253'),
    n('jira_snapshot:2026-04-16T17:21:34Z', 'in_qa', '3'),
    s('jira_snapshot:2026-04-16T17:21:34Z', 'in_qa_tickets', 'ENG-3337,ENG-3252,ENG-2837'),
    n('jira_snapshot:2026-04-16T17:21:34Z', 'ready_for_acceptance', '3'),
    s(
      'jira_snapshot:2026-04-16T17:21:34Z',
      'ready_for_acceptance_tickets',
      'ENG-3314,ENG-3159,ENG-3158'
    ),
    n('jira_snapshot:2026-04-16T17:21:34Z', 'total_wip', '40'),
    n('jira_snapshot:2026-04-16T17:21:34Z', 'assignee_size', '10'),
  ]
);

addEntity(
  {
    id: 'jira_snapshot:2026-04-28T14:50:45Z',
    source_id: '2026-04-28T14:50:45Z',
    created_at: '2026-04-28T14:50:45Z',
    updated_at: '2026-04-28T14:50:45Z',
  },
  [
    s('jira_snapshot:2026-04-28T14:50:45Z', 'source', 'jira'),
    s('jira_snapshot:2026-04-28T14:50:45Z', 'type', 'wip_snapshot'),
    n('jira_snapshot:2026-04-28T14:50:45Z', 'in_progress', '8'),
    s(
      'jira_snapshot:2026-04-28T14:50:45Z',
      'in_progress_tickets',
      'ENG-3400,ENG-3372,ENG-3331,ENG-3323,ENG-3083,ENG-3070,ENG-898,ENG-440'
    ),
    n('jira_snapshot:2026-04-28T14:50:45Z', 'in_pr_review', '16'),
    s(
      'jira_snapshot:2026-04-28T14:50:45Z',
      'in_pr_review_tickets',
      'ENG-3336,ENG-3294,ENG-3293,ENG-3223,ENG-3212,ENG-3211,ENG-3210,ENG-3078,ENG-3077,ENG-2996,ENG-2865,ENG-2798,ENG-2698,ENG-1984,ENG-924,ENG-921'
    ),
    n('jira_snapshot:2026-04-28T14:50:45Z', 'in_design_review', '1'),
    s('jira_snapshot:2026-04-28T14:50:45Z', 'in_design_review_tickets', 'ENG-3350'),
    n('jira_snapshot:2026-04-28T14:50:45Z', 'ready_for_qa', '1'),
    s('jira_snapshot:2026-04-28T14:50:45Z', 'ready_for_qa_tickets', 'ENG-3349'),
    n('jira_snapshot:2026-04-28T14:50:45Z', 'in_qa', '1'),
    s('jira_snapshot:2026-04-28T14:50:45Z', 'in_qa_tickets', 'ENG-3437'),
    n('jira_snapshot:2026-04-28T14:50:45Z', 'ready_for_acceptance', '0'),
    s('jira_snapshot:2026-04-28T14:50:45Z', 'ready_for_acceptance_tickets', ''),
    n('jira_snapshot:2026-04-28T14:50:45Z', 'total_wip', '27'),
    n('jira_snapshot:2026-04-28T14:50:45Z', 'assignee_size', '10'),
  ]
);

addEntity(
  {
    id: 'jira_snapshot:2026-05-14T13:42:46Z',
    source_id: '2026-05-14T13:42:46Z',
    created_at: '2026-05-14T13:42:46Z',
    updated_at: '2026-05-14T13:42:46Z',
  },
  [
    s('jira_snapshot:2026-05-14T13:42:46Z', 'source', 'jira'),
    s('jira_snapshot:2026-05-14T13:42:46Z', 'type', 'wip_snapshot'),
    n('jira_snapshot:2026-05-14T13:42:46Z', 'in_progress', '9'),
    s(
      'jira_snapshot:2026-05-14T13:42:46Z',
      'in_progress_tickets',
      'ENG-3517,ENG-3512,ENG-3475,ENG-3443,ENG-3378,ENG-921,ENG-900,ENG-851,ENG-440'
    ),
    n('jira_snapshot:2026-05-14T13:42:46Z', 'in_pr_review', '13'),
    s(
      'jira_snapshot:2026-05-14T13:42:46Z',
      'in_pr_review_tickets',
      'ENG-3524,ENG-3523,ENG-3518,ENG-3472,ENG-3336,ENG-3331,ENG-3324,ENG-3294,ENG-3293,ENG-3083,ENG-3047,ENG-2865,ENG-899'
    ),
    n('jira_snapshot:2026-05-14T13:42:46Z', 'in_design_review', '0'),
    s('jira_snapshot:2026-05-14T13:42:46Z', 'in_design_review_tickets', ''),
    n('jira_snapshot:2026-05-14T13:42:46Z', 'ready_for_qa', '11'),
    s(
      'jira_snapshot:2026-05-14T13:42:46Z',
      'ready_for_qa_tickets',
      'ENG-3506,ENG-3430,ENG-3372,ENG-3350,ENG-3212,ENG-3211,ENG-3210,ENG-3078,ENG-3016,ENG-2698,ENG-898'
    ),
    n('jira_snapshot:2026-05-14T13:42:46Z', 'in_qa', '1'),
    s('jira_snapshot:2026-05-14T13:42:46Z', 'in_qa_tickets', 'ENG-2996'),
    n('jira_snapshot:2026-05-14T13:42:46Z', 'ready_for_acceptance', '2'),
    s('jira_snapshot:2026-05-14T13:42:46Z', 'ready_for_acceptance_tickets', 'ENG-3484,ENG-3070'),
    n('jira_snapshot:2026-05-14T13:42:46Z', 'total_wip', '36'),
    n('jira_snapshot:2026-05-14T13:42:46Z', 'assignee_size', '10'),
  ]
);

// --- Write Parquet files ---

const entitySchema = new ParquetSchema({
  id: { type: 'UTF8' },
  source_id: { type: 'UTF8' },
  created_at: { type: 'UTF8' },
  updated_at: { type: 'UTF8' },
});

const metadataSchema = new ParquetSchema({
  entity_id: { type: 'UTF8' },
  key: { type: 'UTF8' },
  value: { type: 'UTF8', optional: true },
  value_type: { type: 'UTF8' },
});

const dir = new URL('.', import.meta.url).pathname;

const entityWriter = await ParquetWriter.openFile(entitySchema, `${dir}/entities.parquet`);
for (const row of entityRows) {
  await entityWriter.appendRow(row);
}
await entityWriter.close();
console.log(`Wrote ${entityRows.length} rows → fixtures/entities.parquet`);

const metaWriter = await ParquetWriter.openFile(metadataSchema, `${dir}/entity_metadata.parquet`);
for (const row of metadataRows) {
  await metaWriter.appendRow(row);
}
await metaWriter.close();
console.log(`Wrote ${metadataRows.length} rows → fixtures/entity_metadata.parquet`);
