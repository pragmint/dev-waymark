import { describe, expect, it } from 'bun:test';
import { evaluateFilterTree } from './filterTreeEval';
import { makeGroup, makeLeaf, emptyTree } from '../schemas/filterTree';
import type { EntityWithMetadata } from '../schemas/entity';

function entity(overrides: Partial<EntityWithMetadata> = {}): EntityWithMetadata {
  return {
    id: 1,
    name: 'svc-foo',
    type: 'Service',
    created_at: '2026-01-15T00:00:00Z',
    metadata: [
      {
        entity_id: 1,
        key: 'owner',
        value: 'Dave',
        value_type: 'string',
        created_at: '',
        updated_at: '',
      },
      {
        entity_id: 1,
        key: 'active_prs',
        value: '3',
        value_type: 'number',
        created_at: '',
        updated_at: '',
      },
    ],
    ...overrides,
  };
}

describe('evaluateFilterTree — leaves', () => {
  it('matches eq on a metadata key', () => {
    expect(evaluateFilterTree(makeLeaf('owner', 'eq', 'Dave'), entity())).toBe(true);
    expect(evaluateFilterTree(makeLeaf('owner', 'eq', 'Sam'), entity())).toBe(false);
  });

  it('matches eq with multi-value array', () => {
    expect(evaluateFilterTree(makeLeaf('owner', 'eq', ['Sam', 'Dave']), entity())).toBe(true);
    expect(evaluateFilterTree(makeLeaf('owner', 'eq', ['Alice', 'Sam']), entity())).toBe(false);
  });

  it('matches contains', () => {
    expect(evaluateFilterTree(makeLeaf('owner', 'contains', 'av'), entity())).toBe(true);
    expect(evaluateFilterTree(makeLeaf('owner', 'contains', 'zz'), entity())).toBe(false);
  });

  it('matches gte / lte numerically', () => {
    expect(evaluateFilterTree(makeLeaf('active_prs', 'gte', '2'), entity())).toBe(true);
    expect(evaluateFilterTree(makeLeaf('active_prs', 'gte', '4'), entity())).toBe(false);
    expect(evaluateFilterTree(makeLeaf('active_prs', 'lte', '3'), entity())).toBe(true);
  });

  it('matches regex', () => {
    expect(evaluateFilterTree(makeLeaf('owner', 're', '^Da'), entity())).toBe(true);
    expect(evaluateFilterTree(makeLeaf('owner', 're', '^Sa'), entity())).toBe(false);
  });

  it('returns false on an invalid regex', () => {
    expect(evaluateFilterTree(makeLeaf('owner', 're', '[unclosed'), entity())).toBe(false);
  });

  it('matches entity fields', () => {
    expect(evaluateFilterTree(makeLeaf('entity_type', 'eq', 'Service'), entity())).toBe(true);
    expect(evaluateFilterTree(makeLeaf('entity_name', 'contains', 'foo'), entity())).toBe(true);
  });

  it('returns false when the metadata key is absent', () => {
    expect(evaluateFilterTree(makeLeaf('missing', 'eq', 'x'), entity())).toBe(false);
  });
});

describe('evaluateFilterTree — groups', () => {
  it('empty group is true', () => {
    expect(evaluateFilterTree(emptyTree(), entity())).toBe(true);
  });

  it('AND requires all children', () => {
    const tree = makeGroup('AND', [
      makeLeaf('owner', 'eq', 'Dave'),
      makeLeaf('active_prs', 'gte', '1'),
    ]);
    expect(evaluateFilterTree(tree, entity())).toBe(true);
    const fail = makeGroup('AND', [
      makeLeaf('owner', 'eq', 'Dave'),
      makeLeaf('active_prs', 'gte', '10'),
    ]);
    expect(evaluateFilterTree(fail, entity())).toBe(false);
  });

  it('OR requires any child', () => {
    const tree = makeGroup('OR', [
      makeLeaf('owner', 'eq', 'Sam'),
      makeLeaf('active_prs', 'gte', '1'),
    ]);
    expect(evaluateFilterTree(tree, entity())).toBe(true);
  });

  it('handles nested AND(A, OR(B, C))', () => {
    const tree = makeGroup('AND', [
      makeLeaf('entity_type', 'eq', 'Service'),
      makeGroup('OR', [makeLeaf('owner', 'eq', 'Sam'), makeLeaf('active_prs', 'gte', '2')]),
    ]);
    expect(evaluateFilterTree(tree, entity())).toBe(true);
  });
});
