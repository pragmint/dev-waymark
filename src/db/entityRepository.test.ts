import { describe, expect, it, beforeEach } from 'bun:test';
import { SqliteSourceAdapter } from './source/sqlite';
import { createEntityRepository } from './entityRepository';
import type { Entity, Metadata } from '../schemas/entity';

// Tests use in-memory SQLite with schema applied — same as the no-config default.

const makeEntity = (overrides: Partial<Entity> = {}): Entity => ({
  id: 1,
  name: 'ENG-1',
  ...overrides,
});

const makeMetadata = (entityId: number, overrides: Partial<Metadata> = {}): Metadata => ({
  entity_id: entityId,
  key: 'status',
  value: 'open',
  value_type: 'string',
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
    expect(await repo.list([])).toHaveLength(2);
  });

  it('list includes metadata for each entity', async () => {
    await repo.upsert(makeEntity(), [makeMetadata(1)]);
    const results = await repo.list([]);
    expect(results[0].metadata).toHaveLength(1);
    expect(results[0].metadata[0].key).toBe('status');
  });

  it('filters entities by metadata eq', async () => {
    await repo.upsert(makeEntity({ id: 1, name: 'J-1' }), [
      makeMetadata(1, { key: 'source', value: 'jira' }),
    ]);
    await repo.upsert(makeEntity({ id: 2, name: 'L-1' }), [
      makeMetadata(2, { key: 'source', value: 'linear' }),
    ]);
    const results = await repo.list([{ key: 'source', op: 'eq', value: 'jira' }]);
    expect(results).toHaveLength(1);
    expect(results[0].metadata.find(m => m.key === 'source')?.value).toBe('jira');
  });

  it('filters entities by metadata contains', async () => {
    await repo.upsert(makeEntity({ id: 1, name: 'J-1' }), [
      makeMetadata(1, { key: 'description', value: 'bartle-bee' }),
    ]);
    await repo.upsert(makeEntity({ id: 2, name: 'J-2' }), [
      makeMetadata(2, { key: 'description', value: 'other' }),
    ]);
    const results = await repo.list([{ key: 'description', op: 'contains', value: 'bartle' }]);
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
    const results = await repo.list([{ key: 'total-wip', op: 'gte', value: '30' }]);
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
    const results = await repo.list([{ key: 'total-wip', op: 'lte', value: '25' }]);
    expect(results).toHaveLength(1);
    expect(results[0].id).toBe(2);
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
    const results = await repo.list([
      { key: 'started-date', op: 'gte', value: '2026-02-09T00:00:00Z' },
      { key: 'started-date', op: 'lte', value: '2026-02-11T23:59:59Z' },
    ]);
    expect(results).toHaveLength(1);
    expect(results[0].id).toBe(1);
  });

  it('upserts without duplicating on re-insert', async () => {
    await repo.upsert(makeEntity(), [makeMetadata(1, { key: 'type', value: 'ticket' })]);
    await repo.upsert(makeEntity({ name: 'ENG-1-updated' }), [
      makeMetadata(1, { key: 'type', value: 'updated-type' }),
    ]);
    const results = await repo.list([]);
    expect(results).toHaveLength(1);
    expect(results[0].metadata.find(m => m.key === 'type')?.value).toBe('updated-type');
  });

  it('filters entities by multiple eq values on same key (OR / IN)', async () => {
    await repo.upsert(makeEntity({ id: 1, name: 'J-1' }), [
      makeMetadata(1, { key: 'source', value: 'jira' }),
    ]);
    await repo.upsert(makeEntity({ id: 2, name: 'L-1' }), [
      makeMetadata(2, { key: 'source', value: 'linear' }),
    ]);
    await repo.upsert(makeEntity({ id: 3, name: 'G-1' }), [
      makeMetadata(3, { key: 'source', value: 'github' }),
    ]);
    const results = await repo.list([
      { key: 'source', op: 'eq', value: 'jira' },
      { key: 'source', op: 'eq', value: 'linear' },
    ]);
    expect(results).toHaveLength(2);
    const sources = results.map(r => r.metadata.find(m => m.key === 'source')?.value).sort();
    expect(sources).toEqual(['jira', 'linear']);
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
    const results = await repo.list([{ key: 'description', op: 're', value: 'bartle' }]);
    expect(results).toHaveLength(2);
    expect(results.map(r => r.id).sort()).toEqual([1, 2]);
  });

  it('regex filter handles invalid patterns gracefully', async () => {
    await repo.upsert(makeEntity({ id: 1, name: 'A' }), [
      makeMetadata(1, { key: 'description', value: 'hello' }),
    ]);
    // Invalid regex pattern — should match nothing rather than throw
    const results = await repo.list([{ key: 'description', op: 're', value: '[invalid' }]);
    expect(results).toHaveLength(0);
  });

  describe('getAvailableFilters', () => {
    it('returns all metadata keys when no filters active', async () => {
      await repo.upsert(makeEntity({ id: 1, name: 'A' }), [
        makeMetadata(1, { key: 'source', value: 'jira', value_type: 'string' }),
        makeMetadata(1, { key: 'total-wip', value: '40', value_type: 'number' }),
      ]);
      await repo.upsert(makeEntity({ id: 2, name: 'B' }), [
        makeMetadata(2, { key: 'source', value: 'linear', value_type: 'string' }),
        makeMetadata(2, { key: 'description', value: 'foo', value_type: 'string' }),
      ]);
      const entities = await repo.list([]);
      const available = await repo.getAvailableFilters(entities.map(e => e.id));
      const keys = available.map(f => f.key).sort();
      expect(keys).toContain('source');
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

      // Filter to only entity A (started-date within Feb 9–11)
      const entities = await repo.list([
        { key: 'started-date', op: 'gte', value: '2026-02-09T00:00:00Z' },
        { key: 'started-date', op: 'lte', value: '2026-02-11T23:59:59Z' },
      ]);
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

      const entities = await repo.list([{ key: 'description', op: 're', value: 'bartle' }]);
      const available = await repo.getAvailableFilters(entities.map(e => e.id));

      const keys = available.map(f => f.key);
      expect(keys).toContain('description');
      expect(keys).toContain('tag');
      expect(keys).not.toContain('priority');
    });

    it('populates distinctValues for string keys with ≤20 values', async () => {
      await repo.upsert(makeEntity({ id: 1, name: 'J-1' }), [
        makeMetadata(1, { key: 'source', value: 'jira', value_type: 'string' }),
      ]);
      await repo.upsert(makeEntity({ id: 2, name: 'L-1' }), [
        makeMetadata(2, { key: 'source', value: 'linear', value_type: 'string' }),
      ]);
      const entities = await repo.list([]);
      const available = await repo.getAvailableFilters(entities.map(e => e.id));
      const sourceFilter = available.find(f => f.key === 'source');
      expect(sourceFilter?.distinctValues).toEqual(['jira', 'linear']);
    });

    it('sets correct value_type for each key', async () => {
      await repo.upsert(makeEntity({ id: 1, name: 'X' }), [
        makeMetadata(1, { key: 'num-field', value: '42', value_type: 'number' }),
        makeMetadata(1, { key: 'date-field', value: '2026-01-01', value_type: 'date' }),
        makeMetadata(1, { key: 'bool-field', value: 'true', value_type: 'boolean' }),
      ]);
      const entities = await repo.list([]);
      const available = await repo.getAvailableFilters(entities.map(e => e.id));
      expect(available.find(f => f.key === 'num-field')?.value_type).toBe('number');
      expect(available.find(f => f.key === 'date-field')?.value_type).toBe('date');
      expect(available.find(f => f.key === 'bool-field')?.value_type).toBe('boolean');
    });
  });
});
