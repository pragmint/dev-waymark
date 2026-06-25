import { describe, expect, it, beforeEach } from 'bun:test';
import { SqliteSourceAdapter } from './source/sqlite';
import { createEntityRepository } from './entityRepository';
import { emptyTree, makeGroup, makeLeaf } from '../schemas/filterTree';
import type { Entity, Metadata } from '../schemas/entity';

// Tests use in-memory SQLite with schema applied — same as the no-config default.

const makeEntity = (overrides: Partial<Entity> = {}): Entity => ({
  id: 1,
  name: 'ENG-1',
  type: '',
  created_at: '',
  ...overrides,
});

const makeMetadata = (entityId: number, overrides: Partial<Metadata> = {}): Metadata => ({
  entity_id: entityId,
  key: 'status',
  value: 'open',
  value_type: 'string',
  created_at: '',
  updated_at: '',
  ...overrides,
});

describe('entityRepository', () => {
  let adapter: SqliteSourceAdapter;
  let repo: ReturnType<typeof createEntityRepository>;

  beforeEach(() => {
    adapter = new SqliteSourceAdapter(':memory:', true);
    repo = createEntityRepository(adapter);
  });

  it('inserts and retrieves an entity by id', async () => {
    await repo.upsert(makeEntity(), []);
    const result = await repo.get(1);
    expect(result).not.toBeNull();
    expect(result?.name).toBe('ENG-1');
    expect(result?.metadata).toHaveLength(0);
  });

  it('retrieves an entity with metadata', async () => {
    await repo.upsert(makeEntity(), [makeMetadata(1)]);
    const result = await repo.get(1);
    expect(result?.metadata).toHaveLength(1);
    expect(result?.metadata[0].key).toBe('status');
    expect(result?.metadata[0].value).toBe('open');
  });

  it('returns null for unknown id', async () => {
    expect(await repo.get(999)).toBeNull();
  });

  it('lists all entities', async () => {
    await repo.upsert(makeEntity({ id: 1, name: 'A-1' }), []);
    await repo.upsert(makeEntity({ id: 2, name: 'B-1' }), []);
    expect(await repo.list(emptyTree())).toHaveLength(2);
  });

  it('list includes metadata for each entity', async () => {
    await repo.upsert(makeEntity(), [makeMetadata(1)]);
    const results = await repo.list(emptyTree());
    expect(results[0].metadata).toHaveLength(1);
    expect(results[0].metadata[0].key).toBe('status');
  });

  it('filters entities by metadata eq', async () => {
    await repo.upsert(makeEntity({ id: 1, name: 'J-1' }), [
      makeMetadata(1, { key: 'ticket_type', value: 'Story' }),
    ]);
    await repo.upsert(makeEntity({ id: 2, name: 'L-1' }), [
      makeMetadata(2, { key: 'ticket_type', value: 'Bug' }),
    ]);
    const results = await repo.list(makeGroup('AND', [makeLeaf('ticket_type', 'eq', 'Story')]));
    expect(results).toHaveLength(1);
    expect(results[0].metadata.find(m => m.key === 'ticket_type')?.value).toBe('Story');
  });

  it('filters entities by metadata contains', async () => {
    await repo.upsert(makeEntity({ id: 1, name: 'J-1' }), [
      makeMetadata(1, { key: 'description', value: 'bartle-bee' }),
    ]);
    await repo.upsert(makeEntity({ id: 2, name: 'J-2' }), [
      makeMetadata(2, { key: 'description', value: 'other' }),
    ]);
    const results = await repo.list(
      makeGroup('AND', [makeLeaf('description', 'contains', 'bartle')])
    );
    expect(results).toHaveLength(1);
    expect(results[0].id).toBe(1);
  });

  it('filters entities by numeric metadata gte', async () => {
    await repo.upsert(makeEntity({ id: 1, name: 'A' }), [
      makeMetadata(1, { key: 'total-wip', value: '40', value_type: 'number' }),
    ]);
    await repo.upsert(makeEntity({ id: 2, name: 'B' }), [
      makeMetadata(2, { key: 'total-wip', value: '20', value_type: 'number' }),
    ]);
    const results = await repo.list(makeGroup('AND', [makeLeaf('total-wip', 'gte', '30')]));
    expect(results).toHaveLength(1);
    expect(results[0].id).toBe(1);
  });

  it('filters entities by numeric metadata lte', async () => {
    await repo.upsert(makeEntity({ id: 1, name: 'A' }), [
      makeMetadata(1, { key: 'total-wip', value: '40', value_type: 'number' }),
    ]);
    await repo.upsert(makeEntity({ id: 2, name: 'B' }), [
      makeMetadata(2, { key: 'total-wip', value: '20', value_type: 'number' }),
    ]);
    const results = await repo.list(makeGroup('AND', [makeLeaf('total-wip', 'lte', '25')]));
    expect(results).toHaveLength(1);
    expect(results[0].id).toBe(2);
  });

  it('treats an empty-value date filter as IS NULL on metadata', async () => {
    // Entity 1 has a value, entity 2 has the key with an explicit null,
    // entity 3 has no row for the key at all. Only 2 and 3 should match.
    await repo.upsert(makeEntity({ id: 1, name: 'A' }), [
      makeMetadata(1, { key: 'started-date', value: '2026-02-11', value_type: 'date' }),
    ]);
    await repo.upsert(makeEntity({ id: 2, name: 'B' }), [
      makeMetadata(2, { key: 'started-date', value: null, value_type: 'date' }),
    ]);
    await repo.upsert(makeEntity({ id: 3, name: 'C' }), []);
    const results = await repo.list(makeGroup('AND', [makeLeaf('started-date', 'gte', '')]));
    const ids = results.map(r => r.id).sort();
    expect(ids).toEqual([2, 3]);
  });

  it('filters entities by date metadata range', async () => {
    await repo.upsert(makeEntity({ id: 1, name: 'A' }), [
      makeMetadata(1, {
        key: 'started-date',
        value: '2026-02-11T16:42:13Z',
        value_type: 'date',
      }),
    ]);
    await repo.upsert(makeEntity({ id: 2, name: 'C' }), [
      makeMetadata(2, {
        key: 'started-date',
        value: '2026-02-12T16:42:13Z',
        value_type: 'date',
      }),
    ]);
    const results = await repo.list(
      makeGroup('AND', [
        makeLeaf('started-date', 'gte', '2026-02-09T00:00:00Z'),
        makeLeaf('started-date', 'lte', '2026-02-11T23:59:59Z'),
      ])
    );
    expect(results).toHaveLength(1);
    expect(results[0].id).toBe(1);
  });

  it('upserts without duplicating on re-insert', async () => {
    await repo.upsert(makeEntity({ type: 'ticket' }), [makeMetadata(1)]);
    await repo.upsert(makeEntity({ name: 'ENG-1-updated', type: 'updated-type' }), [
      makeMetadata(1, { value: 'closed' }),
    ]);
    const results = await repo.list(emptyTree());
    expect(results).toHaveLength(1);
    expect(results[0].type).toBe('updated-type');
    expect(results[0].metadata.find(m => m.key === 'status')?.value).toBe('closed');
  });

  it('filters entities by multi-value eq (IN clause)', async () => {
    await repo.upsert(makeEntity({ id: 1, name: 'J-1' }), [
      makeMetadata(1, { key: 'ticket_type', value: 'Story' }),
    ]);
    await repo.upsert(makeEntity({ id: 2, name: 'L-1' }), [
      makeMetadata(2, { key: 'ticket_type', value: 'Bug' }),
    ]);
    await repo.upsert(makeEntity({ id: 3, name: 'G-1' }), [
      makeMetadata(3, { key: 'ticket_type', value: 'Task' }),
    ]);
    const results = await repo.list(
      makeGroup('AND', [makeLeaf('ticket_type', 'eq', ['Story', 'Bug'])])
    );
    expect(results).toHaveLength(2);
    const types = results.map(r => r.metadata.find(m => m.key === 'ticket_type')?.value).sort();
    expect(types).toEqual(['Bug', 'Story']);
  });

  it('combines filters with OR at a group', async () => {
    await repo.upsert(makeEntity({ id: 1, name: 'A' }), [
      makeMetadata(1, { key: 'owner', value: 'Dave' }),
      makeMetadata(1, { key: 'priority', value: 'low' }),
    ]);
    await repo.upsert(makeEntity({ id: 2, name: 'B' }), [
      makeMetadata(2, { key: 'owner', value: 'Sam' }),
      makeMetadata(2, { key: 'priority', value: 'high' }),
    ]);
    await repo.upsert(makeEntity({ id: 3, name: 'C' }), [
      makeMetadata(3, { key: 'owner', value: 'Alex' }),
      makeMetadata(3, { key: 'priority', value: 'low' }),
    ]);
    const tree = makeGroup('OR', [
      makeLeaf('owner', 'eq', 'Dave'),
      makeLeaf('priority', 'eq', 'high'),
    ]);
    const results = await repo.list(tree);
    expect(results.map(r => r.id).sort()).toEqual([1, 2]);
  });

  it('combines AND with nested OR groups', async () => {
    await repo.upsert(makeEntity({ id: 1, name: 'A', type: 'svc' }), [
      makeMetadata(1, { key: 'owner', value: 'Dave' }),
    ]);
    await repo.upsert(makeEntity({ id: 2, name: 'B', type: 'svc' }), [
      makeMetadata(2, { key: 'owner', value: 'Sam' }),
    ]);
    await repo.upsert(makeEntity({ id: 3, name: 'C', type: 'lib' }), [
      makeMetadata(3, { key: 'owner', value: 'Dave' }),
    ]);
    const tree = makeGroup('AND', [
      makeLeaf('entity_type', 'eq', 'svc'),
      makeGroup('OR', [makeLeaf('owner', 'eq', 'Dave'), makeLeaf('owner', 'eq', 'Sam')]),
    ]);
    const results = await repo.list(tree);
    expect(results.map(r => r.id).sort()).toEqual([1, 2]);
  });

  it('filters entities by regex', async () => {
    await repo.upsert(makeEntity({ id: 1, name: 'A' }), [
      makeMetadata(1, { key: 'description', value: 'bartle-bee' }),
    ]);
    await repo.upsert(makeEntity({ id: 2, name: 'B' }), [
      makeMetadata(2, { key: 'description', value: 'bartledoo' }),
    ]);
    await repo.upsert(makeEntity({ id: 3, name: 'C' }), [
      makeMetadata(3, { key: 'description', value: 'unrelated' }),
    ]);
    const results = await repo.list(makeGroup('AND', [makeLeaf('description', 're', 'bartle')]));
    expect(results).toHaveLength(2);
    expect(results.map(r => r.id).sort()).toEqual([1, 2]);
  });

  it('regex filter handles invalid patterns gracefully', async () => {
    await repo.upsert(makeEntity({ id: 1, name: 'A' }), [
      makeMetadata(1, { key: 'description', value: 'hello' }),
    ]);
    const results = await repo.list(makeGroup('AND', [makeLeaf('description', 're', '[invalid')]));
    expect(results).toHaveLength(0);
  });

  it('NOT excludes matching entities', async () => {
    await repo.upsert(makeEntity({ id: 1, name: 'A' }), [
      makeMetadata(1, { key: 'owner', value: 'Dave' }),
    ]);
    await repo.upsert(makeEntity({ id: 2, name: 'B' }), [
      makeMetadata(2, { key: 'owner', value: 'Sam' }),
    ]);
    const tree = makeGroup('AND', [makeGroup('NOT', [makeLeaf('owner', 'eq', 'Dave')])]);
    const results = await repo.list(tree);
    expect(results.map(r => r.id)).toEqual([2]);
  });

  it('NOT around a nested group inverts the group result', async () => {
    await repo.upsert(makeEntity({ id: 1, name: 'A' }), [
      makeMetadata(1, { key: 'owner', value: 'Dave' }),
      makeMetadata(1, { key: 'priority', value: 'low' }),
    ]);
    await repo.upsert(makeEntity({ id: 2, name: 'B' }), [
      makeMetadata(2, { key: 'owner', value: 'Sam' }),
      makeMetadata(2, { key: 'priority', value: 'high' }),
    ]);
    await repo.upsert(makeEntity({ id: 3, name: 'C' }), [
      makeMetadata(3, { key: 'owner', value: 'Alex' }),
      makeMetadata(3, { key: 'priority', value: 'low' }),
    ]);
    // NOT(owner = Dave OR priority = high) → keeps only C.
    const tree = makeGroup('AND', [
      makeGroup('NOT', [
        makeGroup('OR', [makeLeaf('owner', 'eq', 'Dave'), makeLeaf('priority', 'eq', 'high')]),
      ]),
    ]);
    const results = await repo.list(tree);
    expect(results.map(r => r.id)).toEqual([3]);
  });

  it('NOT around a regex leaf narrows via JS post-filter', async () => {
    await repo.upsert(makeEntity({ id: 1, name: 'A' }), [
      makeMetadata(1, { key: 'description', value: 'bartle-bee' }),
    ]);
    await repo.upsert(makeEntity({ id: 2, name: 'B' }), [
      makeMetadata(2, { key: 'description', value: 'unrelated' }),
    ]);
    const tree = makeGroup('AND', [makeGroup('NOT', [makeLeaf('description', 're', 'bartle')])]);
    const results = await repo.list(tree);
    expect(results.map(r => r.id)).toEqual([2]);
  });

  it('combines regex with OR against a non-regex filter', async () => {
    await repo.upsert(makeEntity({ id: 1, name: 'A' }), [
      makeMetadata(1, { key: 'description', value: 'bartle-bee' }),
      makeMetadata(1, { key: 'priority', value: 'low' }),
    ]);
    await repo.upsert(makeEntity({ id: 2, name: 'B' }), [
      makeMetadata(2, { key: 'description', value: 'unrelated' }),
      makeMetadata(2, { key: 'priority', value: 'high' }),
    ]);
    await repo.upsert(makeEntity({ id: 3, name: 'C' }), [
      makeMetadata(3, { key: 'description', value: 'unrelated' }),
      makeMetadata(3, { key: 'priority', value: 'low' }),
    ]);
    const tree = makeGroup('OR', [
      makeLeaf('description', 're', 'bartle'),
      makeLeaf('priority', 'eq', 'high'),
    ]);
    const results = await repo.list(tree);
    expect(results.map(r => r.id).sort()).toEqual([1, 2]);
  });

  describe('listPaged', () => {
    it('returns one page worth of entities, the full id set, and total count', async () => {
      for (let id = 1; id <= 10; id++) {
        await repo.upsert(makeEntity({ id, name: `E-${id}`, type: 'jira_ticket' }), []);
      }
      const result = await repo.listPaged(emptyTree(), { limit: 3, offset: 0 });
      expect(result.total).toBe(10);
      expect(result.allIds).toHaveLength(10);
      expect(result.pageEntities).toHaveLength(3);
      // Default ordering is id DESC, so page 1 should contain ids 10, 9, 8.
      expect(result.pageEntities.map(e => e.id)).toEqual([10, 9, 8]);
    });

    it('respects offset for subsequent pages', async () => {
      for (let id = 1; id <= 10; id++) {
        await repo.upsert(makeEntity({ id, name: `E-${id}`, type: 'jira_ticket' }), []);
      }
      const result = await repo.listPaged(emptyTree(), { limit: 3, offset: 3 });
      expect(result.pageEntities.map(e => e.id)).toEqual([7, 6, 5]);
    });

    it('returns empty page beyond end without error', async () => {
      for (let id = 1; id <= 3; id++) {
        await repo.upsert(makeEntity({ id, name: `E-${id}` }), []);
      }
      const result = await repo.listPaged(emptyTree(), { limit: 10, offset: 50 });
      expect(result.pageEntities).toHaveLength(0);
      expect(result.total).toBe(3);
    });

    it('paginates while preserving filter narrowing for getAvailableFilters', async () => {
      await repo.upsert(makeEntity({ id: 1, name: 'A', type: 'jira_ticket' }), [
        makeMetadata(1, { key: 'ticket_type', value: 'Story' }),
      ]);
      await repo.upsert(makeEntity({ id: 2, name: 'B', type: 'jira_ticket' }), [
        makeMetadata(2, { key: 'ticket_type', value: 'Story' }),
      ]);
      await repo.upsert(makeEntity({ id: 3, name: 'C', type: 'jira_ticket' }), [
        makeMetadata(3, { key: 'ticket_type', value: 'Bug' }),
      ]);
      const result = await repo.listPaged(
        makeGroup('AND', [makeLeaf('ticket_type', 'eq', 'Story')]),
        { limit: 1, offset: 0 }
      );
      expect(result.pageEntities).toHaveLength(1);
      expect(result.allIds.sort()).toEqual([1, 2]);
      expect(result.total).toBe(2);
    });

    it('applies regex filters before paginating', async () => {
      for (let id = 1; id <= 5; id++) {
        await repo.upsert(makeEntity({ id, name: `E-${id}` }), [
          makeMetadata(id, { key: 'tag', value: id % 2 === 0 ? 'even' : 'odd' }),
        ]);
      }
      const result = await repo.listPaged(makeGroup('AND', [makeLeaf('tag', 're', '^even$')]), {
        limit: 10,
        offset: 0,
      });
      expect(result.total).toBe(2);
      expect(result.pageEntities.map(e => e.id).sort()).toEqual([2, 4]);
    });
  });

  describe('getAvailableFilters', () => {
    it('returns all metadata keys when no filters active', async () => {
      await repo.upsert(makeEntity({ id: 1, name: 'A' }), [
        makeMetadata(1, { key: 'ticket_type', value: 'Story', value_type: 'string' }),
        makeMetadata(1, { key: 'total-wip', value: '40', value_type: 'number' }),
      ]);
      await repo.upsert(makeEntity({ id: 2, name: 'B' }), [
        makeMetadata(2, { key: 'ticket_type', value: 'Bug', value_type: 'string' }),
        makeMetadata(2, { key: 'description', value: 'foo', value_type: 'string' }),
      ]);
      const entities = await repo.list(emptyTree());
      const available = await repo.getAvailableFilters(entities.map(e => e.id));
      const keys = available.map(f => f.key).sort();
      expect(keys).toContain('ticket_type');
      expect(keys).toContain('total-wip');
      expect(keys).toContain('description');
    });

    it('returns only keys from matched entities after filtering', async () => {
      await repo.upsert(makeEntity({ id: 1, name: 'A' }), [
        makeMetadata(1, {
          key: 'started-date',
          value: '2026-02-11T00:00:00Z',
          value_type: 'date',
        }),
        makeMetadata(1, { key: 'description', value: 'bartle-bee', value_type: 'string' }),
      ]);
      await repo.upsert(makeEntity({ id: 2, name: 'B' }), [
        makeMetadata(2, { key: 'total-wip', value: '40', value_type: 'number' }),
        makeMetadata(2, { key: 'description', value: 'bartledoo', value_type: 'string' }),
      ]);
      await repo.upsert(makeEntity({ id: 3, name: 'C' }), [
        makeMetadata(3, {
          key: 'started-date',
          value: '2026-02-12T00:00:00Z',
          value_type: 'date',
        }),
        makeMetadata(3, { key: 'total-wip', value: '20', value_type: 'number' }),
      ]);

      const entities = await repo.list(
        makeGroup('AND', [
          makeLeaf('started-date', 'gte', '2026-02-09T00:00:00Z'),
          makeLeaf('started-date', 'lte', '2026-02-11T23:59:59Z'),
        ])
      );
      const available = await repo.getAvailableFilters(entities.map(e => e.id));

      const keys = available.map(f => f.key);
      expect(keys).toContain('started-date');
      expect(keys).toContain('description');
      expect(keys).not.toContain('total-wip');
    });

    it('returns only keys from entities matched by regex filter', async () => {
      await repo.upsert(makeEntity({ id: 1, name: 'A' }), [
        makeMetadata(1, { key: 'description', value: 'bartle-bee', value_type: 'string' }),
        makeMetadata(1, { key: 'tag', value: 'alpha', value_type: 'string' }),
      ]);
      await repo.upsert(makeEntity({ id: 2, name: 'B' }), [
        makeMetadata(2, { key: 'description', value: 'unrelated', value_type: 'string' }),
        makeMetadata(2, { key: 'priority', value: 'high', value_type: 'string' }),
      ]);

      const entities = await repo.list(makeGroup('AND', [makeLeaf('description', 're', 'bartle')]));
      const available = await repo.getAvailableFilters(entities.map(e => e.id));

      const keys = available.map(f => f.key);
      expect(keys).toContain('description');
      expect(keys).toContain('tag');
      expect(keys).not.toContain('priority');
    });

    it('populates distinctValues for string keys with ≤20 values', async () => {
      await repo.upsert(makeEntity({ id: 1, name: 'J-1' }), [
        makeMetadata(1, { key: 'ticket_type', value: 'Story', value_type: 'string' }),
      ]);
      await repo.upsert(makeEntity({ id: 2, name: 'L-1' }), [
        makeMetadata(2, { key: 'ticket_type', value: 'Bug', value_type: 'string' }),
      ]);
      const entities = await repo.list(emptyTree());
      const available = await repo.getAvailableFilters(entities.map(e => e.id));
      const typeFilter = available.find(f => f.key === 'ticket_type');
      expect(typeFilter?.distinctValues).toEqual(['Bug', 'Story']);
    });

    it('sets correct value_type for each key', async () => {
      await repo.upsert(makeEntity({ id: 1, name: 'X' }), [
        makeMetadata(1, { key: 'num-field', value: '42', value_type: 'number' }),
        makeMetadata(1, { key: 'date-field', value: '2026-01-01', value_type: 'date' }),
        makeMetadata(1, { key: 'bool-field', value: 'true', value_type: 'boolean' }),
      ]);
      const entities = await repo.list(emptyTree());
      const available = await repo.getAvailableFilters(entities.map(e => e.id));
      expect(available.find(f => f.key === 'num-field')?.value_type).toBe('number');
      expect(available.find(f => f.key === 'date-field')?.value_type).toBe('date');
      expect(available.find(f => f.key === 'bool-field')?.value_type).toBe('boolean');
    });
  });
});
