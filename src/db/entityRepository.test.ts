import { describe, expect, it, beforeEach } from 'bun:test';
import { SqliteSourceAdapter } from './source/sqlite';
import { createEntityRepository } from './entityRepository';
import { emptyTree, makeGroup, makeLeaf } from '../schemas/filterTree';
import type { FilterTree } from '../schemas/filterTree';
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

  describe('eq on list-typed values (membership)', () => {
    const listMeta = (entityId: number, value: string) =>
      makeMetadata(entityId, { key: 'jira_tickets', value, value_type: 'list' });

    it('matches a mid-list element', async () => {
      await repo.upsert(makeEntity({ id: 1, name: 'PR-1' }), [
        listMeta(1, 'CM-123|CM-124|CAS-3|INFRA-1225'),
      ]);
      await repo.upsert(makeEntity({ id: 2, name: 'PR-2' }), [listMeta(2, 'LUMIO-9')]);
      const results = await repo.list(makeGroup('AND', [makeLeaf('jira_tickets', 'eq', 'CM-124')]));
      expect(results.map(r => r.id)).toEqual([1]);
    });

    it('matches whole elements only — CM does not match a CMS element', async () => {
      await repo.upsert(makeEntity({ id: 1, name: 'PR-1' }), [listMeta(1, 'CMS-1|OTHER-2')]);
      expect(await repo.list(makeGroup('AND', [makeLeaf('jira_tickets', 'eq', 'CM')]))).toEqual([]);
      expect(
        await repo.list(makeGroup('AND', [makeLeaf('jira_tickets', 'eq', 'CMS-1')]))
      ).toHaveLength(1);
    });

    it('escapes LIKE wildcards in requested values', async () => {
      await repo.upsert(makeEntity({ id: 1, name: 'PR-1' }), [listMeta(1, 'CMX1|A')]);
      await repo.upsert(makeEntity({ id: 2, name: 'PR-2' }), [listMeta(2, 'CM_1|B')]);
      const results = await repo.list(makeGroup('AND', [makeLeaf('jira_tickets', 'eq', 'CM_1')]));
      expect(results.map(r => r.id)).toEqual([2]);
    });

    it('multi-value eq matches when any requested value is a member', async () => {
      await repo.upsert(makeEntity({ id: 1, name: 'PR-1' }), [listMeta(1, 'CM-123|CAS-3')]);
      await repo.upsert(makeEntity({ id: 2, name: 'PR-2' }), [listMeta(2, 'INFRA-1225')]);
      const results = await repo.list(
        makeGroup('AND', [makeLeaf('jira_tickets', 'eq', ['ZZZ-1', 'CAS-3'])])
      );
      expect(results.map(r => r.id)).toEqual([1]);
    });

    it('empty eq array matches nothing', async () => {
      await repo.upsert(makeEntity({ id: 1, name: 'PR-1' }), [listMeta(1, 'CM-123')]);
      expect(await repo.list(makeGroup('AND', [makeLeaf('jira_tickets', 'eq', [])]))).toEqual([]);
    });

    it('scalar eq stays exact — a pipe in a string value is literal', async () => {
      await repo.upsert(makeEntity({ id: 1, name: 'A' }), [
        makeMetadata(1, { key: 'title', value: 'a|b', value_type: 'string' }),
      ]);
      expect(await repo.list(makeGroup('AND', [makeLeaf('title', 'eq', 'a')]))).toEqual([]);
      expect(await repo.list(makeGroup('AND', [makeLeaf('title', 'eq', 'a|b')]))).toHaveLength(1);
    });
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
    it('returns one page worth of entities and the total count', async () => {
      for (let id = 1; id <= 10; id++) {
        await repo.upsert(makeEntity({ id, name: `E-${id}`, type: 'jira_ticket' }), []);
      }
      const result = await repo.listPaged(emptyTree(), { limit: 3, offset: 0 });
      expect(result.total).toBe(10);
      expect(result.allIds).toBeUndefined();
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

    it('applies the filter tree to both the page and the total', async () => {
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
      // Regex populations are already materialised in JS — allIds rides along
      // so getAvailableFilters can narrow without a second pass.
      expect(result.allIds?.slice().sort()).toEqual([2, 4]);
    });
  });

  describe('listEntityTypes', () => {
    it('returns distinct types sorted, excluding blank', async () => {
      await repo.upsert(makeEntity({ id: 1, name: 'A', type: 'ticket' }), []);
      await repo.upsert(makeEntity({ id: 2, name: 'B', type: 'repo' }), []);
      await repo.upsert(makeEntity({ id: 3, name: 'C', type: 'ticket' }), []);
      await repo.upsert(makeEntity({ id: 4, name: 'D', type: '' }), []);
      expect(await repo.listEntityTypes()).toEqual(['repo', 'ticket']);
    });

    it('returns empty for an empty table', async () => {
      expect(await repo.listEntityTypes()).toEqual([]);
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

    it('enumerates sorted unique elements as distinctValues for a list key', async () => {
      await repo.upsert(makeEntity({ id: 1, name: 'PR-1' }), [
        makeMetadata(1, {
          key: 'jira_tickets',
          value: 'CM-124|CM-123|CAS-3',
          value_type: 'list',
        }),
      ]);
      await repo.upsert(makeEntity({ id: 2, name: 'PR-2' }), [
        makeMetadata(2, { key: 'jira_tickets', value: 'CM-123|INFRA-1225', value_type: 'list' }),
      ]);
      const entities = await repo.list(emptyTree());
      const available = await repo.getAvailableFilters(entities.map(e => e.id));
      const filter = available.find(f => f.key === 'jira_tickets');
      expect(filter?.value_type).toBe('list');
      expect(filter?.distinctValues).toEqual(['CAS-3', 'CM-123', 'CM-124', 'INFRA-1225']);
    });

    it('applies the distinct cap to the element count for list keys', async () => {
      const elements = Array.from({ length: 21 }, (_, i) => `T-${String(i + 1).padStart(2, '0')}`);
      await repo.upsert(makeEntity({ id: 1, name: 'PR-1' }), [
        makeMetadata(1, { key: 'jira_tickets', value: elements.join('|'), value_type: 'list' }),
      ]);
      const available = await repo.getAvailableFilters([1]);
      expect(available.find(f => f.key === 'jira_tickets')?.distinctValues).toBeUndefined();
      const uncapped = await repo.getAvailableFilters([1], { allDistinctValues: true });
      expect(uncapped.find(f => f.key === 'jira_tickets')?.distinctValues).toEqual(elements);
    });
  });

  describe('getAvailableFiltersForTree', () => {
    // Population diverse enough to exercise every aggregation branch: two
    // entity types sharing a key, a >20-distinct-value key, an exactly-20 key,
    // null values, and non-string value_types.
    const seedDiverse = async () => {
      for (let i = 1; i <= 25; i++) {
        await repo.upsert(makeEntity({ id: i, name: `T-${i}`, type: 'ticket' }), [
          makeMetadata(i, { key: 'tag', value: `tag-${String(i).padStart(2, '0')}` }),
          makeMetadata(i, {
            key: 'bucket',
            value: `bucket-${String(((i - 1) % 20) + 1).padStart(2, '0')}`,
          }),
          makeMetadata(i, { key: 'points', value: String(i), value_type: 'number' }),
          makeMetadata(i, { key: 'status', value: i % 2 === 0 ? 'open' : 'closed' }),
          makeMetadata(i, {
            key: 'linked',
            value: `CM-${(i % 3) + 1}|CAS-${(i % 2) + 1}`,
            value_type: 'list',
          }),
        ]);
      }
      for (let i = 1; i <= 5; i++) {
        await repo.upsert(makeEntity({ id: 25 + i, name: `R-${i}`, type: 'repo' }), [
          makeMetadata(25 + i, { key: 'status', value: i === 1 ? 'archived' : 'active' }),
          makeMetadata(25 + i, { key: 'starred', value: 'true', value_type: 'boolean' }),
          makeMetadata(25 + i, { key: 'last-push', value: `2026-0${i}-01`, value_type: 'date' }),
          makeMetadata(25 + i, { key: 'notes', value: null }),
        ]);
      }
    };

    const expectPathsAgree = async (tree: FilterTree, opts?: { allDistinctValues?: boolean }) => {
      const ids = (await repo.list(tree)).map(e => e.id);
      const fromTree = await repo.getAvailableFiltersForTree(tree, opts);
      expect(fromTree).toEqual(await repo.getAvailableFilters(ids, opts));
      return fromTree;
    };

    it('matches the id path on an unfiltered population', async () => {
      await seedDiverse();
      const available = await expectPathsAgree(emptyTree());
      expect(available.find(f => f.key === 'tag')?.distinctValues).toBeUndefined();
      expect(available.find(f => f.key === 'bucket')?.distinctValues).toHaveLength(20);
      expect(available.find(f => f.key === 'points')?.value_type).toBe('number');
      expect(available.find(f => f.key === 'points')?.distinctValues).toBeUndefined();
      expect(available.find(f => f.key === 'notes')).toBeUndefined();
      expect(available.filter(f => f.key === 'status').map(f => f.entityType)).toEqual([
        'repo',
        'ticket',
      ]);
    });

    it('matches the id path on a filtered population', async () => {
      await seedDiverse();
      const available = await expectPathsAgree(
        makeGroup('AND', [
          makeLeaf('entity_type', 'eq', 'ticket'),
          makeLeaf('status', 'eq', 'open'),
        ])
      );
      expect(available.find(f => f.key === 'starred')).toBeUndefined();
      expect(available.find(f => f.key === 'entity_type')?.distinctValues).toEqual(['ticket']);
    });

    it('matches the id path with the distinct-value cap lifted', async () => {
      await seedDiverse();
      const available = await expectPathsAgree(emptyTree(), { allDistinctValues: true });
      expect(available.find(f => f.key === 'tag')?.distinctValues).toHaveLength(25);
    });

    it('matches the id path for regex trees', async () => {
      await seedDiverse();
      await expectPathsAgree(makeGroup('AND', [makeLeaf('tag', 're', '^tag-0[1-3]$')]));
    });

    it('matches the id path for list keys and enumerates elements', async () => {
      await seedDiverse();
      const available = await expectPathsAgree(
        makeGroup('AND', [makeLeaf('entity_type', 'eq', 'ticket')])
      );
      const linked = available.find(f => f.key === 'linked');
      expect(linked?.value_type).toBe('list');
      expect(linked?.distinctValues).toEqual(['CAS-1', 'CAS-2', 'CM-1', 'CM-2', 'CM-3']);
    });

    it('matches the id path when the tree filters on a list key by membership', async () => {
      await seedDiverse();
      // i % 3 === 0 tickets carry CM-1 — a strict subset of the population.
      const available = await expectPathsAgree(
        makeGroup('AND', [makeLeaf('linked', 'eq', 'CM-1')])
      );
      expect(available.find(f => f.key === 'linked')).toBeDefined();
      expect(available.find(f => f.key === 'starred')).toBeUndefined();
    });

    it('returns [] when nothing matches', async () => {
      await seedDiverse();
      const tree = makeGroup('AND', [makeLeaf('status', 'eq', 'nonexistent')]);
      expect(await repo.getAvailableFiltersForTree(tree)).toEqual([]);
    });
  });

  describe('large id list — regression for Int16 wraparound bug', () => {
    // Per-id IN(?,...) placeholders fail past SQLite's 32 766-variable limit and
    // wrap the Postgres wire protocol's Int16 parameter count past 65 535 ids.
    it('getAvailableFilters accepts a 70 000-id population (both its queries)', async () => {
      const ID_COUNT = 70_000;
      await repo.upsert(makeEntity({ id: 1, name: 'A', type: 'ticket' }), [
        makeMetadata(1, { key: 'label', value: 'alpha', value_type: 'string' }),
      ]);
      await repo.upsert(makeEntity({ id: ID_COUNT, name: 'B', type: 'ticket' }), [
        makeMetadata(ID_COUNT, { key: 'label', value: 'beta', value_type: 'string' }),
      ]);
      const bigIdList = Array.from({ length: ID_COUNT }, (_, i) => i + 1);

      const available = await repo.getAvailableFilters(bigIdList);

      const labelFilter = available.find(f => f.key === 'label');
      expect(labelFilter?.distinctValues?.sort()).toEqual(['alpha', 'beta']);
      const typeFilter = available.find(f => f.key === 'entity_type');
      expect(typeFilter?.distinctValues).toEqual(['ticket']);
    });
  });
});
