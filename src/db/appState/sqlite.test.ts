import { describe, expect, it, beforeEach } from 'bun:test';
import { SqliteAppStateRepository } from './sqlite';
import { migrations } from './migrations/index';
import { emptyTree, makeGroup, makeLeaf } from '../../schemas/filterTree';

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

  it('migrate creates presets table with filter_tree column', async () => {
    const repo = new SqliteAppStateRepository(':memory:');
    await repo.migrate();
    const db = repo.getDb();
    const tables = db
      .query("SELECT name FROM sqlite_master WHERE type='table' AND name='presets'")
      .all() as { name: string }[];
    expect(tables.map(t => t.name)).toEqual(['presets']);
    const cols = db.query('PRAGMA table_info(presets)').all() as { name: string }[];
    expect(cols.map(c => c.name)).toContain('filter_tree');
    await repo.close();
  });

  it('migrate drops the legacy preset_filters table', async () => {
    const repo = new SqliteAppStateRepository(':memory:');
    await repo.migrate();
    const tables = repo
      .getDb()
      .query("SELECT name FROM sqlite_master WHERE type='table' AND name='preset_filters'")
      .all();
    expect(tables).toHaveLength(0);
    await repo.close();
  });

  it('migrate records applied migrations', async () => {
    const repo = new SqliteAppStateRepository(':memory:');
    await repo.migrate();
    const rows = repo.getDb().query<{ name: string }, []>('SELECT name FROM _app_migrations').all();
    expect(rows.map(r => r.name)).toContain('migration-20260518T000000Z');
    expect(rows.map(r => r.name)).toContain('migration-20260618T000000Z');
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
    const id = await repo.savePreset('My preset', emptyTree());
    expect(typeof id).toBe('number');
    expect(id).toBeGreaterThan(0);
  });

  it('getPreset returns the saved preset and its tree', async () => {
    const tree = makeGroup('AND', [
      makeLeaf('entity_type', 'eq', 'jira_ticket'),
      makeLeaf('ticket_type', 'eq', 'story'),
    ]);
    const id = await repo.savePreset('Sprint velocity', tree);
    const preset = await repo.getPreset(id);
    expect(preset).not.toBeNull();
    expect(preset!.name).toBe('Sprint velocity');
    expect(preset!.tree.children).toHaveLength(2);
    expect(preset!.tree.op).toBe('AND');
  });

  it('round-trips a nested tree', async () => {
    const tree = makeGroup('AND', [
      makeLeaf('entity_type', 'eq', 'Service'),
      makeGroup('OR', [
        makeLeaf('owner', 'eq', ['Dave', 'Sam']),
        makeLeaf('active_prs', 'gte', '1'),
      ]),
    ]);
    const id = await repo.savePreset('complex', tree);
    const after = await repo.getPreset(id);
    expect(after!.tree).toEqual(tree);
  });

  it('getPreset returns null for unknown id', async () => {
    expect(await repo.getPreset(9999)).toBeNull();
  });

  it('savePreset with empty tree stores empty children', async () => {
    const id = await repo.savePreset('empty', emptyTree());
    const preset = await repo.getPreset(id);
    expect(preset!.tree.children).toHaveLength(0);
  });

  it('listPresets returns all saved presets without trees', async () => {
    await repo.savePreset(
      'Alpha',
      makeGroup('AND', [makeLeaf('entity_type', 'eq', 'jira_ticket')])
    );
    await repo.savePreset('Beta', emptyTree());
    const list = await repo.listPresets();
    expect(list).toHaveLength(2);
    expect(list.map(d => d.name)).toEqual(['Alpha', 'Beta']);
    expect(Object.keys(list[0])).not.toContain('tree');
  });

  it('deletePreset removes the preset', async () => {
    const id = await repo.savePreset(
      'to-delete',
      makeGroup('AND', [makeLeaf('entity_type', 'eq', 'github_pr')])
    );
    await repo.deletePreset(id);
    expect(await repo.getPreset(id)).toBeNull();
  });

  it('deletePreset is a no-op for unknown id', async () => {
    await expect(repo.deletePreset(9999)).resolves.toBeUndefined();
  });

  it('listPresetsWithTree returns presets with their trees', async () => {
    await repo.savePreset(
      'Alpha',
      makeGroup('AND', [
        makeLeaf('entity_type', 'eq', 'jira_ticket'),
        makeLeaf('status', 'eq', 'open'),
      ])
    );
    await repo.savePreset('Beta', emptyTree());

    const list = await repo.listPresetsWithTree();
    expect(list).toHaveLength(2);
    expect(list[0].name).toBe('Alpha');
    expect(list[0].tree.children).toHaveLength(2);
    expect(list[1].name).toBe('Beta');
    expect(list[1].tree.children).toHaveLength(0);
  });

  it('updatePreset replaces name and tree', async () => {
    const id = await repo.savePreset(
      'original',
      makeGroup('AND', [
        makeLeaf('entity_type', 'eq', 'jira_ticket'),
        makeLeaf('status', 'eq', 'open'),
      ])
    );
    await repo.updatePreset(
      id,
      'renamed',
      makeGroup('AND', [makeLeaf('entity_type', 'eq', 'github_pr')])
    );
    const after = await repo.getPreset(id);
    expect(after!.name).toBe('renamed');
    expect(after!.tree.children).toHaveLength(1);
  });

  it('updatePreset is a no-op for unknown id', async () => {
    await expect(repo.updatePreset(9999, 'x', emptyTree())).resolves.toBeUndefined();
  });

  it('supports all filter ops in a tree', async () => {
    const tree = makeGroup('AND', [
      makeLeaf('name', 'eq', 'foo'),
      makeLeaf('desc', 'contains', 'bar'),
      makeLeaf('wip', 'gte', '10'),
      makeLeaf('wip', 'lte', '50'),
      makeLeaf('name', 're', '^ENG'),
    ]);
    const id = await repo.savePreset('all ops', tree);
    const preset = await repo.getPreset(id);
    expect(preset!.tree.children).toHaveLength(5);
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
