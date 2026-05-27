import type { SourceDataAdapter } from './adapter';

/**
 * Golden dataset — seeded automatically into in-memory SQLite source databases.
 *
 * Contains representative engineering data covering three entity types:
 *   - Jira tickets (story, bug, task) with lead-time breakdowns
 *   - GitHub PRs (feature, chore, release) with review metrics
 *   - WIP snapshots for board-trend analysis
 *
 * This data is the sole replacement for the old Parquet fixture pipeline.
 * External source databases are assumed to be pre-populated; this seed only
 * runs when no source database is configured (the in-memory default).
 */

type EntityRow = { id: number; name: string; type: string };
type MetaRow = { entity_id: number; key: string; value: string | null; value_type: string };

function s(entity_id: number, key: string, value: string): MetaRow {
  return { entity_id, key, value, value_type: 'string' };
}
function n(entity_id: number, key: string, value: string): MetaRow {
  return { entity_id, key, value, value_type: 'number' };
}
function d(entity_id: number, key: string, value: string | null): MetaRow {
  return { entity_id, key, value, value_type: 'date' };
}

const entities: EntityRow[] = [];
const metadata: MetaRow[] = [];

function add(entity: EntityRow, meta: MetaRow[]): void {
  entities.push(entity);
  metadata.push(...meta);
}

// ── Jira tickets ─────────────────────────────────────────────────────────────

add({ id: 1, name: 'jira:ENG-2', type: 'jira_ticket' }, [
  s(1, 'source', 'jira'),
  s(1, 'ticket_type', 'Story'),
  s(1, 'priority', 'Medium'),
  s(1, 'assignee', 'Alex Rivera'),
  s(1, 'gh_author', 'arivera'),
  d(1, 'jira_created_at', '2024-12-19T16:25:28Z'),
  d(1, 'jira_in_progress_at', '2024-12-19T16:26:11Z'),
  d(1, 'gh_first_commit_at', '2024-12-24T14:16:42Z'),
  d(1, 'gh_first_pr_created_at', '2024-12-26T13:23:11Z'),
  d(1, 'gh_last_pr_merged_at', '2024-12-26T13:33:17Z'),
  d(1, 'gh_last_pr_merged_to_main_at', '2025-01-22T21:32:07Z'),
  d(1, 'jira_done_at', '2024-12-26T13:24:01Z'),
  d(1, 'computed_completed_at', '2025-01-22T21:32:07Z'),
  n(1, 'gh_prs_merged', '1'),
  n(1, 'gh_prs_closed', '0'),
  n(1, 'gh_prs_open', '0'),
  n(1, 'total_lead_time_seconds', '2955999'),
  n(1, 'grooming_lead_time_seconds', '43'),
  n(1, 'queued_for_dev_lead_time_seconds', '0'),
  n(1, 'development_lead_time_seconds', '593820'),
  n(1, 'review_lead_time_seconds', '2362136'),
  n(1, 'quality_inspection_seconds', '0'),
  n(1, 'release_seconds', '0'),
]);

add({ id: 2, name: 'jira:ENG-7', type: 'jira_ticket' }, [
  s(2, 'source', 'jira'),
  s(2, 'ticket_type', 'Story'),
  s(2, 'priority', 'Medium'),
  s(2, 'assignee', 'Alex Rivera'),
  s(2, 'gh_author', 'arivera'),
  d(2, 'jira_created_at', '2024-12-19T17:02:00Z'),
  d(2, 'jira_in_progress_at', '2024-12-19T17:02:11Z'),
  d(2, 'gh_first_commit_at', '2025-01-02T13:11:54Z'),
  d(2, 'gh_first_pr_created_at', '2025-01-02T13:12:32Z'),
  d(2, 'gh_last_pr_merged_at', '2025-01-02T13:13:00Z'),
  d(2, 'gh_last_pr_merged_to_main_at', '2025-01-22T21:32:07Z'),
  d(2, 'jira_done_at', '2025-01-23T13:25:18Z'),
  d(2, 'computed_completed_at', '2025-01-23T13:25:18Z'),
  n(2, 'gh_prs_merged', '1'),
  n(2, 'gh_prs_closed', '0'),
  n(2, 'gh_prs_open', '0'),
  n(2, 'total_lead_time_seconds', '3010998'),
  n(2, 'grooming_lead_time_seconds', '11'),
  n(2, 'queued_for_dev_lead_time_seconds', '0'),
  n(2, 'development_lead_time_seconds', '1195821'),
  n(2, 'review_lead_time_seconds', '1815166'),
  n(2, 'quality_inspection_seconds', '0'),
  n(2, 'release_seconds', '0'),
]);

