import { describe, expect, it, beforeEach, afterEach } from 'bun:test';
import { Hono } from 'hono';
import { SqliteSourceAdapter } from '../db/source/sqlite';
import { initSourceAdapter } from '../db/source/index';
import { SqliteAppStateRepository } from '../db/appState/sqlite';
import type { AppStateRepository } from '../db/appState/repository';
import { initAppStateRepo, getAppStateRepo } from '../db/appState/index';
import {
  dashboardCardsApiHandler,
  visualizationUpdateApiHandler,
  invalidateCardCache,
} from './dashboardsHandler';
import { entityPresetsUpdateHandler, entityPresetsDeleteHandler } from './entityPresetsHandler';
import {
  waymarkCreateApiHandler,
  waymarkUpdateApiHandler,
  waymarkDeleteApiHandler,
} from './waymarksHandler';
import { emptyTree, makeGroup, makeLeaf } from '../schemas/filterTree';
import { encodeTree } from '../domain/filterUrl';
import type { VisualizationConfig } from '../schemas/visualization';

// Every card build starts with `repo.getVisualization(vizId)` (see
// buildCardUncached) — spying on it is a cache-implementation-agnostic way to
// observe "did the cache actually get used" without exporting any internals:
// a cache hit never reaches this call, a miss always does. Some of the write
// handlers under test also call getVisualization themselves (e.g. an
// existence check before updating), so tests compare snapshots around a
// fetch rather than asserting exact totals — that keeps them agnostic to a
// handler's own internal reads and focused only on "did the fetch itself
// trigger a rebuild".
function spyOnGetVisualization(repo: AppStateRepository): { calls: number } {
  const original = repo.getVisualization.bind(repo);
  const counter = { calls: 0 };
  repo.getVisualization = (async (id: number) => {
    counter.calls += 1;
    return original(id);
  }) as typeof repo.getVisualization;
  return counter;
}

const CONFIG: VisualizationConfig = {
  chartType: 'bar',
  xAxis: { metadataKey: 'date_field', type: 'date', timeBucket: 'week' },
  aggregation: { function: 'count' },
};

function buildApp() {
  const app = new Hono();
  app.get('/api/dashboards/:id/cards', dashboardCardsApiHandler);
  app.post('/api/visualizations/:id', visualizationUpdateApiHandler);
  app.post('/entities/presets/:id', entityPresetsUpdateHandler);
  app.post('/entities/presets/:id/delete', entityPresetsDeleteHandler);
  app.post('/api/visualizations/:id/waymarks', waymarkCreateApiHandler);
  app.post('/api/waymarks/:id', waymarkUpdateApiHandler);
  app.post('/api/waymarks/:id/delete', waymarkDeleteApiHandler);
  return app;
}

