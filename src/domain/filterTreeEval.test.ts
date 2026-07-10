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

  it('treats empty-value gte / lte as IS NULL', () => {
    // Key absent from metadata → matches.
    expect(evaluateFilterTree(makeLeaf('started_at', 'gte', ''), entity())).toBe(true);
    expect(evaluateFilterTree(makeLeaf('started_at', 'lte', ''), entity())).toBe(true);
    // Key present with a value → does not match.
    expect(evaluateFilterTree(makeLeaf('active_prs', 'gte', ''), entity())).toBe(false);
    expect(evaluateFilterTree(makeLeaf('active_prs', 'lte', ''), entity())).toBe(false);
    // Key present with an explicit null value → matches.
    const withNullMeta = entity({
      metadata: [
        {
          entity_id: 1,
          key: 'started_at',
          value: null,
          value_type: 'date',
          created_at: '',
          updated_at: '',
        },
      ],
    });
    expect(evaluateFilterTree(makeLeaf('started_at', 'gte', ''), withNullMeta)).toBe(true);
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

describe('evaluateFilterTree — list values', () => {
  const withList = (value: string): EntityWithMetadata =>
    entity({
      metadata: [
        {
          entity_id: 1,
          key: 'jira_tickets',
          value,
          value_type: 'list',
          created_at: '',
          updated_at: '',
        },
      ],
    });

  it('eq matches when the list includes the value (membership)', () => {
    const e = withList('CM-123|CM-124|CAS-3|INFRA-1225');
    expect(evaluateFilterTree(makeLeaf('jira_tickets', 'eq', 'CM-124'), e)).toBe(true);
    expect(evaluateFilterTree(makeLeaf('jira_tickets', 'eq', 'CM-999'), e)).toBe(false);
  });

  it('eq matches whole elements only — CM never matches a CMS element', () => {
    const e = withList('CMS-1|OTHER-2');
    expect(evaluateFilterTree(makeLeaf('jira_tickets', 'eq', 'CM'), e)).toBe(false);
    expect(evaluateFilterTree(makeLeaf('jira_tickets', 'eq', 'CMS-1'), e)).toBe(true);
  });

  it('multi-value eq matches when any requested value is a member', () => {
    const e = withList('CM-123|CAS-3');
    expect(evaluateFilterTree(makeLeaf('jira_tickets', 'eq', ['ZZZ-1', 'CAS-3']), e)).toBe(true);
    expect(evaluateFilterTree(makeLeaf('jira_tickets', 'eq', ['ZZZ-1', 'ZZZ-2']), e)).toBe(false);
  });

  it('trims elements and drops empties when splitting', () => {
    const e = withList(' CM-123 | CAS-3 ||');
    expect(evaluateFilterTree(makeLeaf('jira_tickets', 'eq', 'CM-123'), e)).toBe(true);
    expect(evaluateFilterTree(makeLeaf('jira_tickets', 'eq', 'CAS-3'), e)).toBe(true);
    expect(evaluateFilterTree(makeLeaf('jira_tickets', 'eq', ''), e)).toBe(false);
  });

  it('scalar eq is unaffected — a pipe in a string value is literal', () => {
    const e = entity({
      metadata: [
        {
          entity_id: 1,
          key: 'title',
          value: 'a|b',
          value_type: 'string',
          created_at: '',
          updated_at: '',
        },
      ],
    });
    expect(evaluateFilterTree(makeLeaf('title', 'eq', 'a|b'), e)).toBe(true);
    expect(evaluateFilterTree(makeLeaf('title', 'eq', 'a'), e)).toBe(false);
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

  it('NOT inverts a leaf result', () => {
    expect(evaluateFilterTree(makeGroup('NOT', [makeLeaf('owner', 'eq', 'Sam')]), entity())).toBe(
      true
    );
    expect(evaluateFilterTree(makeGroup('NOT', [makeLeaf('owner', 'eq', 'Dave')]), entity())).toBe(
      false
    );
  });

  it('NOT inverts a missing-key leaf (which was false → true)', () => {
    expect(evaluateFilterTree(makeGroup('NOT', [makeLeaf('missing', 'eq', 'x')]), entity())).toBe(
      true
    );
  });

  it('NOT inverts a nested group', () => {
    const inner = makeGroup('AND', [
      makeLeaf('owner', 'eq', 'Dave'),
      makeLeaf('active_prs', 'gte', '1'),
    ]);
    expect(evaluateFilterTree(makeGroup('NOT', [inner]), entity())).toBe(false);
  });

  it('double NOT returns to the original result', () => {
    const inner = makeLeaf('owner', 'eq', 'Dave');
    const outer = makeGroup('NOT', [makeGroup('NOT', [inner])]);
    expect(evaluateFilterTree(outer, entity())).toBe(true);
  });

  it('AND with NOT child narrows correctly', () => {
    const tree = makeGroup('AND', [
      makeLeaf('entity_type', 'eq', 'Service'),
      makeGroup('NOT', [makeLeaf('owner', 'eq', 'Sam')]),
    ]);
    expect(evaluateFilterTree(tree, entity())).toBe(true);
    const tree2 = makeGroup('AND', [
      makeLeaf('entity_type', 'eq', 'Service'),
      makeGroup('NOT', [makeLeaf('owner', 'eq', 'Dave')]),
    ]);
    expect(evaluateFilterTree(tree2, entity())).toBe(false);
  });
});