// Bug with Highest priority and long lead time — good edge case for outlier detection
add({ id: 3, name: 'jira:OPS-15', type: 'jira_ticket' }, [
  s(3, 'source', 'jira'),
  s(3, 'ticket_type', 'Bug'),
  s(3, 'priority', 'Highest'),
  s(3, 'assignee', 'Priya Sharma'),
  s(3, 'gh_author', 'psharma'),
  d(3, 'jira_created_at', '2024-08-01T11:17:44Z'),
  d(3, 'jira_todo_at', '2024-11-27T14:12:46Z'),
  d(3, 'jira_in_progress_at', '2024-10-25T15:50:37Z'),
  d(3, 'gh_first_commit_at', '2025-01-28T20:28:35Z'),
  d(3, 'gh_first_pr_created_at', '2025-01-28T20:34:43Z'),
  d(3, 'gh_last_ready_at', '2025-02-05T19:08:52Z'),
  d(3, 'gh_last_review_at', '2025-02-05T19:13:19Z'),
  d(3, 'quality_inspection_at', '2025-01-09T16:27:58Z'),
  d(3, 'ready_for_release_at', '2025-01-28T16:41:09Z'),
  d(3, 'gh_last_pr_merged_at', '2025-02-05T19:22:33Z'),
  d(3, 'gh_last_pr_closed_at', '2025-05-12T16:26:16Z'),
  d(3, 'jira_done_at', '2025-01-10T18:58:00Z'),
  d(3, 'computed_completed_at', '2025-05-12T16:26:16Z'),
  n(3, 'gh_prs_merged', '2'),
  n(3, 'gh_prs_closed', '2'),
  n(3, 'gh_prs_open', '0'),
  n(3, 'total_lead_time_seconds', '24556112'),
  n(3, 'grooming_lead_time_seconds', '7360373'),
  n(3, 'queued_for_dev_lead_time_seconds', '0'),
  n(3, 'development_lead_time_seconds', '8911095'),
  n(3, 'review_lead_time_seconds', '267'),
  n(3, 'quality_inspection_seconds', '0'),
  n(3, 'release_seconds', '8284377'),
]);

// Story with linked PR github:1029
add({ id: 4, name: 'jira:ENG-3349', type: 'jira_ticket' }, [
  s(4, 'source', 'jira'),
  s(4, 'ticket_type', 'Story'),
  s(4, 'priority', 'Medium'),
  s(4, 'assignee', 'Jordan Kim'),
  s(4, 'gh_author', 'jkim'),
  d(4, 'jira_created_at', '2026-04-02T15:38:13Z'),
  d(4, 'jira_todo_at', '2026-04-07T19:40:14Z'),
  d(4, 'jira_in_progress_at', '2026-04-14T15:59:58Z'),
  d(4, 'gh_first_commit_at', '2026-04-21T14:20:37Z'),
  d(4, 'gh_first_pr_created_at', '2026-04-21T15:03:27Z'),
  d(4, 'gh_last_ready_at', '2026-04-21T15:03:27Z'),
  d(4, 'gh_last_review_at', '2026-04-23T15:27:29Z'),
  d(4, 'quality_inspection_at', '2026-04-24T15:15:58Z'),
  d(4, 'ready_for_release_at', '2026-05-07T17:51:37Z'),
  d(4, 'gh_last_pr_merged_at', '2026-05-07T21:30:49Z'),
  d(4, 'jira_done_at', null),
  d(4, 'computed_completed_at', null),
  n(4, 'gh_prs_merged', '1'),
  n(4, 'gh_prs_closed', '0'),
  n(4, 'gh_prs_open', '0'),
  n(4, 'total_lead_time_seconds', '3150142'),
  n(4, 'grooming_lead_time_seconds', '446521'),
  n(4, 'queued_for_dev_lead_time_seconds', '591584'),
  n(4, 'development_lead_time_seconds', '601409'),
  n(4, 'review_lead_time_seconds', '259951'),
  n(4, 'quality_inspection_seconds', '1132539'),
  n(4, 'release_seconds', '118138'),
]);

