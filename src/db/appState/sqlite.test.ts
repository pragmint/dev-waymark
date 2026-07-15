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
    ]);
    const id = await repo.savePreset('all ops', tree);
    const preset = await repo.getPreset(id);
    expect(preset!.tree.children).toHaveLength(4);
  });
});

describe('SqliteAppStateRepository — dashboards', () => {
  let repo: SqliteAppStateRepository;

  async function seedPreset(): Promise<number> {
    return repo.savePreset('p', emptyTree());
  }

  async function seedViz(presetId: number, name = 'viz'): Promise<number> {
    return repo.saveVisualization(name, null, presetId, {
      chartType: 'bar',
      aggregation: { function: 'count' },
    });
  }

  beforeEach(async () => {
    repo = new SqliteAppStateRepository(':memory:');
    await repo.migrate();
  });

  it('saveDashboard returns a numeric id and stores the name', async () => {
    const id = await repo.saveDashboard('My dashboard', []);
    expect(typeof id).toBe('number');
    const dash = await repo.getDashboard(id);
    expect(dash!.name).toBe('My dashboard');
    expect(dash!.visualizationIds).toEqual([]);
  });

  it('saveDashboard stores viz ids in the given order', async () => {
    const presetId = await seedPreset();
    const v1 = await seedViz(presetId, 'A');
    const v2 = await seedViz(presetId, 'B');
    const v3 = await seedViz(presetId, 'C');
    const id = await repo.saveDashboard('ordered', [v3, v1, v2]);
    const dash = await repo.getDashboard(id);
    expect(dash!.visualizationIds).toEqual([v3, v1, v2]);
  });

  it('getDashboard returns null for unknown id', async () => {
    expect(await repo.getDashboard(9999)).toBeNull();
  });

  it('listDashboards returns id+name only', async () => {
    await repo.saveDashboard('Alpha', []);
    await repo.saveDashboard('Beta', []);
    const list = await repo.listDashboards();
    expect(list.map(d => d.name)).toEqual(['Alpha', 'Beta']);
  });

  it('updateDashboard replaces name and viz list', async () => {
    const presetId = await seedPreset();
    const v1 = await seedViz(presetId);
    const v2 = await seedViz(presetId);
    const id = await repo.saveDashboard('orig', [v1]);
    await repo.updateDashboard(id, 'renamed', [v2, v1]);
    const after = await repo.getDashboard(id);
    expect(after!.name).toBe('renamed');
    expect(after!.visualizationIds).toEqual([v2, v1]);
  });

  it('updateDashboard is a no-op for unknown id', async () => {
    await expect(repo.updateDashboard(9999, 'x', [])).resolves.toBeUndefined();
  });

  it('deleteDashboard removes the dashboard and its junction rows', async () => {
    const presetId = await seedPreset();
    const v1 = await seedViz(presetId);
    const id = await repo.saveDashboard('to-delete', [v1]);
    await repo.deleteDashboard(id);
    expect(await repo.getDashboard(id)).toBeNull();
    // junction is cleaned up via FK CASCADE
    const junction = repo
      .getDb()
      .query('SELECT * FROM dashboard_visualizations WHERE dashboard_id = ?')
      .all(id);
    expect(junction).toHaveLength(0);
  });

  it('deleteDashboard does not delete the underlying viz', async () => {
    const presetId = await seedPreset();
    const v1 = await seedViz(presetId);
    const id = await repo.saveDashboard('d', [v1]);
    await repo.deleteDashboard(id);
    const viz = await repo.getVisualization(v1);
    expect(viz).not.toBeNull();
  });

  it('deleting a visualization removes its junction rows on every dashboard', async () => {
    const presetId = await seedPreset();
    const v1 = await seedViz(presetId);
    const d1 = await repo.saveDashboard('one', [v1]);
    const d2 = await repo.saveDashboard('two', [v1]);
    await repo.deleteVisualization(v1);
    expect((await repo.getDashboard(d1))!.visualizationIds).toEqual([]);
    expect((await repo.getDashboard(d2))!.visualizationIds).toEqual([]);
  });

  it('addVisualizationToDashboard appends at end and is idempotent', async () => {
    const presetId = await seedPreset();
    const v1 = await seedViz(presetId, 'A');
    const v2 = await seedViz(presetId, 'B');
    const id = await repo.saveDashboard('d', [v1]);
    await repo.addVisualizationToDashboard(id, v2);
    await repo.addVisualizationToDashboard(id, v2); // dup → no-op
    expect((await repo.getDashboard(id))!.visualizationIds).toEqual([v1, v2]);
  });

  it('removeVisualizationFromDashboard unlinks only, viz stays in DB', async () => {
    const presetId = await seedPreset();
    const v1 = await seedViz(presetId);
    const id = await repo.saveDashboard('d', [v1]);
    await repo.removeVisualizationFromDashboard(id, v1);
    expect((await repo.getDashboard(id))!.visualizationIds).toEqual([]);
    expect(await repo.getVisualization(v1)).not.toBeNull();
  });

  it('listVisualizationsNotOnDashboard excludes viz on the dashboard', async () => {
    const presetId = await seedPreset();
    const v1 = await seedViz(presetId, 'on');
    const v2 = await seedViz(presetId, 'off');
    const id = await repo.saveDashboard('d', [v1]);
    const others = await repo.listVisualizationsNotOnDashboard(id);
    expect(others.map(v => v.id)).toEqual([v2]);
  });

  it('getDashboardCountsByViz returns counts keyed by viz id', async () => {
    const presetId = await seedPreset();
    const v1 = await seedViz(presetId, 'A');
    const v2 = await seedViz(presetId, 'B');
    await repo.saveDashboard('d1', [v1, v2]);
    await repo.saveDashboard('d2', [v1]);
    const counts = await repo.getDashboardCountsByViz();
    expect(counts[v1]).toBe(2);
    expect(counts[v2]).toBe(1);
  });

  it('orphan viz (on zero dashboards) is absent from dashboard counts', async () => {
    const presetId = await seedPreset();
    await seedViz(presetId, 'orphan');
    const counts = await repo.getDashboardCountsByViz();
    expect(Object.keys(counts)).toHaveLength(0);
  });

  it('listDashboardsForVisualization returns every dashboard the viz is on', async () => {
    const presetId = await seedPreset();
    const v1 = await seedViz(presetId);
    const d1 = await repo.saveDashboard('one', [v1]);
    const d2 = await repo.saveDashboard('two', [v1]);
    await repo.saveDashboard('three', []);
    const dashboards = await repo.listDashboardsForVisualization(v1);
    expect(dashboards.map(d => d.id)).toEqual([d1, d2]);
  });

  it('deleteAllDashboards removes every dashboard', async () => {
    await repo.saveDashboard('A', []);
    await repo.saveDashboard('B', []);
    await repo.deleteAllDashboards();
    expect(await repo.listDashboards()).toHaveLength(0);
  });
});

