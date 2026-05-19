import { describe, expect, it, beforeEach } from 'bun:test';
import { SqliteAppStateRepository } from './sqlite';
import { migrations } from './migrations/index';

describe('SqliteAppStateRepository — migration', () => {
  it('migrate creates _app_migrations tracking table', async () => {
    const repo = new SqliteAppStateRepository(':memory:');
    await repo.migrate();
    const row = repo
      .getDb()
      .query("SELECT name FROM sqlite_master WHERE type='table' AND name='_app_migrations'")
      .get();
    expect(row).not.toBeNull();
    await repo.close();
  });

  it('migrate applies the datasets migration', async () => {
    const repo = new SqliteAppStateRepository(':memory:');
    await repo.migrate();
    const db = repo.getDb();
    const tables = db
      .query(
        "SELECT name FROM sqlite_master WHERE type='table' AND name IN ('datasets','dataset_filters') ORDER BY name"
      )
      .all() as { name: string }[];
    expect(tables.map(t => t.name)).toEqual(['dataset_filters', 'datasets']);
    await repo.close();
  });

  it('migrate records applied migrations', async () => {
    const repo = new SqliteAppStateRepository(':memory:');
    await repo.migrate();
    const rows = repo.getDb().query<{ name: string }, []>('SELECT name FROM _app_migrations').all();
    expect(rows.map(r => r.name)).toContain('migration-20260518T000000Z');
    await repo.close();
  });

  it('migrate is idempotent', async () => {
    const repo = new SqliteAppStateRepository(':memory:');
    await repo.migrate();
    await repo.migrate();
    const rows = repo.getDb().query('SELECT * FROM _app_migrations').all();
    expect(rows).toHaveLength(migrations.length);
    await repo.close();
  });
});

describe('SqliteAppStateRepository — datasets', () => {
  let repo: SqliteAppStateRepository;

  beforeEach(async () => {
    repo = new SqliteAppStateRepository(':memory:');
    await repo.migrate();
  });

  it('saveDataset returns a numeric id', async () => {
    const id = await repo.saveDataset('My dataset', []);
    expect(typeof id).toBe('number');
    expect(id).toBeGreaterThan(0);
  });

  it('getDataset returns the saved dataset', async () => {
    const id = await repo.saveDataset('Sprint velocity', [
      { key: 'source', op: 'eq', value: 'jira' },
      { key: 'ticket_type', op: 'eq', value: 'story' },
    ]);
    const dataset = await repo.getDataset(id);
    expect(dataset).not.toBeNull();
    expect(dataset!.name).toBe('Sprint velocity');
    expect(dataset!.filters).toHaveLength(2);
    expect(dataset!.filters[0]).toEqual({ key: 'source', op: 'eq', value: 'jira' });
    expect(dataset!.filters[1]).toEqual({ key: 'ticket_type', op: 'eq', value: 'story' });
  });

  it('getDataset preserves filter sort order', async () => {
    const id = await repo.saveDataset('ordered', [
      { key: 'c', op: 'eq', value: '3' },
      { key: 'a', op: 'eq', value: '1' },
      { key: 'b', op: 'eq', value: '2' },
    ]);
    const dataset = await repo.getDataset(id);
    expect(dataset!.filters.map(f => f.key)).toEqual(['c', 'a', 'b']);
  });

  it('getDataset returns null for unknown id', async () => {
    expect(await repo.getDataset(9999)).toBeNull();
  });

  it('saveDataset with no filters stores empty filter list', async () => {
    const id = await repo.saveDataset('empty', []);
    const dataset = await repo.getDataset(id);
    expect(dataset!.filters).toHaveLength(0);
  });

  it('listDatasets returns all saved datasets without filters', async () => {
    await repo.saveDataset('Alpha', [{ key: 'source', op: 'eq', value: 'jira' }]);
    await repo.saveDataset('Beta', []);
    const list = await repo.listDatasets();
    expect(list).toHaveLength(2);
    expect(list.map(d => d.name)).toEqual(['Alpha', 'Beta']);
    // listDatasets does not include filters
    expect(Object.keys(list[0])).not.toContain('filters');
  });

  it('deleteDataset removes the dataset and its filters', async () => {
    const id = await repo.saveDataset('to-delete', [{ key: 'source', op: 'eq', value: 'github' }]);
    await repo.deleteDataset(id);
    expect(await repo.getDataset(id)).toBeNull();
    // filters should be cascade-deleted
    const filterRows = repo
      .getDb()
      .query('SELECT * FROM dataset_filters WHERE dataset_id = ?')
      .all(id);
    expect(filterRows).toHaveLength(0);
  });

  it('deleteDataset is a no-op for unknown id', async () => {
    await expect(repo.deleteDataset(9999)).resolves.toBeUndefined();
  });

  it('supports all filter ops', async () => {
    const filters = [
      { key: 'name', op: 'eq' as const, value: 'foo' },
      { key: 'desc', op: 'contains' as const, value: 'bar' },
      { key: 'wip', op: 'gte' as const, value: '10' },
      { key: 'wip', op: 'lte' as const, value: '50' },
      { key: 'name', op: 're' as const, value: '^ENG' },
    ];
    const id = await repo.saveDataset('all ops', filters);
    const dataset = await repo.getDataset(id);
    expect(dataset!.filters).toEqual(filters);
  });
});

describe('app state DB independence from source DB', () => {
  it('app state DB has no entity/source tables', async () => {
    const repo = new SqliteAppStateRepository(':memory:');
    await repo.migrate();
    const tables = repo
      .getDb()
      .query(
        "SELECT name FROM sqlite_master WHERE type='table' AND name IN ('entities','entity_metadata')"
      )
      .all();
    expect(tables).toHaveLength(0);
    await repo.close();
  });
});