// Task with linked PR github:1026 — fast turnaround example
add({ id: 5, name: 'jira:ENG-3411', type: 'jira_ticket' }, [
  s(5, 'source', 'jira'),
  s(5, 'ticket_type', 'Task'),
  s(5, 'priority', 'Medium'),
  s(5, 'assignee', 'Sam Chen'),
  s(5, 'gh_author', 'schen'),
  d(5, 'jira_created_at', '2026-04-15T18:25:15Z'),
  d(5, 'jira_todo_at', '2026-04-20T15:11:14Z'),
  d(5, 'jira_in_progress_at', '2026-04-20T16:00:25Z'),
  d(5, 'gh_first_commit_at', '2026-04-20T16:16:59Z'),
  d(5, 'gh_first_pr_created_at', '2026-04-20T16:18:26Z'),
  d(5, 'gh_last_ready_at', '2026-04-20T16:18:26Z'),
  d(5, 'gh_last_review_at', '2026-04-21T16:08:02Z'),
  d(5, 'quality_inspection_at', '2026-04-22T14:35:00Z'),
  d(5, 'ready_for_release_at', '2026-04-23T16:43:52Z'),
  d(5, 'gh_last_pr_merged_at', '2026-04-23T17:32:02Z'),
  d(5, 'gh_last_pr_merged_to_main_at', '2026-04-24T15:31:06Z'),
  d(5, 'jira_done_at', '2026-04-24T19:22:53Z'),
  d(5, 'computed_completed_at', '2026-04-24T19:22:53Z'),
  n(5, 'gh_prs_merged', '1'),
  n(5, 'gh_prs_closed', '0'),
  n(5, 'gh_prs_open', '0'),
  n(5, 'total_lead_time_seconds', '781058'),
  n(5, 'grooming_lead_time_seconds', '420359'),
  n(5, 'queued_for_dev_lead_time_seconds', '2951'),
  n(5, 'development_lead_time_seconds', '1081'),
  n(5, 'review_lead_time_seconds', '166594'),
  n(5, 'quality_inspection_seconds', '94132'),
  n(5, 'release_seconds', '95941'),
]);

// ── GitHub PRs ───────────────────────────────────────────────────────────────

// Feature PR linked to ENG-3349
add({ id: 6, name: 'github:1029', type: 'github_pr' }, [
  s(6, 'source', 'github'),
  s(6, 'repo', 'acme-corp/web-platform'),
  s(6, 'creator', 'jkim'),
  s(6, 'branch', 'feature/ENG-3349'),
  s(6, 'target_branch', 'release'),
  s(6, 'title', 'ENG-3349: Add rate limiting to booking confirmation flow'),
  s(6, 'jira_ticket', 'ENG-3349'),
  s(6, 'state', 'MERGED'),
  s(6, 'first_reviewer', 'schen'),
  s(6, 'last_reviewer', 'twright'),
  d(6, 'first_commit_at', '2026-04-21T14:20:37Z'),
  d(6, 'created_at', '2026-04-21T15:03:27Z'),
  d(6, 'ready_for_review_at', '2026-04-21T15:03:27Z'),
  d(6, 'last_ready_at', '2026-04-21T15:03:27Z'),
  d(6, 'first_review_at', '2026-04-21T16:03:17Z'),
  d(6, 'last_review_at', '2026-04-23T15:27:29Z'),
  d(6, 'resolved_at', '2026-05-07T21:30:49Z'),
  d(6, 'merged_to_main_at', null),
  n(6, 'first_commit_to_pr_seconds', '2570'),
  n(6, 'lines_changed', '301'),
  n(6, 'times_set_to_draft', '0'),
  n(6, 'time_in_draft_before_first_review_seconds', '0'),
  n(6, 'first_review_wait_seconds', '3590'),
  n(6, 'worded_comment_count', '1'),
  n(6, 'review_count', '2'),
  n(6, 'all_time_in_draft_seconds', '0'),
  n(6, 'last_review_wait_seconds', '174242'),
  n(6, 'last_review_to_resolution_seconds', '1231400'),
]);

