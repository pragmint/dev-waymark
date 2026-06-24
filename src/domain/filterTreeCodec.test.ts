import { describe, expect, it } from 'bun:test';
import { decodeTreeHex, encodeTreeHex } from './filterTreeCodec';
import { emptyTree, isGroup, isLeaf, makeGroup, makeLeaf, walkTree } from '../schemas/filterTree';
import type { FilterNode, FilterTree } from '../schemas/filterTree';

function canonicalize(node: FilterNode): unknown {
  if (isLeaf(node)) return { type: 'filter', key: node.key, op: node.op, value: node.value };
  if (isGroup(node))
    return { type: 'group', op: node.op, children: node.children.map(canonicalize) };
  return null;
}

function eq(a: FilterTree, b: FilterTree): boolean {
  return JSON.stringify(canonicalize(a)) === JSON.stringify(canonicalize(b));
}

describe('encodeTreeHex / decodeTreeHex', () => {
  it('round-trips an empty tree', () => {
    const hex = encodeTreeHex(emptyTree());
    const decoded = decodeTreeHex(hex);
    expect(decoded).not.toBeNull();
    expect(eq(decoded!, emptyTree())).toBe(true);
  });

  it('produces a hex-only string', () => {
    const tree = makeGroup('AND', [makeLeaf('entity_type', 'eq', 'github_pr')]);
    expect(encodeTreeHex(tree)).toMatch(/^[0-9a-f]+$/);
  });

  it('round-trips a non-trivial nested tree', () => {
    const tree = makeGroup('AND', [
      makeLeaf('entity_type', 'eq', 'github_pr'),
      makeLeaf('entity_name', 're', 'repo-020/7'),
      makeGroup('OR', [makeLeaf('creator', 're', 'dev-002'), makeLeaf('creator', 're', 'dev-013')]),
    ]);
    const decoded = decodeTreeHex(encodeTreeHex(tree));
    expect(decoded).not.toBeNull();
    expect(eq(decoded!, tree)).toBe(true);
  });

  it('round-trips a leaf with an array value', () => {
    const tree = makeGroup('AND', [makeLeaf('owner', 'eq', ['Dave', 'Sam', 'Pat'])]);
    const decoded = decodeTreeHex(encodeTreeHex(tree));
    expect(decoded).not.toBeNull();
    expect(eq(decoded!, tree)).toBe(true);
  });

  it('preserves order of group children', () => {
    const a = makeGroup('AND', [makeLeaf('a', 'eq', '1'), makeLeaf('b', 'eq', '2')]);
    const b = makeGroup('AND', [makeLeaf('b', 'eq', '2'), makeLeaf('a', 'eq', '1')]);
    expect(encodeTreeHex(a)).not.toBe(encodeTreeHex(b));
  });

  it('distinguishes AND from OR', () => {
    const a = makeGroup('AND', [makeLeaf('k', 'eq', 'v')]);
    const b = makeGroup('OR', [makeLeaf('k', 'eq', 'v')]);
    expect(encodeTreeHex(a)).not.toBe(encodeTreeHex(b));
  });

  it('produces identical hex for trees that differ only in node ids', () => {
    const a = makeGroup('AND', [
      makeLeaf('k', 'eq', 'v'),
      makeGroup('OR', [makeLeaf('x', 're', 'y')]),
    ]);
    const b = makeGroup('AND', [
      makeLeaf('k', 'eq', 'v'),
      makeGroup('OR', [makeLeaf('x', 're', 'y')]),
    ]);
    expect(encodeTreeHex(a)).toBe(encodeTreeHex(b));
  });

  it('handles unicode in keys and values', () => {
    const tree = makeGroup('AND', [makeLeaf('emoji_😀', 'eq', 'café — résumé')]);
    const decoded = decodeTreeHex(encodeTreeHex(tree));
    expect(decoded).not.toBeNull();
    expect(eq(decoded!, tree)).toBe(true);
  });

  it('regenerates ids on decode, with root keeping the literal "root" id', () => {
    const tree = makeGroup('AND', [
      makeLeaf('k', 'eq', 'v'),
      makeGroup('OR', [makeLeaf('a', 'eq', 'b')]),
    ]);
    const decoded = decodeTreeHex(encodeTreeHex(tree))!;
    expect(decoded.id).toBe('root');
    const ids: string[] = [];
    walkTree(decoded, n => ids.push(n.id));
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('returns null on non-hex input', () => {
    expect(decodeTreeHex('not-hex!')).toBeNull();
  });

  it('returns null on odd-length hex', () => {
    expect(decodeTreeHex('abc')).toBeNull();
  });

  it('returns null on empty input', () => {
    expect(decodeTreeHex('')).toBeNull();
  });

  it('returns null on bad version byte', () => {
    expect(decodeTreeHex('ff')).toBeNull();
  });

  it('returns null on truncated payload', () => {
    expect(decodeTreeHex('0101')).toBeNull();
  });

  it('returns null on trailing bytes', () => {
    const tree = makeGroup('AND', []);
    const hex = encodeTreeHex(tree);
    expect(decodeTreeHex(hex + '00')).toBeNull();
  });
});
