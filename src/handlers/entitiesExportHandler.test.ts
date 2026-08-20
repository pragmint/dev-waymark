import { describe, expect, it, beforeEach } from 'bun:test';
import { Hono } from 'hono';
import { SqliteSourceAdapter } from '../db/source/sqlite';
import { initSourceAdapter, getEntityRepo } from '../db/source/index';
import { entitiesExportHandler } from './entitiesHandler';
import type { Entity, Metadata } from '../schemas/entity';

const makeEntity = (id: number, overrides: Partial<Entity> = {}): Entity => ({
  id,
  name: `PR-${id}`,
  type: 'github_pr',
  created_at: '',
  ...overrides,
});

const makeMetadata = (entityId: number, key: string, value: string | null): Metadata => ({
  entity_id: entityId,
  key,
  value,
  value_type: 'string',
  created_at: '',
  updated_at: '',
});

function buildApp() {
  const app = new Hono();
  app.get('/entities/export', entitiesExportHandler);
  return app;
}

// Rows come back id DESC, so the CSV data rows for ids 1..n read n, n-1, ... 1.
function dataRows(csv: string): string[] {
  return csv.split('\r\n').slice(1);
}

describe('entitiesExportHandler', () => {
  let app: ReturnType<typeof buildApp>;

  beforeEach(async () => {
    initSourceAdapter(new SqliteSourceAdapter(':memory:', true));
    app = buildApp();
    const repo = getEntityRepo();
    for (let id = 1; id <= 10; id++) {
      await repo.upsert(makeEntity(id), [makeMetadata(id, 'author', `dev${id}`)]);
    }
  });

  it('exports every matching row with a CSV content type and attachment filename', async () => {
    const res = await app.request('/entities/export');
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toBe('text/csv; charset=utf-8');
    expect(res.headers.get('Content-Disposition')).toContain('attachment; filename=');
    expect(dataRows(await res.text())).toHaveLength(10);
  });

  it('returns one chunk plus a cursor when limit is given', async () => {
    const res = await app.request('/entities/export?limit=3');
    expect(res.status).toBe(200);
    expect(dataRows(await res.text())).toHaveLength(3);
    // Last row of the first id-DESC page is id 8, so the next walk starts below it.
    expect(res.headers.get('X-Next-Cursor')).toBe('8');
  });

  it('continues the keyset walk from a valid afterId', async () => {
    const res = await app.request('/entities/export?limit=3&afterId=8');
    expect(dataRows(await res.text()).map(r => r.split(',')[0])).toEqual(['PR-7', 'PR-6', 'PR-5']);
  });

  it('omits the cursor once the walk is exhausted', async () => {
    const res = await app.request('/entities/export?limit=20');
    expect(dataRows(await res.text())).toHaveLength(10);
    expect(res.headers.get('X-Next-Cursor')).toBeNull();
  });

  // Regression: a malformed cursor used to fall back to 0, which is itself a
  // valid keyset value — `e.id < 0` matched nothing, so the response was a
  // header-only CSV under a 200, indistinguishable from a real empty result.
  it('ignores a malformed afterId instead of treating it as cursor 0', async () => {
    const res = await app.request('/entities/export?limit=3&afterId=abc');
    expect(res.status).toBe(200);
    expect(dataRows(await res.text())).toHaveLength(3);
  });

  it('ignores a negative afterId instead of treating it as cursor 0', async () => {
    const res = await app.request('/entities/export?limit=3&afterId=-5');
    expect(dataRows(await res.text())).toHaveLength(3);
  });
});