// Chore PR — no linked ticket, tiny diff, very fast review
add({ id: 7, name: 'github:1028', type: 'github_pr' }, [
  s(7, 'source', 'github'),
  s(7, 'repo', 'acme-corp/web-platform'),
  s(7, 'creator', 'schen'),
  s(7, 'branch', 'chore/bump-v2.1.5'),
  s(7, 'target_branch', 'release'),
  s(7, 'title', 'chore: version bump to v2.1.5'),
  s(7, 'jira_ticket', ''),
  s(7, 'state', 'MERGED'),
  s(7, 'first_reviewer', 'jkim'),
  s(7, 'last_reviewer', 'mlopez'),
  d(7, 'first_commit_at', '2026-04-21T14:51:23Z'),
  d(7, 'created_at', '2026-04-21T14:54:33Z'),
  d(7, 'ready_for_review_at', '2026-04-21T14:54:33Z'),
  d(7, 'last_ready_at', '2026-04-21T14:54:33Z'),
  d(7, 'first_review_at', '2026-04-21T14:57:00Z'),
  d(7, 'last_review_at', '2026-04-21T14:57:15Z'),
  d(7, 'resolved_at', '2026-04-21T15:02:47Z'),
  d(7, 'merged_to_main_at', '2026-04-24T15:31:06Z'),
  n(7, 'first_commit_to_pr_seconds', '190'),
  n(7, 'lines_changed', '6'),
  n(7, 'times_set_to_draft', '0'),
  n(7, 'time_in_draft_before_first_review_seconds', '0'),
  n(7, 'first_review_wait_seconds', '147'),
  n(7, 'worded_comment_count', '0'),
  n(7, 'review_count', '2'),
  n(7, 'all_time_in_draft_seconds', '0'),
  n(7, 'last_review_wait_seconds', '162'),
  n(7, 'last_review_to_resolution_seconds', '332'),
  n(7, 'merge_to_main_seconds', '260899'),
]);

// Release PR — no ticket, large diff (accumulated sprint work)
add({ id: 8, name: 'github:1027', type: 'github_pr' }, [
  s(8, 'source', 'github'),
  s(8, 'repo', 'acme-corp/web-platform'),
  s(8, 'creator', 'mlopez'),
  s(8, 'branch', 'release'),
  s(8, 'target_branch', 'main'),
  s(8, 'title', 'Release'),
  s(8, 'jira_ticket', ''),
  s(8, 'state', 'MERGED'),
  s(8, 'first_reviewer', 'arivera'),
  s(8, 'last_reviewer', 'dlee'),
  d(8, 'first_commit_at', '2026-04-17T20:05:13Z'),
  d(8, 'created_at', '2026-04-21T14:17:39Z'),
  d(8, 'ready_for_review_at', '2026-04-21T14:17:39Z'),
  d(8, 'last_ready_at', '2026-04-21T14:17:39Z'),
  d(8, 'first_review_at', '2026-04-21T14:23:52Z'),
  d(8, 'last_review_at', '2026-04-21T14:24:42Z'),
  d(8, 'resolved_at', '2026-04-21T14:36:56Z'),
  d(8, 'merged_to_main_at', '2026-04-21T14:36:56Z'),
  n(8, 'first_commit_to_pr_seconds', '324746'),
  n(8, 'lines_changed', '1959'),
  n(8, 'times_set_to_draft', '0'),
  n(8, 'time_in_draft_before_first_review_seconds', '0'),
  n(8, 'first_review_wait_seconds', '373'),
  n(8, 'worded_comment_count', '5'),
  n(8, 'review_count', '3'),
  n(8, 'all_time_in_draft_seconds', '0'),
  n(8, 'last_review_wait_seconds', '423'),
  n(8, 'last_review_to_resolution_seconds', '734'),
  n(8, 'merge_to_main_seconds', '0'),
]);

