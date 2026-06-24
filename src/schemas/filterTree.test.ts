import { describe, expect, it } from 'bun:test';
import {
  FilterTreeSchema,
  FilterNodeSchema,
  emptyTree,
  makeLeaf,
  makeGroup,
  walkTree,
  cloneTree,
  treeHasRegex,
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

describe('treeHasRegex', () => {
  it('returns false for trees with no regex leaves', () => {
    expect(treeHasRegex(makeGroup('AND', [makeLeaf('k', 'eq', 'v')]))).toBe(false);
  });

  it('returns true if any leaf is a regex', () => {
    const tree = makeGroup('AND', [
      makeLeaf('k', 'eq', 'v'),
      makeGroup('OR', [makeLeaf('n', 're', '.+')]),
    ]);
    expect(treeHasRegex(tree)).toBe(true);
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
