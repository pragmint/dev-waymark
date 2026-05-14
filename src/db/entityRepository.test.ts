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
    expect(repo.list({})).toHaveLength(2);
  });

  it('list includes metadata for each entity', () => {
    repo.upsert(makeEntity(), [makeMetadata('e1')]);
    const results = repo.list({});
    expect(results[0].metadata).toHaveLength(1);
    expect(results[0].metadata[0].key).toBe('status');
  });

  it('filters entities by source', () => {
    repo.upsert(makeEntity({ id: 'j1', source_id: 'J-1' }), [
      makeMetadata('j1', { key: 'source', value: 'jira' }),
    ]);
    repo.upsert(makeEntity({ id: 'l1', source_id: 'L-1' }), [
      makeMetadata('l1', { key: 'source', value: 'linear' }),
    ]);
    const results = repo.list({ source: 'jira' });
    expect(results).toHaveLength(1);
    expect(results[0].metadata.find(m => m.key === 'source')?.value).toBe('jira');
  });

  it('filters entities by type', () => {
    repo.upsert(makeEntity({ id: 't1', source_id: 'T-1' }), [
      makeMetadata('t1', { key: 'type', value: 'ticket' }),
    ]);
    repo.upsert(makeEntity({ id: 'p1', source_id: 'P-1' }), [
      makeMetadata('p1', { key: 'type', value: 'pr' }),
    ]);
    const results = repo.list({ type: 'pr' });
    expect(results).toHaveLength(1);
    expect(results[0].metadata.find(m => m.key === 'type')?.value).toBe('pr');
  });

  it('upserts without duplicating on re-insert', () => {
    repo.upsert(makeEntity(), [makeMetadata('e1', { key: 'type', value: 'ticket' })]);
    repo.upsert(makeEntity(), [makeMetadata('e1', { key: 'type', value: 'updated-type' })]);
    const results = repo.list({});
    expect(results).toHaveLength(1);
    expect(results[0].metadata.find(m => m.key === 'type')?.value).toBe('updated-type');
  });

  it('filters entities by from date', () => {
    repo.upsert(
      makeEntity({ id: 'old', source_id: 'OLD', created_at: '2026-01-01T00:00:00Z' }),
      []
    );
    repo.upsert(
      makeEntity({ id: 'new', source_id: 'NEW', created_at: '2026-06-01T00:00:00Z' }),
      []
    );
    const results = repo.list({ from: '2026-03-01T00:00:00Z' });
    expect(results).toHaveLength(1);
    expect(results[0].id).toBe('new');
  });

  it('filters entities by to date', () => {
    repo.upsert(
      makeEntity({ id: 'old', source_id: 'OLD', created_at: '2026-01-01T00:00:00Z' }),
      []
    );
    repo.upsert(
      makeEntity({ id: 'new', source_id: 'NEW', created_at: '2026-06-01T00:00:00Z' }),
      []
    );
    const results = repo.list({ to: '2026-03-01T00:00:00Z' });
    expect(results).toHaveLength(1);
    expect(results[0].id).toBe('old');
  });

  it('returns distinct sources', () => {
    repo.upsert(makeEntity({ id: 'j1', source_id: 'J-1' }), [
      makeMetadata('j1', { key: 'source', value: 'jira' }),
    ]);
    repo.upsert(makeEntity({ id: 'l1', source_id: 'L-1' }), [
      makeMetadata('l1', { key: 'source', value: 'linear' }),
    ]);
    repo.upsert(makeEntity({ id: 'j2', source_id: 'J-2' }), [
      makeMetadata('j2', { key: 'source', value: 'jira' }),
    ]);
    expect(repo.distinctSources()).toEqual(['jira', 'linear']);
  });

  it('returns distinct types', () => {
    repo.upsert(makeEntity({ id: 't1', source_id: 'T-1' }), [
      makeMetadata('t1', { key: 'type', value: 'ticket' }),
    ]);
    repo.upsert(makeEntity({ id: 'p1', source_id: 'P-1' }), [
      makeMetadata('p1', { key: 'type', value: 'pr' }),
    ]);
    expect(repo.distinctTypes()).toEqual(['pr', 'ticket']);
  });
});
