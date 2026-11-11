import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
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

  it('leaves the contract columns out of the views entity queries read', async () => {
    const columns = async (view: string) =>
      (await adapter.query<{ column_name: string }>(`DESCRIBE ${view}`)).map(r => r.column_name);
    for (const table of ['entities', 'entity_metadata']) {
      expect(await columns(table)).not.toContain('_sources');
      expect(await columns(table)).not.toContain('_fields');
      expect(await columns(table)).not.toContain('_row_id');
      expect(await columns(`lineage.${table}`)).toEqual(
        expect.arrayContaining(['_row_id', '_sources', '_fields'])
      );
    }
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
      { table: 'raw.missing', isRaw: true, available: false, total: 1, rows: [], highlight: [] },
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

describe('column lineage over a pipeline run', () => {
  let root: string;
  let adapter: DuckdbSourceAdapter;
  let repo: LineageRepository;

  beforeAll(async () => {
    root = mkdtempSync(join(tmpdir(), 'waymark-columns-'));
    adapter = await DuckdbSourceAdapter.create(await writeLineageFixture(root));
    repo = createLineageRepository(adapter, adapter.listLineageTables(), adapter.listColumnMaps());
  });

  afterAll(async () => {
    await adapter.close();
    rmSync(root, { recursive: true, force: true });
  });

  it('reads each table’s column map from its Parquet metadata', () => {
    expect(repo.columnMaps().lead_time_by_issue_type?.avg_lead_time_hours).toEqual([
      'changes.number',
    ]);
    expect(Object.keys(repo.columnMaps())).not.toContain('raw.jira_issues');
  });

  it('drops a malformed column map', () => {
    const lenient = createLineageRepository(adapter, adapter.listLineageTables(), {
      tickets: '{"x": 1}',
    });
    expect(lenient.columnMaps()).toEqual({});
  });

  it('extracts highlighted JSON paths from raw parents', async () => {
    const [group] = await repo.getParents(
      [{ table: 'raw.jira_issues', row_id: LINEAGE_FIXTURE.jiraDltIds[0] }],
      10,
      { 'raw.jira_issues': ['fields:$.issuetype.name'] }
    );
    expect(group?.highlight).toEqual(['fields:$.issuetype.name']);
    expect(group?.rows[0]?.values['fields:$.issuetype.name']).toBe('Task');
  });

  it('rejects an extract that is not a JSON path', async () => {
    await expect(
      repo.getRows('raw.jira_issues', ['x'], { extracts: ["fields:$.a'; DROP"] })
    ).rejects.toThrow('Invalid JSON path');
  });
});

describe('reading a published snapshot', () => {
  let root: string;

  beforeAll(async () => {
    root = mkdtempSync(join(tmpdir(), 'waymark-snapshot-'));
    await writeLineageFixture(root);
  });

  afterAll(() => {
    rmSync(root, { recursive: true, force: true });
  });

  async function withAdapter<T>(url: string, run: (a: DuckdbSourceAdapter) => Promise<T>) {
    const adapter = await DuckdbSourceAdapter.create(url);
    try {
      return await run(adapter);
    } finally {
      await adapter.close();
    }
  }

  it('reads only the files the manifest lists, not other runs or snapshots', async () => {
    await withAdapter(root, async adapter => {
      const raw = await adapter.query<{ key: string }>(
        `SELECT key FROM raw.jira_issues WHERE _dlt_id = 'jira/a+1'`
      );
      expect(raw.map(row => row.key)).toEqual(['DEMO-1']);
      const stale = await adapter.query<{ n: number }>(
        `SELECT count(*) AS n FROM tickets WHERE ticket_key = '${LINEAGE_FIXTURE.staleTicketKey}'`
      );
      expect(stale[0]?.n).toBe(0);
    });
  });

  it('reads a pinned snapshot from its manifest URL', async () => {
    const url = `${root}/snapshots/${LINEAGE_FIXTURE.snapshotId}.json`;
    await withAdapter(url, async adapter => {
      expect(adapter.listLineageTables()).toContain('raw.jira_issues');
    });
  });

  it('rejects a manifest that names a file outside its root', async () => {
    const bad = mkdtempSync(join(tmpdir(), 'waymark-snapshot-bad-'));
    try {
      mkdirSync(join(bad, 'snapshots'));
      const tables = { entities: { files: ['../elsewhere/entities.parquet'] } };
      writeFileSync(
        join(bad, 'snapshots', 'x.json'),
        JSON.stringify({ version: 1, snapshot: 'x', extract: 'r', tables })
      );
      await expect(DuckdbSourceAdapter.create(`${bad}/snapshots/x.json`)).rejects.toThrow(
        'leaves the bucket root'
      );
    } finally {
      rmSync(bad, { recursive: true, force: true });
    }
  });
});
