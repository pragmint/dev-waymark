import { describe, expect, it } from 'bun:test';
import {
  getEntityTitle,
  getMetadataValue,
  sortEntitiesByDate,
  groupEntitiesByType,
} from './entityQueries';
import type { EntityWithMetadata } from '../schemas/entity';

const makeEntity = (overrides: Partial<EntityWithMetadata> = {}): EntityWithMetadata => ({
  id: 'e1',
  source_id: 'PROJ-1',
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
  metadata: [],
  ...overrides,
});

const meta = (entityId: string, key: string, value: string) => ({
  entity_id: entityId,
  key,
  value,
  value_type: 'string' as const,
});

describe('getMetadataValue', () => {
  it('returns the value for a known key', () => {
    const entity = makeEntity({ metadata: [meta('e1', 'source', 'jira')] });
    expect(getMetadataValue(entity, 'source')).toBe('jira');
  });

  it('returns undefined for an unknown key', () => {
    expect(getMetadataValue(makeEntity(), 'source')).toBeUndefined();
  });
});

describe('getEntityTitle', () => {
  it('returns source/source_id when source metadata is present', () => {
    const entity = makeEntity({ metadata: [meta('e1', 'source', 'jira')] });
    expect(getEntityTitle(entity)).toBe('jira/PROJ-1');
  });

  it('returns source_id when source metadata is absent', () => {
    expect(getEntityTitle(makeEntity())).toBe('PROJ-1');
  });

  it('handles different sources', () => {
    const entity = makeEntity({
      source_id: 'LIN-42',
      metadata: [meta('e1', 'source', 'linear')],
    });
    expect(getEntityTitle(entity)).toBe('linear/LIN-42');
  });
});

describe('sortEntitiesByDate', () => {
  const entities = [
    makeEntity({ id: 'a', created_at: '2026-01-03T00:00:00Z' }),
    makeEntity({ id: 'b', created_at: '2026-01-01T00:00:00Z' }),
    makeEntity({ id: 'c', created_at: '2026-01-02T00:00:00Z' }),
  ];

  it('sorts ascending', () => {
    const sorted = sortEntitiesByDate(entities, 'asc');
    expect(sorted.map(e => e.id)).toEqual(['b', 'c', 'a']);
  });

  it('sorts descending', () => {
    const sorted = sortEntitiesByDate(entities, 'desc');
    expect(sorted.map(e => e.id)).toEqual(['a', 'c', 'b']);
  });

  it('does not mutate the original array', () => {
    const original = [...entities];
    sortEntitiesByDate(entities, 'asc');
    expect(entities).toEqual(original);
  });
});

describe('groupEntitiesByType', () => {
  it('groups entities by type metadata', () => {
    const entities = [
      makeEntity({ id: '1', metadata: [meta('1', 'type', 'ticket')] }),
      makeEntity({ id: '2', metadata: [meta('2', 'type', 'pr')] }),
      makeEntity({ id: '3', metadata: [meta('3', 'type', 'ticket')] }),
    ];
    const groups = groupEntitiesByType(entities);
    expect(groups['ticket']).toHaveLength(2);
    expect(groups['pr']).toHaveLength(1);
  });

  it('returns empty object for empty input', () => {
    expect(groupEntitiesByType([])).toEqual({});
  });

  it('groups entities without type metadata under empty string key', () => {
    const entities = [makeEntity({ id: '1' }), makeEntity({ id: '2' })];
    const groups = groupEntitiesByType(entities);
    expect(groups['']).toHaveLength(2);
  });
});
