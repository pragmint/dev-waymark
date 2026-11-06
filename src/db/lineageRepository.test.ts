import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expandToRaw } from '../domain/lineage';
import { createLineageRepository } from './lineageRepository';
import type { LineageRepository } from './lineageRepository';
import { DuckdbSourceAdapter } from './source/duckdb';
import { LINEAGE_FIXTURE, writeLineageFixture } from './source/lineageFixture';

describe('lineage over a pipeline run', () => {
  let root: string;
  let adapter: DuckdbSourceAdapter;
  let repo: LineageRepository;

  beforeAll(async () => {
    root = mkdtempSync(join(tmpdir(), 'waymark-lineage-'));
    adapter = await DuckdbSourceAdapter.create(`file://${await writeLineageFixture(root)}/`);
    repo = createLineageRepository(adapter, adapter.listLineageTables());
  });

  afterAll(async () => {
    await adapter.close();
    rmSync(root, { recursive: true, force: true });
  });

  it('registers every table, and raw ones under raw.', () => {
    expect(adapter.listLineageTables()).toEqual([
      'changes',
      'entities',
      'entity_metadata',
      'lead_time_by_issue_type',
      'tickets',
      'raw.github_pulls',
      'raw.jira_issues',
    ]);
  });

  it('gets a derived row with its sources', async () => {
    const row = await repo.getRow('lead_time_by_issue_type', LINEAGE_FIXTURE.leadTimeId);
    expect(row?.rowId).toBe(LINEAGE_FIXTURE.leadTimeId);
    expect(row?.values.issue_type).toBe('Task');
    expect(row?.values._sources).toHaveLength(3);
  });

  it('gets a raw row by its dlt id', async () => {
    const row = await repo.getRow('raw.jira_issues', LINEAGE_FIXTURE.jiraDltIds[0]);
    expect(row?.values.key).toBe('DEMO-1');
  });

  it('returns null for a missing row and throws for an unknown table', async () => {
    expect(await repo.getRow('tickets', '404')).toBeNull();
    await expect(repo.getRow('nope', '1')).rejects.toThrow('Unknown lineage table');
  });

  it('groups a row’s parents by table', async () => {
    const row = await repo.getRow('lead_time_by_issue_type', LINEAGE_FIXTURE.leadTimeId);
    const sources = row?.values._sources as Array<{ table: string; row_id: string }>;
    const parents = await repo.getParents(sources, 1);
    expect(parents.map(p => [p.table, p.total, p.rows.map(r => r.rowId)])).toEqual([
      ['changes', 1, ['201']],
      ['tickets', 2, ['101']],
    ]);
    expect(parents.every(p => p.available && !p.isRaw)).toBe(true);
  });

  it('shows a source table the run lacks as unavailable', async () => {
    const parents = await repo.getParents([{ table: 'raw.missing', row_id: 'x' }], 10);
    expect(parents).toEqual([
      { table: 'raw.missing', isRaw: true, available: false, total: 1, rows: [] },
    ]);
  });

  it('cuts long text in previews only', async () => {
    const preview = await repo.getRows('raw.jira_issues', [LINEAGE_FIXTURE.jiraDltIds[0]], {
      preview: true,
    });
    const full = await repo.getRow('raw.jira_issues', LINEAGE_FIXTURE.jiraDltIds[0]);
    expect(String(preview[0]?.values.fields)).toBe(String(full?.values.fields).slice(0, 161));
  });

  it('expands a derived row to its raw records', async () => {
    const { hops, leaves } = await expandToRaw(
      { lead_time_by_issue_type: [LINEAGE_FIXTURE.leadTimeId] },
      repo.getSources
    );
    expect(hops).toHaveLength(3);
    expect(leaves).toEqual({
      'raw.github_pulls': [LINEAGE_FIXTURE.pullDltId],
      'raw.jira_issues': [...LINEAGE_FIXTURE.jiraDltIds].sort(),
    });
  });
});