describe('dashboard card cache invalidation', () => {
  let sourceAdapter: SqliteSourceAdapter;
  let appRepo: SqliteAppStateRepository;
  let app: Hono;
  let dashboardId: number;
  let vizId: number;
  let presetId: number;
  let getVisualizationCalls: { calls: number };

  beforeEach(async () => {
    sourceAdapter = new SqliteSourceAdapter(':memory:', true);
    initSourceAdapter(sourceAdapter);
    await sourceAdapter.execute(
      `INSERT INTO entities (id, name, type) VALUES (1, 'E-1', 'ticket')`
    );
    await sourceAdapter.execute(
      `INSERT INTO entity_metadata (entity_id, key, value, value_type) VALUES (1, 'date_field', '2024-01-01T00:00:00Z', 'date')`
    );

    appRepo = new SqliteAppStateRepository(':memory:');
    await appRepo.migrate();
    initAppStateRepo(appRepo);

    presetId = await appRepo.savePreset('preset', emptyTree());
    vizId = await appRepo.saveVisualization('viz', null, presetId, CONFIG);
    dashboardId = await appRepo.saveDashboard('dash', [vizId]);

    // The card cache is a process-wide module singleton (by design — see
    // dashboardsHandler.tsx), so it outlives any single test. Each test gets
    // a fresh in-memory db whose ids restart from 1, which would otherwise
    // collide with a still-warm cache entry from a previous test using the
    // same vizId. Clear it so every test starts from a real cache miss,
    // exactly like a fresh server process would.
    invalidateCardCache();

    app = buildApp();
    getVisualizationCalls = spyOnGetVisualization(getAppStateRepo());
  });

  afterEach(async () => {
    await sourceAdapter.close();
    await appRepo.close();
  });

  async function fetchCards(): Promise<void> {
    const res = await app.request(`/api/dashboards/${dashboardId}/cards`);
    expect(res.status).toBe(200);
    const data = (await res.json()) as { cards: unknown[] };
    expect(data.cards).toHaveLength(1);
  }

  // Fetches once to (re)populate the cache, then asserts the fetch right
  // after `mutate` runs is a genuine cache miss (getVisualization count goes
  // up) and the one after that is a cache hit again (count holds steady).
  // Robust to a mutation handler making its own extra getVisualization
  // calls internally — only growth across the two post-mutation fetches
  // matters, not absolute totals.
  async function expectInvalidation(mutate: () => Promise<void>): Promise<void> {
    await fetchCards();
    const beforeMutation = getVisualizationCalls.calls;

    await mutate();

    await fetchCards();
    const afterFirstRefetch = getVisualizationCalls.calls;
    expect(afterFirstRefetch).toBeGreaterThan(beforeMutation);

    await fetchCards();
    expect(getVisualizationCalls.calls).toBe(afterFirstRefetch);
  }

  it('reuses the cached card across repeated requests', async () => {
    await fetchCards();
    expect(getVisualizationCalls.calls).toBe(1);
    await fetchCards();
    expect(getVisualizationCalls.calls).toBe(1);
  });

  it('invalidates on visualizationUpdateApiHandler', async () => {
    await expectInvalidation(async () => {
      const res = await app.request(`/api/visualizations/${vizId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'viz renamed',
          description: null,
          presetId,
          templateConfig: {
            templateId: 'throughput_over_time',
            slots: { dateField: 'date_field', timeBucket: 'month' },
          },
          layout: 'normal',
        }),
      });
      expect(res.status).toBe(200);
    });
  });

  it('invalidates on entityPresetsUpdateHandler', async () => {
    await expectInvalidation(async () => {
      const form = new FormData();
      form.append('name', 'preset renamed');
      form.append(
        'tree',
        encodeTree(makeGroup('AND', [makeLeaf('date_field', 'gte', '2000-01-01')]))
      );
      const res = await app.request(`/entities/presets/${presetId}`, {
        method: 'POST',
        body: form,
      });
      expect(res.status).toBe(302);
    });
  });

  it('invalidates on entityPresetsDeleteHandler', async () => {
    // Deletes an unrelated preset — not the one the test viz depends on,
    // since presets cascade-delete any visualization referencing them
    // (visualizations.dataset_id ... ON DELETE CASCADE), which would remove
    // the very card this test is trying to observe. Using an unrelated
    // preset instead demonstrates the actual (deliberately coarse) design:
    // invalidateCardCache() clears every cached card on ANY preset write,
    // not just ones scoped to the preset that changed.
    const otherPresetId = await appRepo.savePreset('other preset', emptyTree());

    await expectInvalidation(async () => {
      const res = await app.request(`/entities/presets/${otherPresetId}/delete`, {
        method: 'POST',
        body: new FormData(),
      });
      expect(res.status).toBe(302);
    });
  });

  it('invalidates on waymarkCreateApiHandler', async () => {
    let waymarkId!: number;
    await expectInvalidation(async () => {
      const res = await app.request(`/api/visualizations/${vizId}/waymarks`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          startDate: '2024-01-01',
          endDate: '2024-06-01',
          targetValue: 10,
          appliesTo: 'main',
          label: 'goal',
        }),
      });
      expect(res.status).toBe(200);
      ({ id: waymarkId } = (await res.json()) as { id: number });
    });
    await appRepo.deleteWaymark(waymarkId);
  });

  it('invalidates on waymarkUpdateApiHandler', async () => {
    const waymarkId = await appRepo.createWaymark(vizId, {
      startDate: '2024-01-01',
      endDate: '2024-06-01',
      targetValue: 10,
      appliesTo: 'main',
      label: 'goal',
    });

    await expectInvalidation(async () => {
      const res = await app.request(`/api/waymarks/${waymarkId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          startDate: '2024-01-01',
          endDate: '2024-06-01',
          targetValue: 20,
          appliesTo: 'main',
          label: 'goal updated',
        }),
      });
      expect(res.status).toBe(200);
    });
  });

  it('invalidates on waymarkDeleteApiHandler', async () => {
    const waymarkId = await appRepo.createWaymark(vizId, {
      startDate: '2024-01-01',
      endDate: '2024-06-01',
      targetValue: 10,
      appliesTo: 'main',
      label: 'goal',
    });

    await expectInvalidation(async () => {
      const res = await app.request(`/api/waymarks/${waymarkId}/delete`, { method: 'POST' });
      expect(res.status).toBe(204);
    });
  });
});
