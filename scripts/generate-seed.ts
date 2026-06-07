/**
 * Generator script: reads obfuscated CSV files and writes goldenSeed.ts
 * Run with: bun scripts/generate-seed.ts
 */

import { readFileSync, writeFileSync } from 'fs';
import { join } from 'path';

const CSV_DIR = '/Users/cuvulgio/Projects/lsh/engineering-excellence/scripts/obfuscated';
const OUT_PATH = join(import.meta.dir, '..', 'src', 'db', 'source', 'goldenSeed.ts');

// ── CSV parsing ───────────────────────────────────────────────────────────────

function parseCSV(filePath: string): Record<string, string>[] {
  const text = readFileSync(filePath, 'utf8');
  const lines = text.split('\n').filter(l => l.trim());
  if (lines.length < 2) return [];

  const headers = parseCSVLine(lines[0]);
  return lines
    .slice(1)
    .map(line => {
      const values = parseCSVLine(line);
      const row: Record<string, string> = {};
      headers.forEach((h, i) => {
        row[h] = values[i] ?? '';
      });
      return row;
    })
    .filter(row => Object.values(row).some(v => v !== ''));
}

function parseCSVLine(line: string): string[] {
  const result: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (ch === ',' && !inQuotes) {
      result.push(current);
      current = '';
    } else {
      current += ch;
    }
  }
  result.push(current);
  return result;
}

// ── Value-type detection ──────────────────────────────────────────────────────

const DATE_COLUMNS = new Set([
  'timestamp',
  'work_in_progress_as_of',
  'jira_created_at',
  'iteration_start_at',
  'jira_todo_at',
  'jira_in_progress_at',
  'gh_first_commit_at',
  'gh_first_pr_created_at',
  'gh_last_ready_at',
  'gh_last_review_at',
  'quality_inspection_at',
  'ready_for_release_at',
  'gh_last_pr_merged_at',
  'gh_last_pr_merged_to_main_at',
  'gh_last_pr_closed_at',
  'iteration_done_at',
  'jira_done_at',
  'computed_completed_at',
  'first_commit_at',
  'created_at',
  'ready_for_review_at',
  'last_ready_at',
  'first_review_at',
  'last_review_at',
  'resolved_at',
  'merged_to_main_at',
]);

const NUMBER_COLUMNS = new Set([
  'iteration',
  'gh_prs_merged',
  'gh_prs_closed',
  'gh_prs_open',
  'total_lead_time_seconds',
  'unaccounted_time_seconds',
  'seconds_between_last_iteration',
  'grooming_lead_time_seconds',
  'queued_for_dev_lead_time_seconds',
  'development_lead_time_seconds',
  'dev_qi_cowork_seconds',
  'review_lead_time_seconds',
  'quality_inspection_seconds',
  'release_seconds',
  'pr_number',
  'first_commit_to_pr_seconds',
  'lines_changed',
  'times_set_to_draft',
  'time_in_draft_before_first_review_seconds',
  'first_review_wait_seconds',
  'worded_comment_count',
  'review_count',
  'all_time_in_draft_seconds',
  'last_review_wait_seconds',
  'last_review_to_resolution_seconds',
  'merge_to_main_seconds',
  'graveyard_seconds',
  'unaccounted_seconds',
  'in_progress',
  'in_pr_review',
  'in_design_review',
  'ready_for_qa',
  'in_qa',
  'ready_for_acceptance',
  'ready_for_product_acceptance',
  'ready_for_production',
  'blocked',
  'total_wip',
  'assignee_size',
]);

function valueType(col: string): 'date' | 'number' | 'string' {
  if (DATE_COLUMNS.has(col)) return 'date';
  if (NUMBER_COLUMNS.has(col)) return 'number';
  return 'string';
}

// ── Code generation ───────────────────────────────────────────────────────────

