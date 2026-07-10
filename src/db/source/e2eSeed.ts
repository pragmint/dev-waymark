import type { SourceDataAdapter } from './adapter';

// Compact source dataset used only when running under DEV_WAYMARK_TEST_MODE=1.
// Mirrors the field shape of goldenSeed (string/number/date metadata on
// jira_ticket entities) at ~1/150th the size. Tests that paginate require
// jira_ticket count > 20 so page=3 stays valid. A handful of github_pr rows
// exist so the entity_type filter has more than one distinct value.

type EntityRow = { id: number; name: string; type: string };
type MetaRow = { entity_id: number; key: string; value: string | null; value_type: string };

function s(entity_id: number, key: string, value: string): MetaRow {
  return { entity_id, key, value, value_type: 'string' };
}
function n(entity_id: number, key: string, value: string): MetaRow {
  return { entity_id, key, value, value_type: 'number' };
}
function d(entity_id: number, key: string, value: string): MetaRow {
  return { entity_id, key, value, value_type: 'date' };
}
function l(entity_id: number, key: string, value: string): MetaRow {
  return { entity_id, key, value, value_type: 'list' };
}

const TICKET_TYPES = ['Story', 'Bug', 'Task', 'Spike'];
const PRIORITIES = ['Low', 'Medium', 'High'];
const ASSIGNEES = ['dev-001', 'dev-002', 'dev-003'];

const entities: EntityRow[] = [];
const metadata: MetaRow[] = [];

function isoDate(dayOffset: number): string {
  // Deterministic ISO timestamps: 2024-01-01 + N days. Avoids `new Date()`
  // which would make the seed non-deterministic across runs.
  const originDay = Date.UTC(2024, 0, 1) / 86_400_000;
  const ms = (originDay + dayOffset) * 86_400_000;
  return new Date(ms).toISOString();
}

// 25 jira_ticket rows — enough for pagination's page=3 (per_page=10) and rich
// enough metadata for all six visualization templates.
for (let i = 1; i <= 25; i++) {
  entities.push({ id: i, name: `TH-${String(i).padStart(4, '0')}`, type: 'jira_ticket' });
  const createdDay = i;
  const inProgressDay = createdDay + 1;
  const doneDay = createdDay + 3 + (i % 5);
  metadata.push(
    s(i, 'ticket_type', TICKET_TYPES[i % TICKET_TYPES.length]),
    s(i, 'priority', PRIORITIES[i % PRIORITIES.length]),
    s(i, 'assignee', ASSIGNEES[i % ASSIGNEES.length]),
    n(i, 'iteration', String(i % 4)),
    n(i, 'gh_prs_merged', String(1 + (i % 3))),
    n(i, 'total_lead_time_seconds', String(50_000 + i * 1_000)),
    d(i, 'jira_created_at', isoDate(createdDay)),
    d(i, 'jira_in_progress_at', isoDate(inProgressDay)),
    d(i, 'jira_done_at', isoDate(doneDay))
  );
}

// github_pr rows — enough distinct creators (>20) that the default
// distinctValues cap excludes them from the initial page render. The filter
// editor must lift that cap when it loads "values available with this filter
// disabled", so this seed exercises that path realistically.
const PR_COUNT = 25;
for (let i = 26; i <= 25 + PR_COUNT; i++) {
  entities.push({ id: i, name: `PR-${String(i - 25).padStart(4, '0')}`, type: 'github_pr' });
  metadata.push(
    s(i, 'pr_state', i % 2 === 0 ? 'merged' : 'closed'),
    s(i, 'creator', `dev-${String(i - 25).padStart(3, '0')}`),
    n(i, 'additions', String(50 + i * 10)),
    d(i, 'pr_created_at', isoDate(i)),
    d(i, 'pr_merged_at', isoDate(i + 2)),
    l(
      i,
      'jira_tickets',
      `TH-${String(i - 25).padStart(4, '0')}|TH-${String(i - 24).padStart(4, '0')}`
    )
  );
}

export async function seedE2EData(adapter: SourceDataAdapter): Promise<void> {
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
