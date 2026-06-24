import { describe, expect, it } from 'bun:test';
import {
  buildEntityUrl,
  encodeTree,
  decodeTree,
  parseTreeFromUrl,
  treesEqual,
  findMatchingPresetId,
} from './filterUrl';
import { emptyTree, makeGroup, makeLeaf } from '../schemas/filterTree';

describe('buildEntityUrl', () => {
  it('returns /entities for an empty tree', () => {
    expect(buildEntityUrl(emptyTree())).toBe('/entities');
  });

  it('includes f= as a hex payload (no percent escapes)', () => {
    const tree = makeGroup('AND', [makeLeaf('entity_type', 'eq', 'jira_ticket')]);
    const url = buildEntityUrl(tree);
    expect(url.startsWith('/entities?f=')).toBe(true);
    const f = url.split('f=')[1];
    expect(f).toMatch(/^[0-9a-f]+$/);
  });

  it('preserves preset id alongside the tree', () => {
    const tree = makeGroup('AND', [makeLeaf('a', 'eq', '1')]);
    const url = buildEntityUrl(tree, 7);
    expect(url).toContain('preset=7');
    expect(url).toContain('f=');
  });

  it('returns just preset= when tree is empty but preset is set', () => {
    expect(buildEntityUrl(emptyTree(), 4)).toBe('/entities?preset=4');
  });
});

describe('encodeTree / decodeTree', () => {
  it('round-trips a non-trivial tree', () => {
    const tree = makeGroup('AND', [
      makeLeaf('entity_type', 'eq', 'Service'),
      makeGroup('OR', [
        makeLeaf('owner', 'eq', ['Dave', 'Sam']),
        makeLeaf('active_prs', 'gte', '1'),
      ]),
    ]);
    const decoded = decodeTree(encodeTree(tree));
    expect(decoded).not.toBeNull();
    expect(treesEqual(decoded!, tree)).toBe(true);
  });

  it('returns null on garbage input', () => {
    expect(decodeTree('{not json')).toBeNull();
    expect(decodeTree('zzzz')).toBeNull();
  });
});

describe('parseTreeFromUrl', () => {
  it('returns emptyTree when f is absent', () => {
    const url = new URL('https://x/entities');
    expect(parseTreeFromUrl(url)).toEqual(emptyTree());
  });

  it('returns emptyTree on malformed f param', () => {
    const url = new URL('https://x/entities?f=not-hex');
    expect(parseTreeFromUrl(url)).toEqual(emptyTree());
  });

  it('parses a valid tree from f', () => {
    const tree = makeGroup('AND', [makeLeaf('k', 'eq', 'v')]);
    const url = new URL(`https://x/entities?f=${encodeTree(tree)}`);
    const parsed = parseTreeFromUrl(url);
    expect(treesEqual(parsed, tree)).toBe(true);
  });
});

describe('treesEqual', () => {
  it('returns true for structurally identical trees regardless of node ids', () => {
    const a = makeGroup('AND', [makeLeaf('k', 'eq', 'v')]);
    const b = makeGroup('AND', [makeLeaf('k', 'eq', 'v')]);
    expect(treesEqual(a, b)).toBe(true);
  });

  it('is order-sensitive on group children', () => {
    const a = makeGroup('AND', [makeLeaf('a', 'eq', '1'), makeLeaf('b', 'eq', '2')]);
    const b = makeGroup('AND', [makeLeaf('b', 'eq', '2'), makeLeaf('a', 'eq', '1')]);
    expect(treesEqual(a, b)).toBe(false);
  });

  it('distinguishes AND from OR', () => {
    const a = makeGroup('AND', [makeLeaf('k', 'eq', 'v')]);
    const b = makeGroup('OR', [makeLeaf('k', 'eq', 'v')]);
    expect(treesEqual(a, b)).toBe(false);
  });

  it('returns true for two empty trees', () => {
    expect(treesEqual(emptyTree(), emptyTree())).toBe(true);
  });
});

describe('findMatchingPresetId', () => {
  it('returns the id of the matching preset', () => {
    const t1 = makeGroup('AND', [makeLeaf('entity_type', 'eq', 'jira_ticket')]);
    const t2 = makeGroup('AND', [makeLeaf('entity_type', 'eq', 'github_pr')]);
    expect(
      findMatchingPresetId(t1, [
        { id: 1, tree: t1 },
        { id: 2, tree: t2 },
      ])
    ).toBe(1);
  });

  it('returns null when nothing matches', () => {
    const t = makeGroup('AND', [makeLeaf('k', 'eq', 'v')]);
    expect(
      findMatchingPresetId(t, [{ id: 1, tree: makeGroup('AND', [makeLeaf('k', 'eq', 'other')]) }])
    ).toBeNull();
  });
});