describe('SqliteAppStateRepository — waymarks', () => {
  let repo: SqliteAppStateRepository;

  async function seedPreset(): Promise<number> {
    return repo.savePreset('p', emptyTree());
  }

  async function seedViz(presetId: number, name = 'viz'): Promise<number> {
    return repo.saveVisualization(name, null, presetId, {
      chartType: 'line',
      xAxis: { metadataKey: 'done_at', type: 'date', timeBucket: 'month' },
      aggregation: { function: 'avg' },
    });
  }

  function waymarkInput(overrides: Partial<Parameters<typeof repo.createWaymark>[1]> = {}) {
    return {
      startDate: '2026-04-01',
      endDate: '2026-10-01',
      targetValue: 100,
      appliesTo: 'main' as const,
      label: null,
      ...overrides,
    };
  }

  beforeEach(async () => {
    repo = new SqliteAppStateRepository(':memory:');
    await repo.migrate();
  });

  it('createWaymark returns a numeric id', async () => {
    const presetId = await seedPreset();
    const vizId = await seedViz(presetId);
    const id = await repo.createWaymark(vizId, waymarkInput());
    expect(typeof id).toBe('number');
    expect(id).toBeGreaterThan(0);
  });

  it('listWaymarksForVisualization returns the saved fields', async () => {
    const presetId = await seedPreset();
    const vizId = await seedViz(presetId);
    await repo.createWaymark(
      vizId,
      waymarkInput({ startDate: '2026-01-01', endDate: '2026-06-01', label: 'Q1 goal' })
    );
    const waymarks = await repo.listWaymarksForVisualization(vizId);
    expect(waymarks).toHaveLength(1);
    expect(waymarks[0].visualizationId).toBe(vizId);
    expect(waymarks[0].startDate).toBe('2026-01-01');
    expect(waymarks[0].endDate).toBe('2026-06-01');
    expect(waymarks[0].targetValue).toBe(100);
    expect(waymarks[0].appliesTo).toBe('main');
    expect(waymarks[0].label).toBe('Q1 goal');
  });

  it('listWaymarksForVisualization orders by start date', async () => {
    const presetId = await seedPreset();
    const vizId = await seedViz(presetId);
    await repo.createWaymark(
      vizId,
      waymarkInput({ startDate: '2026-06-01', endDate: '2026-12-01' })
    );
    await repo.createWaymark(
      vizId,
      waymarkInput({ startDate: '2026-01-01', endDate: '2026-06-01' })
    );
    const waymarks = await repo.listWaymarksForVisualization(vizId);
    expect(waymarks.map(w => w.startDate)).toEqual(['2026-01-01', '2026-06-01']);
  });

  it('listWaymarksForVisualization only returns waymarks for that visualization', async () => {
    const presetId = await seedPreset();
    const v1 = await seedViz(presetId, 'A');
    const v2 = await seedViz(presetId, 'B');
    await repo.createWaymark(v1, waymarkInput());
    const waymarks = await repo.listWaymarksForVisualization(v2);
    expect(waymarks).toHaveLength(0);
  });

  it('updateWaymark replaces every field', async () => {
    const presetId = await seedPreset();
    const vizId = await seedViz(presetId);
    const id = await repo.createWaymark(vizId, waymarkInput());
    await repo.updateWaymark(
      id,
      waymarkInput({
        startDate: '2026-05-01',
        endDate: '2026-11-01',
        targetValue: 50,
        appliesTo: 'smoothing',
        label: 'updated',
      })
    );
    const [waymark] = await repo.listWaymarksForVisualization(vizId);
    expect(waymark.startDate).toBe('2026-05-01');
    expect(waymark.endDate).toBe('2026-11-01');
    expect(waymark.targetValue).toBe(50);
    expect(waymark.appliesTo).toBe('smoothing');
    expect(waymark.label).toBe('updated');
  });

  it('updateWaymark is a no-op for unknown id', async () => {
    await expect(repo.updateWaymark(9999, waymarkInput())).resolves.toBeUndefined();
  });

  it('deleteWaymark removes it', async () => {
    const presetId = await seedPreset();
    const vizId = await seedViz(presetId);
    const id = await repo.createWaymark(vizId, waymarkInput());
    await repo.deleteWaymark(id);
    expect(await repo.listWaymarksForVisualization(vizId)).toHaveLength(0);
  });

  it('deleteWaymark is a no-op for unknown id', async () => {
    await expect(repo.deleteWaymark(9999)).resolves.toBeUndefined();
  });

  it('deleteAllWaymarks removes every waymark', async () => {
    const presetId = await seedPreset();
    const v1 = await seedViz(presetId, 'A');
    const v2 = await seedViz(presetId, 'B');
    await repo.createWaymark(v1, waymarkInput());
    await repo.createWaymark(v2, waymarkInput());
    await repo.deleteAllWaymarks();
    expect(await repo.listWaymarksForVisualization(v1)).toHaveLength(0);
    expect(await repo.listWaymarksForVisualization(v2)).toHaveLength(0);
  });

  it('deleting the visualization cascades to its waymarks', async () => {
    const presetId = await seedPreset();
    const vizId = await seedViz(presetId);
    await repo.createWaymark(vizId, waymarkInput());
    await repo.deleteVisualization(vizId);
    const rows = repo.getDb().query('SELECT * FROM waymarks WHERE visualization_id = ?').all(vizId);
    expect(rows).toHaveLength(0);
  });

  it('truncateData clears waymarks along with visualizations', async () => {
    const presetId = await seedPreset();
    const vizId = await seedViz(presetId);
    await repo.createWaymark(vizId, waymarkInput());
    await repo.truncateData();
    const rows = repo.getDb().query('SELECT * FROM waymarks').all();
    expect(rows).toHaveLength(0);
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