// Data update PR linked to ENG-3411 — fast cycle time from commit to merge
add({ id: 9, name: 'github:1026', type: 'github_pr' }, [
  s(9, 'source', 'github'),
  s(9, 'repo', 'acme-corp/web-platform'),
  s(9, 'creator', 'schen'),
  s(9, 'branch', 'chore/ENG-3411/q2-pricing-data-refresh'),
  s(9, 'target_branch', 'release'),
  s(9, 'title', 'ENG-3411: refresh Q2 pricing reference data'),
  s(9, 'jira_ticket', 'ENG-3411'),
  s(9, 'state', 'MERGED'),
  s(9, 'first_reviewer', 'jkim'),
  s(9, 'last_reviewer', 'mlopez'),
  d(9, 'first_commit_at', '2026-04-20T16:16:59Z'),
  d(9, 'created_at', '2026-04-20T16:18:26Z'),
  d(9, 'ready_for_review_at', '2026-04-20T16:18:26Z'),
  d(9, 'last_ready_at', '2026-04-20T16:18:26Z'),
  d(9, 'first_review_at', '2026-04-20T16:19:24Z'),
  d(9, 'last_review_at', '2026-04-21T16:08:02Z'),
  d(9, 'resolved_at', '2026-04-23T17:32:02Z'),
  d(9, 'merged_to_main_at', '2026-04-24T15:31:06Z'),
  n(9, 'first_commit_to_pr_seconds', '87'),
  n(9, 'lines_changed', '293'),
  n(9, 'times_set_to_draft', '0'),
  n(9, 'time_in_draft_before_first_review_seconds', '0'),
  n(9, 'first_review_wait_seconds', '58'),
  n(9, 'worded_comment_count', '2'),
  n(9, 'review_count', '2'),
  n(9, 'all_time_in_draft_seconds', '0'),
  n(9, 'last_review_wait_seconds', '85776'),
  n(9, 'last_review_to_resolution_seconds', '177840'),
  n(9, 'merge_to_main_seconds', '79144'),
]);

// ── WIP snapshots ─────────────────────────────────────────────────────────────

add({ id: 10, name: 'jira_snapshot:2026-04-16T17:21:34Z', type: 'wip_snapshot' }, [
  s(10, 'source', 'jira'),
  n(10, 'in_progress', '21'),
  s(
    10,
    'in_progress_tickets',
    'ENG-3415,ENG-3407,ENG-3400,ENG-3368,ENG-3360,ENG-3349,ENG-3344,ENG-3331,ENG-3223,ENG-3212,ENG-3168,ENG-3121,ENG-3085,ENG-3084,ENG-3078,ENG-3070,ENG-3068,ENG-3041,ENG-3027,ENG-2996,ENG-1948'
  ),
  n(10, 'in_pr_review', '12'),
  s(
    10,
    'in_pr_review_tickets',
    'ENG-3294,ENG-3293,ENG-3233,ENG-3211,ENG-3210,ENG-3171,ENG-3167,ENG-2865,ENG-2574,ENG-1900,ENG-925,ENG-440'
  ),
  n(10, 'in_design_review', '0'),
  s(10, 'in_design_review_tickets', ''),
  n(10, 'ready_for_qa', '1'),
  s(10, 'ready_for_qa_tickets', 'ENG-3253'),
  n(10, 'in_qa', '3'),
  s(10, 'in_qa_tickets', 'ENG-3337,ENG-3252,ENG-2837'),
  n(10, 'ready_for_acceptance', '3'),
  s(10, 'ready_for_acceptance_tickets', 'ENG-3314,ENG-3159,ENG-3158'),
  n(10, 'total_wip', '40'),
  n(10, 'assignee_size', '10'),
]);

