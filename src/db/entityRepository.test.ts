import { describe, expect, it, beforeEach } from 'bun:test';
import { Database } from 'bun:sqlite';
import { createEntityRepository } from './entityRepository';
import { runMigrations } from './migrate';
import type { Entity, Metadata } from '../schemas/entity';

const makeEntity = (overrides: Partial<Entity> = {}): Entity => ({
  id: 'e1',
  source_id: 'PROJ-1',
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
  ...overrides,
});

const makeMetadata = (entityId: string, overrides: Partial<Metadata> = {}): Metadata => ({
  entity_id: entityId,
  key: 'status',
  value: 'open',
  value_type: 'string',
  ...overrides,
});

describe('entityRepository', () => {
  let db: Database;
  let repo: ReturnType<typeof createEntityRepository>;

  beforeEach(() => {
    db = new Database(':memory:');
    db.exec('PRAGMA foreign_keys = ON;');
    runMigrations(db);
    repo = createEntityRepository(db);
  });

  it('inserts and retrieves an entity by id', () => {
    repo.upsert(makeEntity(), []);
    const result = repo.get('e1');
    expect(result).not.toBeNull();
    expect(result?.source_id).toBe('PROJ-1');
    expect(result?.metadata).toHaveLength(0);
  });

  it('retrieves an entity with metadata', () => {
    repo.upsert(makeEntity(), [makeMetadata('e1')]);
    const result = repo.get('e1');
    expect(result?.metadata).toHaveLength(1);
    expect(result?.metadata[0].key).toBe('status');
    expect(result?.metadata[0].value).toBe('open');
  });

  it('returns null for unknown id', () => {
    expect(repo.get('does-not-exist')).toBeNull();
  });

  it('lists all entities', () => {
    repo.upsert(makeEntity({ id: 'a', source_id: 'A-1' }), []);
    repo.upsert(makeEntity({ id: 'b', source_id: 'B-1' }), []);
    expect(repo.list([], {})).toHaveLength(2);
  });

  it('list includes metadata for each entity', () => {
    repo.upsert(makeEntity(), [makeMetadata('e1')]);
    const results = repo.list([], {});
    expect(results[0].metadata).toHaveLength(1);
    expect(results[0].metadata[0].key).toBe('status');
  });

  it('filters entities by metadata eq', () => {
    repo.upsert(makeEntity({ id: 'j1', source_id: 'J-1' }), [
      makeMetadata('j1', { key: 'source', value: 'jira' }),
    ]);
    repo.upsert(makeEntity({ id: 'l1', source_id: 'L-1' }), [
      makeMetadata('l1', { key: 'source', value: 'linear' }),
    ]);
    const results = repo.list([{ key: 'source', op: 'eq', value: 'jira' }], {});
    expect(results).toHaveLength(1);
    expect(results[0].metadata.find(m => m.key === 'source')?.value).toBe('jira');
  });

  it('filters entities by metadata contains', () => {
    repo.upsert(makeEntity({ id: 'j1', source_id: 'J-1' }), [
      makeMetadata('j1', { key: 'description', value: 'bartle-bee' }),
    ]);
    repo.upsert(makeEntity({ id: 'j2', source_id: 'J-2' }), [
      makeMetadata('j2', { key: 'description', value: 'other' }),
    ]);
    const results = repo.list([{ key: 'description', op: 'contains', value: 'bartle' }], {});
    expect(results).toHaveLength(1);
    expect(results[0].id).toBe('j1');
  });

  it('filters entities by numeric metadata gte', () => {
    repo.upsert(makeEntity({ id: 'a', source_id: 'A' }), [
      makeMetadata('a', { key: 'total-wip', value: '40', value_type: 'number' }),
    ]);
    repo.upsert(makeEntity({ id: 'b', source_id: 'B' }), [
      makeMetadata('b', { key: 'total-wip', value: '20', value_type: 'number' }),
    ]);
    const results = repo.list([{ key: 'total-wip', op: 'gte', value: '30' }], {});
    expect(results).toHaveLength(1);
    expect(results[0].id).toBe('a');
  });

  it('filters entities by numeric metadata lte', () => {
    repo.upsert(makeEntity({ id: 'a', source_id: 'A' }), [
      makeMetadata('a', { key: 'total-wip', value: '40', value_type: 'number' }),
    ]);
    repo.upsert(makeEntity({ id: 'b', source_id: 'B' }), [
      makeMetadata('b', { key: 'total-wip', value: '20', value_type: 'number' }),
    ]);
    const results = repo.list([{ key: 'total-wip', op: 'lte', value: '25' }], {});
    expect(results).toHaveLength(1);
    expect(results[0].id).toBe('b');
  });

  it('filters entities by date metadata range', () => {
    repo.upsert(makeEntity({ id: 'a', source_id: 'A' }), [
      makeMetadata('a', {
        key: 'started-date',
        value: '2026-02-11T16:42:13Z',
        value_type: 'date',
      }),
    ]);
    repo.upsert(makeEntity({ id: 'c', source_id: 'C' }), [
      makeMetadata('c', {
        key: 'started-date',
        value: '2026-02-12T16:42:13Z',
        value_type: 'date',
      }),
    ]);
    const results = repo.list(
      [
        { key: 'started-date', op: 'gte', value: '2026-02-09T00:00:00Z' },
        { key: 'started-date', op: 'lte', value: '2026-02-11T23:59:59Z' },
      ],
      {}
    );
    expect(results).toHaveLength(1);
    expect(results[0].id).toBe('a');
  });

  it('upserts without duplicating on re-insert', () => {
    repo.upsert(makeEntity(), [makeMetadata('e1', { key: 'type', value: 'ticket' })]);
    repo.upsert(makeEntity(), [makeMetadata('e1', { key: 'type', value: 'updated-type' })]);
    const results = repo.list([], {});
    expect(results).toHaveLength(1);
    expect(results[0].metadata.find(m => m.key === 'type')?.value).toBe('updated-type');
  });

  it('filters entities by created_at from date', () => {
    repo.upsert(
      makeEntity({ id: 'old', source_id: 'OLD', created_at: '2026-01-01T00:00:00Z' }),
      []
    );
    repo.upsert(
      makeEntity({ id: 'new', source_id: 'NEW', created_at: '2026-06-01T00:00:00Z' }),
      []
    );
    const results = repo.list([], { from: '2026-03-01T00:00:00Z' });
    expect(results).toHaveLength(1);
    expect(results[0].id).toBe('new');
  });

  it('filters entities by created_at to date', () => {
    repo.upsert(
      makeEntity({ id: 'old', source_id: 'OLD', created_at: '2026-01-01T00:00:00Z' }),
      []
    );
    repo.upsert(
      makeEntity({ id: 'new', source_id: 'NEW', created_at: '2026-06-01T00:00:00Z' }),
      []
    );
    const results = repo.list([], { to: '2026-03-01T00:00:00Z' });
    expect(results).toHaveLength(1);
    expect(results[0].id).toBe('old');
  });

  it('filters entities by multiple eq values on same key (OR / IN)', () => {
    repo.upsert(makeEntity({ id: 'j1', source_id: 'J-1' }), [
      makeMetadata('j1', { key: 'source', value: 'jira' }),
    ]);
    repo.upsert(makeEntity({ id: 'l1', source_id: 'L-1' }), [
      makeMetadata('l1', { key: 'source', value: 'linear' }),
    ]);
    repo.upsert(makeEntity({ id: 'g1', source_id: 'G-1' }), [
      makeMetadata('g1', { key: 'source', value: 'github' }),
    ]);
    const results = repo.list(
      [
        { key: 'source', op: 'eq', value: 'jira' },
        { key: 'source', op: 'eq', value: 'linear' },
      ],
      {}
    );
    expect(results).toHaveLength(2);
    const sources = results.map(r => r.metadata.find(m => m.key === 'source')?.value).sort();
    expect(sources).toEqual(['jira', 'linear']);
  });

  it('filters entities by regex', () => {
    repo.upsert(makeEntity({ id: 'a', source_id: 'A' }), [
      makeMetadata('a', { key: 'description', value: 'bartle-bee' }),
    ]);
    repo.upsert(makeEntity({ id: 'b', source_id: 'B' }), [
      makeMetadata('b', { key: 'description', value: 'bartledoo' }),
    ]);
    repo.upsert(makeEntity({ id: 'c', source_id: 'C' }), [
      makeMetadata('c', { key: 'description', value: 'unrelated' }),
    ]);
    const results = repo.list([{ key: 'description', op: 're', value: 'bartle' }], {});
    expect(results).toHaveLength(2);
    expect(results.map(r => r.id).sort()).toEqual(['a', 'b']);
  });

  it('regex filter handles invalid patterns gracefully', () => {
    repo.upsert(makeEntity({ id: 'a', source_id: 'A' }), [
      makeMetadata('a', { key: 'description', value: 'hello' }),
    ]);
    // Invalid regex pattern — should match nothing rather than throw
    const results = repo.list([{ key: 'description', op: 're', value: '[invalid' }], {});
    expect(results).toHaveLength(0);
  });

  describe('getAvailableFilters', () => {
    it('returns all metadata keys when no filters active', () => {
      repo.upsert(makeEntity({ id: 'a' }), [
        makeMetadata('a', { key: 'source', value: 'jira', value_type: 'string' }),
        makeMetadata('a', { key: 'total-wip', value: '40', value_type: 'number' }),
      ]);
      repo.upsert(makeEntity({ id: 'b' }), [
        makeMetadata('b', { key: 'source', value: 'linear', value_type: 'string' }),
        makeMetadata('b', { key: 'description', value: 'foo', value_type: 'string' }),
      ]);
      const entities = repo.list([], {});
      const available = repo.getAvailableFilters(entities.map(e => e.id));
      const keys = available.map(f => f.key).sort();
      expect(keys).toContain('source');
      expect(keys).toContain('total-wip');
      expect(keys).toContain('description');
    });

    it('returns only keys from matched entities after filtering', () => {
      repo.upsert(makeEntity({ id: 'a' }), [
        makeMetadata('a', {
          key: 'started-date',
          value: '2026-02-11T00:00:00Z',
          value_type: 'date',
        }),
        makeMetadata('a', { key: 'description', value: 'bartle-bee', value_type: 'string' }),
      ]);
      repo.upsert(makeEntity({ id: 'b' }), [
        makeMetadata('b', { key: 'total-wip', value: '40', value_type: 'number' }),
        makeMetadata('b', { key: 'description', value: 'bartledoo', value_type: 'string' }),
      ]);
      repo.upsert(makeEntity({ id: 'c' }), [
        makeMetadata('c', {
          key: 'started-date',
          value: '2026-02-12T00:00:00Z',
          value_type: 'date',
        }),
        makeMetadata('c', { key: 'total-wip', value: '20', value_type: 'number' }),
      ]);

      // Filter to only entity A (started-date within Feb 9–11)
      const entities = repo.list(
        [
          { key: 'started-date', op: 'gte', value: '2026-02-09T00:00:00Z' },
          { key: 'started-date', op: 'lte', value: '2026-02-11T23:59:59Z' },
        ],
        {}
      );
      const available = repo.getAvailableFilters(entities.map(e => e.id));

      const keys = available.map(f => f.key);
      expect(keys).toContain('started-date');
      expect(keys).toContain('description');
      expect(keys).not.toContain('total-wip');
    });

    it('returns only keys from entities matched by regex filter', () => {
      repo.upsert(makeEntity({ id: 'a' }), [
        makeMetadata('a', { key: 'description', value: 'bartle-bee', value_type: 'string' }),
        makeMetadata('a', { key: 'tag', value: 'alpha', value_type: 'string' }),
      ]);
      repo.upsert(makeEntity({ id: 'b' }), [
        makeMetadata('b', { key: 'description', value: 'unrelated', value_type: 'string' }),
        makeMetadata('b', { key: 'priority', value: 'high', value_type: 'string' }),
      ]);

      const entities = repo.list([{ key: 'description', op: 're', value: 'bartle' }], {});
      const available = repo.getAvailableFilters(entities.map(e => e.id));

      const keys = available.map(f => f.key);
      expect(keys).toContain('description');
      expect(keys).toContain('tag');
      expect(keys).not.toContain('priority');
    });

    it('populates distinctValues for string keys with ≤20 values', () => {
      repo.upsert(makeEntity({ id: 'j1' }), [
        makeMetadata('j1', { key: 'source', value: 'jira', value_type: 'string' }),
      ]);
      repo.upsert(makeEntity({ id: 'l1' }), [
        makeMetadata('l1', { key: 'source', value: 'linear', value_type: 'string' }),
      ]);
      const entities = repo.list([], {});
      const available = repo.getAvailableFilters(entities.map(e => e.id));
      const sourceFilter = available.find(f => f.key === 'source');
      expect(sourceFilter?.distinctValues).toEqual(['jira', 'linear']);
    });

    it('sets correct value_type for each key', () => {
      repo.upsert(makeEntity({ id: 'x' }), [
        makeMetadata('x', { key: 'num-field', value: '42', value_type: 'number' }),
        makeMetadata('x', { key: 'date-field', value: '2026-01-01', value_type: 'date' }),
        makeMetadata('x', { key: 'bool-field', value: 'true', value_type: 'boolean' }),
      ]);
      const entities = repo.list([], {});
      const available = repo.getAvailableFilters(entities.map(e => e.id));
      expect(available.find(f => f.key === 'num-field')?.value_type).toBe('number');
      expect(available.find(f => f.key === 'date-field')?.value_type).toBe('date');
      expect(available.find(f => f.key === 'bool-field')?.value_type).toBe('boolean');
    });
  });
});
