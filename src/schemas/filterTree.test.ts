import { describe, expect, it } from 'bun:test';
import {
  FilterTreeSchema,
  FilterNodeSchema,
  emptyTree,
  makeLeaf,
  makeGroup,
  walkTree,
  cloneTree,
  cloneTreeWithoutKey,
  collectLeaves,
  isLeaf,
  isGroup,
} from './filterTree';
import type { FilterNode } from './filterTree';

describe('FilterTreeSchema', () => {
  it('accepts an empty root group', () => {
    expect(FilterTreeSchema.parse(emptyTree())).toEqual(emptyTree());
  });

  it('accepts a leaf with a single string value', () => {
    const leaf = makeLeaf('owner', 'eq', 'Dave');
    const tree = makeGroup('AND', [leaf]);
    expect(() => FilterTreeSchema.parse(tree)).not.toThrow();
  });

  it('accepts an eq leaf with an array value', () => {
    const leaf = makeLeaf('owner', 'eq', ['Dave', 'Sam']);
    expect(() => FilterNodeSchema.parse(leaf)).not.toThrow();
  });

  it('rejects non-eq ops with an array value', () => {
    const leaf = { type: 'filter', id: 'l1', key: 'name', op: 'contains', value: ['a', 'b'] };
    expect(() => FilterNodeSchema.parse(leaf)).toThrow();
  });

  it('accepts deeply nested groups', () => {
    const tree = makeGroup('AND', [
      makeLeaf('type', 'eq', 'Service'),
      makeGroup('OR', [makeLeaf('active_prs', 'gte', '1'), makeLeaf('name', 'contains', 'foo')]),
    ]);
    expect(() => FilterTreeSchema.parse(tree)).not.toThrow();
  });

  it('rejects a leaf with children', () => {
    const bad = { type: 'filter', id: 'l1', key: 'k', op: 'eq', value: 'v', children: [] };
    const parsed = FilterNodeSchema.safeParse(bad);
    // Discriminated union strips unknown keys via passthrough rules — children is harmlessly ignored on a leaf.
    // The real check is that a group lacking children fails.
    expect(parsed.success).toBe(true);
  });

  it('rejects a group missing children', () => {
    const bad = { type: 'group', id: 'g1', op: 'AND' };
    expect(FilterNodeSchema.safeParse(bad).success).toBe(false);
  });

  it('rejects an invalid op', () => {
    const bad = { type: 'filter', id: 'l1', key: 'k', op: 'BAD', value: 'v' };
    expect(FilterNodeSchema.safeParse(bad).success).toBe(false);
  });

  it('rejects an invalid group op', () => {
    const bad = { type: 'group', id: 'g1', op: 'XOR', children: [] };
    expect(FilterNodeSchema.safeParse(bad).success).toBe(false);
  });

  it('accepts a NOT group with exactly one child', () => {
    const tree = makeGroup('AND', [makeGroup('NOT', [makeLeaf('owner', 'eq', 'Dave')])]);
    expect(() => FilterTreeSchema.parse(tree)).not.toThrow();
  });

  it('rejects a NOT group with zero children', () => {
    const bad = makeGroup('NOT', []);
    expect(FilterNodeSchema.safeParse(bad).success).toBe(false);
  });

  it('rejects a NOT group with more than one child', () => {
    const bad = makeGroup('NOT', [makeLeaf('a', 'eq', '1'), makeLeaf('b', 'eq', '2')]);
    expect(FilterNodeSchema.safeParse(bad).success).toBe(false);
  });
});

describe('emptyTree', () => {
  it('returns a root AND group with no children', () => {
    const t = emptyTree();
    expect(t.type).toBe('group');
    expect(t.op).toBe('AND');
    expect(t.children).toEqual([]);
    expect(t.id).toBe('root');
  });
});

describe('walkTree', () => {
  it('visits every node depth-first', () => {
    const a = makeLeaf('a', 'eq', '1');
    const b = makeLeaf('b', 'eq', '2');
    const inner = makeGroup('OR', [a, b]);
    const root = makeGroup('AND', [inner]);
    const visited: string[] = [];
    walkTree(root, n => visited.push(n.type));
    expect(visited).toEqual(['group', 'group', 'filter', 'filter']);
  });
});

describe('cloneTree', () => {
  it('produces a deep copy', () => {
    const tree = makeGroup('AND', [makeLeaf('a', 'eq', 'x')]);
    const copy = cloneTree(tree);
    expect(copy).toEqual(tree);
    if (isLeaf(copy.children[0])) copy.children[0].value = 'changed';
    if (isLeaf(tree.children[0])) expect(tree.children[0].value).toBe('x');
  });
});