add({ id: 11, name: 'jira_snapshot:2026-04-28T14:50:45Z', type: 'wip_snapshot' }, [
  s(11, 'source', 'jira'),
  n(11, 'in_progress', '8'),
  s(
    11,
    'in_progress_tickets',
    'ENG-3400,ENG-3372,ENG-3331,ENG-3323,ENG-3083,ENG-3070,ENG-898,ENG-440'
  ),
  n(11, 'in_pr_review', '16'),
  s(
    11,
    'in_pr_review_tickets',
    'ENG-3336,ENG-3294,ENG-3293,ENG-3223,ENG-3212,ENG-3211,ENG-3210,ENG-3078,ENG-3077,ENG-2996,ENG-2865,ENG-2798,ENG-2698,ENG-1984,ENG-924,ENG-921'
  ),
  n(11, 'in_design_review', '1'),
  s(11, 'in_design_review_tickets', 'ENG-3350'),
  n(11, 'ready_for_qa', '1'),
  s(11, 'ready_for_qa_tickets', 'ENG-3349'),
  n(11, 'in_qa', '1'),
  s(11, 'in_qa_tickets', 'ENG-3437'),
  n(11, 'ready_for_acceptance', '0'),
  s(11, 'ready_for_acceptance_tickets', ''),
  n(11, 'total_wip', '27'),
  n(11, 'assignee_size', '10'),
]);

add({ id: 12, name: 'jira_snapshot:2026-05-14T13:42:46Z', type: 'wip_snapshot' }, [
  s(12, 'source', 'jira'),
  n(12, 'in_progress', '9'),
  s(
    12,
    'in_progress_tickets',
    'ENG-3517,ENG-3512,ENG-3475,ENG-3443,ENG-3378,ENG-921,ENG-900,ENG-851,ENG-440'
  ),
  n(12, 'in_pr_review', '13'),
  s(
    12,
    'in_pr_review_tickets',
    'ENG-3524,ENG-3523,ENG-3518,ENG-3472,ENG-3336,ENG-3331,ENG-3324,ENG-3294,ENG-3293,ENG-3083,ENG-3047,ENG-2865,ENG-899'
  ),
  n(12, 'in_design_review', '0'),
  s(12, 'in_design_review_tickets', ''),
  n(12, 'ready_for_qa', '11'),
  s(
    12,
    'ready_for_qa_tickets',
    'ENG-3506,ENG-3430,ENG-3372,ENG-3350,ENG-3212,ENG-3211,ENG-3210,ENG-3078,ENG-3016,ENG-2698,ENG-898'
  ),
  n(12, 'in_qa', '1'),
  s(12, 'in_qa_tickets', 'ENG-2996'),
  n(12, 'ready_for_acceptance', '2'),
  s(12, 'ready_for_acceptance_tickets', 'ENG-3484,ENG-3070'),
  n(12, 'total_wip', '36'),
  n(12, 'assignee_size', '10'),
]);

export async function seedGoldenData(adapter: SourceDataAdapter): Promise<void> {
  for (const e of entities) {
    await adapter.execute(
      'INSERT INTO entities (id, name, type) VALUES (?, ?, ?) ON CONFLICT(id) DO UPDATE SET name = excluded.name, type = excluded.type',
      [e.id, e.name, e.type]
    );
  }
  for (const m of metadata) {
    await adapter.execute(
      'INSERT INTO entity_metadata (entity_id, key, value, value_type) VALUES (?, ?, ?, ?) ON CONFLICT(entity_id, key) DO UPDATE SET value = excluded.value, value_type = excluded.value_type',
      [m.entity_id, m.key, m.value, m.value_type]
    );
  }
}