interface EntityEntry {
  name: string;
  type: string;
  meta: Array<{ key: string; value: string | null; vt: 'date' | 'number' | 'string' }>;
}

const entries: EntityEntry[] = [];

function escapeStr(v: string): string {
  return v.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

function addLeadTime(rows: Record<string, string>[]): void {
  for (const row of rows) {
    const name = row['ticket'];
    if (!name) continue;

    const meta: EntityEntry['meta'] = [];
    for (const [col, val] of Object.entries(row)) {
      if (col === 'ticket') continue;
      const vt = valueType(col);
      const value = val === '' ? null : val;
      if (vt !== 'date' && value === null) continue; // skip empty non-date fields
      meta.push({ key: col, value, vt });
    }
    entries.push({ name, type: 'jira_ticket', meta });
  }
}

function addPRComplexity(rows: Record<string, string>[]): void {
  for (const row of rows) {
    const repo = row['repo'];
    const prNum = row['pr_number'];
    if (!repo || !prNum) continue;

    const name = `${repo}/${prNum}`;
    const meta: EntityEntry['meta'] = [];
    for (const [col, val] of Object.entries(row)) {
      // Both repo and pr_number are used to form the name (combined), so include them as MetaRows
      const vt = valueType(col);
      const value = val === '' ? null : val;
      if (vt !== 'date' && value === null) continue;
      meta.push({ key: col, value, vt });
    }
    entries.push({ name, type: 'github_pr', meta });
  }
}

function addWIP(rows: Record<string, string>[]): void {
  for (const row of rows) {
    const ts = row['timestamp'];
    if (!ts) continue;

    const name = ts; // full timestamp IS the date
    const meta: EntityEntry['meta'] = [];
    for (const [col, val] of Object.entries(row)) {
      if (col === 'timestamp') continue; // entity name is word-for-word the timestamp
      const vt = valueType(col);
      const value = val === '' ? null : val;
      if (vt !== 'date' && value === null) continue;
      meta.push({ key: col, value, vt });
    }
    entries.push({ name, type: 'wip_snapshot', meta });
  }
}

// ── Load all CSV files ────────────────────────────────────────────────────────

const LEAD_TIME_FILES = [
  'lead_time_cm.csv',
  'lead_time_cobe.csv',
  'lead_time_infra.csv',
  'lead_time_lh.csv',
  'lead_time_pris.csv',
  'lead_time_sf.csv',
  'lead_time_web.csv',
];

const PR_COMPLEXITY_FILES = [
  'pr-complexity-cm.csv',
  'pr-complexity-cobe.csv',
  'pr-complexity-infra.csv',
  'pr-complexity-lh.csv',
  'pr-complexity-prism.csv',
  'pr-complexity-sf.csv',
  'pr-complexity-web.csv',
];

const WIP_FILES = ['wip_cm.csv', 'wip_cobe.csv', 'wip_pris.csv', 'wip_pris_sprint.csv'];

for (const f of LEAD_TIME_FILES) {
  addLeadTime(parseCSV(join(CSV_DIR, f)));
}
for (const f of PR_COMPLEXITY_FILES) {
  addPRComplexity(parseCSV(join(CSV_DIR, f)));
}
for (const f of WIP_FILES) {
  addWIP(parseCSV(join(CSV_DIR, f)));
}

// De-duplicate by entity name (keep first occurrence)
const seen = new Set<string>();
const deduped = entries.filter(e => {
  if (seen.has(e.name)) return false;
  seen.add(e.name);
  return true;
});

console.log(`Entities: ${deduped.length} (${entries.length - deduped.length} duplicates removed)`);
console.log(`  jira_ticket: ${deduped.filter(e => e.type === 'jira_ticket').length}`);
console.log(`  github_pr:   ${deduped.filter(e => e.type === 'github_pr').length}`);
console.log(`  wip_snapshot:${deduped.filter(e => e.type === 'wip_snapshot').length}`);

// ── Emit TypeScript ───────────────────────────────────────────────────────────

const lines: string[] = [];

lines.push(`import type { SourceDataAdapter } from './adapter';`);
lines.push('');
lines.push(`type EntityRow = { id: number; name: string; type: string };`);
lines.push(
  `type MetaRow = { entity_id: number; key: string; value: string | null; value_type: string };`
);
lines.push('');
lines.push(`function s(entity_id: number, key: string, value: string): MetaRow {`);
lines.push(`  return { entity_id, key, value, value_type: 'string' };`);
lines.push(`}`);
lines.push(`function n(entity_id: number, key: string, value: string): MetaRow {`);
lines.push(`  return { entity_id, key, value, value_type: 'number' };`);
lines.push(`}`);
lines.push(`function d(entity_id: number, key: string, value: string | null): MetaRow {`);
lines.push(`  return { entity_id, key, value, value_type: 'date' };`);
lines.push(`}`);
lines.push('');
lines.push(`const entities: EntityRow[] = [];`);
lines.push(`const metadata: MetaRow[] = [];`);
lines.push('');
lines.push(`function add(entity: EntityRow, meta: MetaRow[]): void {`);
lines.push(`  entities.push(entity);`);
lines.push(`  metadata.push(...meta);`);
lines.push(`}`);
lines.push('');

// Group by type for section headers
const jiraTickets = deduped.filter(e => e.type === 'jira_ticket');
const githubPRs = deduped.filter(e => e.type === 'github_pr');
const wipSnapshots = deduped.filter(e => e.type === 'wip_snapshot');

function emitSection(
  sectionEntries: EntityEntry[],
  startId: number,
  sectionComment: string
): number {
  lines.push(`// ── ${sectionComment} ${'─'.repeat(Math.max(0, 75 - sectionComment.length))}`);
  lines.push('');
  let id = startId;
  for (const e of sectionEntries) {
    const metaLines = e.meta.map(m => {
      const fn = m.vt === 'date' ? 'd' : m.vt === 'number' ? 'n' : 's';
      const valStr = m.value === null ? 'null' : `'${escapeStr(m.value)}'`;
      return `  ${fn}(${id}, '${m.key}', ${valStr}),`;
    });
    lines.push(`add({ id: ${id}, name: '${escapeStr(e.name)}', type: '${e.type}' }, [`);
    lines.push(...metaLines);
    lines.push(`]);`);
    lines.push('');
    id++;
  }
  return id;
}

let nextId = 1;
nextId = emitSection(jiraTickets, nextId, 'Jira tickets');
nextId = emitSection(githubPRs, nextId, 'GitHub PRs');
emitSection(wipSnapshots, nextId, 'WIP snapshots');

lines.push(`export async function seedGoldenData(adapter: SourceDataAdapter): Promise<void> {`);
lines.push(`  for (const e of entities) {`);
lines.push(`    await adapter.execute(`);
lines.push(
  `      'INSERT INTO entities (id, name, type) VALUES (?, ?, ?) ON CONFLICT(id) DO UPDATE SET name = excluded.name, type = excluded.type',`
);
lines.push(`      [e.id, e.name, e.type]`);
lines.push(`    );`);
lines.push(`  }`);
lines.push(`  for (const m of metadata) {`);
lines.push(`    await adapter.execute(`);
lines.push(
  `      'INSERT INTO entity_metadata (entity_id, key, value, value_type) VALUES (?, ?, ?, ?) ON CONFLICT(entity_id, key) DO UPDATE SET value = excluded.value, value_type = excluded.value_type',`
);
lines.push(`      [m.entity_id, m.key, m.value, m.value_type]`);
lines.push(`    );`);
lines.push(`  }`);
lines.push(`}`);
lines.push('');

writeFileSync(OUT_PATH, lines.join('\n'));
console.log(`\nWrote ${OUT_PATH}`);
console.log(`Lines: ${lines.length}`);
