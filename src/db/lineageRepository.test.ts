import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { traceEntityValue, traceField, walkField } from '../domain/columnLineage';
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

  it('registers the entity tables and raw ones under raw., and nothing else', () => {
    expect(adapter.listLineageTables()).toEqual([
      'entities',
      'entity_metadata',
      'raw.github_pulls',
      'raw.jira_issues',
    ]);
  });

  it('reads every job’s part of an entity table as one table', async () => {
    const types = await adapter.query<{ type: string }>(
      'SELECT DISTINCT type FROM entities ORDER BY type'
    );
    expect(types.map(row => row.type)).toEqual(['change', 'lead_time_by_issue_type', 'ticket']);
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
    const row = await repo.getRow('entities', LINEAGE_FIXTURE.leadTimeId);
    expect(row?.rowId).toBe(LINEAGE_FIXTURE.leadTimeId);
    expect(row?.values.name).toBe('Task');
    expect(row?.values._sources).toHaveLength(3);
  });

  it('gets an entity with its metadata values, under their keys', async () => {
    const row = await repo.getRow('entities', LINEAGE_FIXTURE.changeId);
    expect(row?.values).toMatchObject({ name: 'demo/repo#7', type: 'change', number: '7' });
    const raw = await repo.getRow('raw.github_pulls', LINEAGE_FIXTURE.pullDltId);
    expect(raw?.values).not.toHaveProperty('_row_id');
  });

  it('gets a raw row by its dlt id', async () => {
    const row = await repo.getRow('raw.jira_issues', LINEAGE_FIXTURE.jiraDltIds[0]);
    expect(row?.values.key).toBe('DEMO-1');
  });

  it('returns null for a missing row and throws for an unknown table', async () => {
    expect(await repo.getRow('entities', '404')).toBeNull();
    await expect(repo.getRow('nope', '1')).rejects.toThrow('Unknown lineage table');
  });

  it('groups a row’s parents by table', async () => {
    const row = await repo.getRow('entities', LINEAGE_FIXTURE.leadTimeId);
    const sources = row?.values._sources as Array<{ table: string; row_id: string }>;
    const parents = await repo.getParents(sources, 1);
    // Entities, never their metadata rows, though the lead time reads only their metadata.
    expect(parents.map(p => [p.table, p.total, p.rows.map(r => r.rowId)])).toEqual([
      ['entities', 3, ['101']],
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
      { entities: [LINEAGE_FIXTURE.leadTimeId] },
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

  it('reads each table’s column map as the union of its parts’ Parquet metadata', () => {
    expect(repo.columnMaps().entities?.name).toEqual([
      'entities[type=ticket].issue_type',
      'raw.github_pulls.number',
      'raw.github_pulls.repo',
      'raw.jira_issues.key',
    ]);
    expect(Object.keys(repo.columnMaps())).not.toContain('raw.jira_issues');
  });

  it('fetches each row’s own _fields', async () => {
    const fields = await repo.rowFields('entity_metadata', [
      ...LINEAGE_FIXTURE.issueTypeIds,
      LINEAGE_FIXTURE.changeNumberId,
    ]);
    expect(fields[LINEAGE_FIXTURE.changeNumberId]?.value).toEqual(['raw.github_pulls.number']);
    expect(fields[LINEAGE_FIXTURE.issueTypeIds[0]]?.value).toEqual([
      'raw.jira_issues.fields:$.issuetype.name',
    ]);
    expect(await repo.rowFields('raw.jira_issues', ['x'])).toEqual({});
  });

  it('finds the metadata row holding each entity’s value for a key', async () => {
    const found = await repo.metadataRows(
      [...LINEAGE_FIXTURE.ticketIds, LINEAGE_FIXTURE.changeId],
      ['issue_type']
    );
    expect(found.map(f => [f.entityId, f.rowId]).sort()).toEqual([
      ['101', LINEAGE_FIXTURE.issueTypeIds[0]],
      ['102', LINEAGE_FIXTURE.issueTypeIds[1]],
    ]);
  });

  it('fills highlighted metadata keys into an entity parent group', async () => {
    const [group] = await repo.getParents(
      [{ table: 'entities', row_id: LINEAGE_FIXTURE.changeId }],
      10,
      { entities: ['number'] }
    );
    expect(group?.rows[0]?.values.number).toBe('7');
  });

  it('traces a field through entities to raw, never through a metadata row', async () => {
    const row = await repo.getRow('entities', LINEAGE_FIXTURE.leadTimeId);
    const trace = row && traceField(repo.columnMaps(), 'entities', 'name', row.values);
    if (!trace) throw new Error('expected a trace');
    const walk = await walkField(
      'entities',
      LINEAGE_FIXTURE.leadTimeId,
      trace,
      repo.columnMaps(),
      repo
    );
    expect(walk.hops).toEqual([
      { entities: [LINEAGE_FIXTURE.leadTimeId] },
      { entities: [...LINEAGE_FIXTURE.ticketIds] },
      { 'raw.jira_issues': [...LINEAGE_FIXTURE.jiraDltIds].sort() },
    ]);
    expect(walk.columns).toEqual({
      entities: ['issue_type'],
      'raw.jira_issues': ['fields:$.issuetype.name'],
    });
  });

  it('traces an entity’s own metadata value from the entity', async () => {
    const trace = await traceEntityValue(LINEAGE_FIXTURE.changeId, 'number', repo);
    if (!trace) throw new Error('expected a trace');
    const walk = await walkField(
      'entities',
      LINEAGE_FIXTURE.changeId,
      trace,
      repo.columnMaps(),
      repo
    );
    expect(walk.hops).toEqual([
      { entities: [LINEAGE_FIXTURE.changeId] },
      { 'raw.github_pulls': [LINEAGE_FIXTURE.pullDltId] },
    ]);
  });

  it('drops a malformed column map', () => {
    const lenient = createLineageRepository(adapter, adapter.listLineageTables(), {
      entities: '{"x": 1}',
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
        `SELECT count(*) AS n FROM entities WHERE name = '${LINEAGE_FIXTURE.staleTicketKey}'`
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

  it('still reads a version 1 manifest, which lists files the same way', async () => {
    const old = mkdtempSync(join(tmpdir(), 'waymark-snapshot-v1-'));
    try {
      await writeLineageFixture(old);
      const path = join(old, 'snapshots', `${LINEAGE_FIXTURE.snapshotId}.json`);
      const manifest = JSON.parse(await Bun.file(path).text()) as Record<string, unknown>;
      writeFileSync(path, JSON.stringify({ ...manifest, version: 1 }));
      await withAdapter(old, async adapter => {
        expect(adapter.listLineageTables()).toContain('entities');
      });
    } finally {
      rmSync(old, { recursive: true, force: true });
    }
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