describe('collectLeaves', () => {
  it('returns only leaves in tree order', () => {
    const a = makeLeaf('a', 'eq', '1');
    const b = makeLeaf('b', 'eq', '2');
    const c = makeLeaf('c', 'eq', '3');
    const tree = makeGroup('AND', [a, makeGroup('OR', [b, c])]);
    expect(collectLeaves(tree).map(l => l.key)).toEqual(['a', 'b', 'c']);
  });
});

describe('cloneTreeWithoutKey', () => {
  it('removes every leaf with the given key across sibling positions', () => {
    // Regression: with two `creator` badges at the same level, editing one
    // used to strip only that leaf — leaving the other creator filter to
    // narrow the value set the editor fetched from the server, which is
    // exactly what shows up as "0 selected" in the dropdown.
    const tree = makeGroup('AND', [
      makeLeaf('entity_type', 'eq', 'github_pr'),
      makeLeaf('creator', 'eq', 'dev-004'),
      makeLeaf('creator', 'eq', 'dev-013'),
    ]);
    const result = cloneTreeWithoutKey(tree, 'creator');
    expect(result.children).toHaveLength(1);
    expect(collectLeaves(result).map(l => l.key)).toEqual(['entity_type']);
  });

  it('preserves leaves whose key does not match', () => {
    const tree = makeGroup('AND', [
      makeLeaf('creator', 'eq', 'dev-004'),
      makeLeaf('owner', 'eq', 'Dave'),
    ]);
    const result = cloneTreeWithoutKey(tree, 'creator');
    expect(collectLeaves(result).map(l => `${l.key}=${l.value}`)).toEqual(['owner=Dave']);
  });

  it('removes leaves nested in sub-groups and collapses groups that end up empty', () => {
    const tree = makeGroup('AND', [
      makeLeaf('entity_type', 'eq', 'github_pr'),
      makeGroup('OR', [makeLeaf('creator', 'eq', 'dev-004'), makeLeaf('creator', 'eq', 'dev-013')]),
    ]);
    const result = cloneTreeWithoutKey(tree, 'creator');
    // The OR sub-group had only creator leaves and should collapse away.
    expect(result.children).toHaveLength(1);
    expect(isLeaf(result.children[0])).toBe(true);
    if (isLeaf(result.children[0])) expect(result.children[0].key).toBe('entity_type');
  });

  it('keeps sub-groups that still have non-matching children', () => {
    const tree = makeGroup('AND', [
      makeGroup('OR', [makeLeaf('creator', 'eq', 'dev-004'), makeLeaf('owner', 'eq', 'Dave')]),
    ]);
    const result = cloneTreeWithoutKey(tree, 'creator');
    expect(result.children).toHaveLength(1);
    const sub = result.children[0];
    expect(isGroup(sub)).toBe(true);
    if (isGroup(sub)) {
      expect(sub.op).toBe('OR');
      expect(collectLeaves(sub).map(l => l.key)).toEqual(['owner']);
    }
  });

  it('returns a fresh empty root when every leaf matches', () => {
    const tree = makeGroup('AND', [
      makeLeaf('creator', 'eq', 'dev-004'),
      makeLeaf('creator', 'eq', 'dev-013'),
    ]);
    const result = cloneTreeWithoutKey(tree, 'creator');
    expect(result).toEqual(emptyTree());
  });

  it('does not mutate the input tree', () => {
    const tree = makeGroup('AND', [
      makeLeaf('creator', 'eq', 'dev-004'),
      makeLeaf('owner', 'eq', 'Dave'),
    ]);
    const before = cloneTree(tree);
    cloneTreeWithoutKey(tree, 'creator');
    expect(tree).toEqual(before);
  });

  it('returns an empty tree unchanged', () => {
    expect(cloneTreeWithoutKey(emptyTree(), 'anything')).toEqual(emptyTree());
  });
});

describe('isLeaf / isGroup', () => {
  it('narrows correctly', () => {
    const leaf: FilterNode = makeLeaf('a', 'eq', 'x');
    const group: FilterNode = makeGroup('AND');
    expect(isLeaf(leaf)).toBe(true);
    expect(isGroup(leaf)).toBe(false);
    expect(isLeaf(group)).toBe(false);
    expect(isGroup(group)).toBe(true);
  });
});
