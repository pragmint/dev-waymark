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

  it('migrate applies the presets migration', async () => {
    const repo = new SqliteAppStateRepository(':memory:');
    await repo.migrate();
    const db = repo.getDb();
    const tables = db
      .query(
        "SELECT name FROM sqlite_master WHERE type='table' AND name IN ('presets','preset_filters') ORDER BY name"
      )
      .all() as { name: string }[];
    expect(tables.map(t => t.name)).toEqual(['preset_filters', 'presets']);
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

describe('SqliteAppStateRepository — presets', () => {
  let repo: SqliteAppStateRepository;

  beforeEach(async () => {
    repo = new SqliteAppStateRepository(':memory:');
    await repo.migrate();
  });

  it('savePreset returns a numeric id', async () => {
    const id = await repo.savePreset('My preset', []);
    expect(typeof id).toBe('number');
    expect(id).toBeGreaterThan(0);
  });

  it('getPreset returns the saved preset', async () => {
    const id = await repo.savePreset('Sprint velocity', [
      { key: 'entity_type', op: 'eq', value: 'jira_ticket' },
      { key: 'ticket_type', op: 'eq', value: 'story' },
    ]);
    const preset = await repo.getPreset(id);
    expect(preset).not.toBeNull();
    expect(preset!.name).toBe('Sprint velocity');
    expect(preset!.filters).toHaveLength(2);
    expect(preset!.filters[0]).toEqual({ key: 'entity_type', op: 'eq', value: 'jira_ticket' });
    expect(preset!.filters[1]).toEqual({ key: 'ticket_type', op: 'eq', value: 'story' });
  });

  it('getPreset preserves filter sort order', async () => {
    const id = await repo.savePreset('ordered', [
      { key: 'c', op: 'eq', value: '3' },
      { key: 'a', op: 'eq', value: '1' },
      { key: 'b', op: 'eq', value: '2' },
    ]);
    const preset = await repo.getPreset(id);
    expect(preset!.filters.map(f => f.key)).toEqual(['c', 'a', 'b']);
  });

  it('getPreset returns null for unknown id', async () => {
    expect(await repo.getPreset(9999)).toBeNull();
  });

  it('savePreset with no filters stores empty filter list', async () => {
    const id = await repo.savePreset('empty', []);
    const preset = await repo.getPreset(id);
    expect(preset!.filters).toHaveLength(0);
  });

  it('listPresets returns all saved presets without filters', async () => {
    await repo.savePreset('Alpha', [{ key: 'entity_type', op: 'eq', value: 'jira_ticket' }]);
    await repo.savePreset('Beta', []);
    const list = await repo.listPresets();
    expect(list).toHaveLength(2);
    expect(list.map(d => d.name)).toEqual(['Alpha', 'Beta']);
    // listPresets does not include filters
    expect(Object.keys(list[0])).not.toContain('filters');
  });

  it('deletePreset removes the preset and its filters', async () => {
    const id = await repo.savePreset('to-delete', [
      { key: 'entity_type', op: 'eq', value: 'github_pr' },
    ]);
    await repo.deletePreset(id);
    expect(await repo.getPreset(id)).toBeNull();
    // filters should be cascade-deleted
    const filterRows = repo
      .getDb()
      .query('SELECT * FROM preset_filters WHERE preset_id = ?')
      .all(id);
    expect(filterRows).toHaveLength(0);
  });

  it('deletePreset is a no-op for unknown id', async () => {
    await expect(repo.deletePreset(9999)).resolves.toBeUndefined();
  });

  it('listPresetsWithFilters returns presets with their filters', async () => {
    await repo.savePreset('Alpha', [
      { key: 'entity_type', op: 'eq', value: 'jira_ticket' },
      { key: 'status', op: 'eq', value: 'open' },
    ]);
    await repo.savePreset('Beta', []);

    const list = await repo.listPresetsWithFilters();
    expect(list).toHaveLength(2);
    expect(list[0].name).toBe('Alpha');
    expect(list[0].filters).toHaveLength(2);
    expect(list[1].name).toBe('Beta');
    expect(list[1].filters).toHaveLength(0);
  });

  it('updatePreset replaces name and filters atomically', async () => {
    const id = await repo.savePreset('original', [
      { key: 'entity_type', op: 'eq', value: 'jira_ticket' },
      { key: 'status', op: 'eq', value: 'open' },
    ]);
    await repo.updatePreset(id, 'renamed', [{ key: 'entity_type', op: 'eq', value: 'github_pr' }]);
    const after = await repo.getPreset(id);
    expect(after!.name).toBe('renamed');
    expect(after!.filters).toEqual([{ key: 'entity_type', op: 'eq', value: 'github_pr' }]);
    const orphaned = repo
      .getDb()
      .query('SELECT * FROM preset_filters WHERE preset_id = ?')
      .all(id) as unknown[];
    expect(orphaned).toHaveLength(1);
  });

  it('updatePreset is a no-op for unknown id', async () => {
    await expect(repo.updatePreset(9999, 'x', [])).resolves.toBeUndefined();
  });

  it('supports all filter ops', async () => {
    const filters = [
      { key: 'name', op: 'eq' as const, value: 'foo' },
      { key: 'desc', op: 'contains' as const, value: 'bar' },
      { key: 'wip', op: 'gte' as const, value: '10' },
      { key: 'wip', op: 'lte' as const, value: '50' },
      { key: 'name', op: 're' as const, value: '^ENG' },
    ];
    const id = await repo.savePreset('all ops', filters);
    const preset = await repo.getPreset(id);
    expect(preset!.filters).toEqual(filters);
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
