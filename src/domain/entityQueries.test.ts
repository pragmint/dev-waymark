import { describe, expect, it } from 'bun:test';
import { getEntityTitle, getMetadataValue, groupEntitiesByType } from './entityQueries';
import type { EntityWithMetadata } from '../schemas/entity';

const makeEntity = (overrides: Partial<EntityWithMetadata> = {}): EntityWithMetadata => ({
  id: 1,
  name: 'ENG-1',
  metadata: [],
  ...overrides,
});

const meta = (entityId: number, key: string, value: string) => ({
  entity_id: entityId,
  key,
  value,
  value_type: 'string' as const,
});

describe('getMetadataValue', () => {
  it('returns the value for a known key', () => {
    const entity = makeEntity({ metadata: [meta(1, 'source', 'jira')] });
    expect(getMetadataValue(entity, 'source')).toBe('jira');
  });

  it('returns undefined for an unknown key', () => {
    expect(getMetadataValue(makeEntity(), 'source')).toBeUndefined();
  });
});

describe('getEntityTitle', () => {
  it('returns the entity name', () => {
    expect(getEntityTitle(makeEntity())).toBe('ENG-1');
  });

  it('returns a different name', () => {
    expect(getEntityTitle(makeEntity({ name: 'OPS-42' }))).toBe('OPS-42');
  });
});

describe('groupEntitiesByType', () => {
  it('groups entities by type metadata', () => {
    const entities = [
      makeEntity({ id: 1, metadata: [meta(1, 'type', 'ticket')] }),
      makeEntity({ id: 2, metadata: [meta(2, 'type', 'pr')] }),
      makeEntity({ id: 3, metadata: [meta(3, 'type', 'ticket')] }),
    ];
    const groups = groupEntitiesByType(entities);
    expect(groups['ticket']).toHaveLength(2);
    expect(groups['pr']).toHaveLength(1);
  });

  it('returns empty object for empty input', () => {
    expect(groupEntitiesByType([])).toEqual({});
  });

  it('groups entities without type metadata under empty string key', () => {
    const entities = [makeEntity({ id: 1 }), makeEntity({ id: 2 })];
    const groups = groupEntitiesByType(entities);
    expect(groups['']).toHaveLength(2);
  });
});
