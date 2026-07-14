import { z } from 'zod';
import { MetaFilterOpSchema } from './entity';
import type { MetaFilterOp } from './entity';

// A filter tree expresses arbitrarily nested boolean filter logic.
// Root is always a group. Leaves carry the predicate; groups carry op + children.

export const FilterLeafSchema = z
  .object({
    type: z.literal('filter'),
    id: z.string(),
    key: z.string(),
    op: MetaFilterOpSchema,
    value: z.union([z.string(), z.array(z.string())]),
  })
  .refine(
    leaf => (leaf.op === 'eq' ? true : typeof leaf.value === 'string'),
    'Only eq filters may carry a multi-value array'
  );

export type FilterLeaf = z.infer<typeof FilterLeafSchema>;

export const FilterGroupOpSchema = z.enum(['AND', 'OR', 'NOT']);
export type FilterGroupOp = z.infer<typeof FilterGroupOpSchema>;

export const FilterGroupSchema: z.ZodType<FilterGroup> = z.lazy(() =>
  z
    .object({
      type: z.literal('group'),
      id: z.string(),
      op: FilterGroupOpSchema,
      children: z.array(FilterNodeSchema),
    })
    .refine(
      g => (g.op === 'NOT' ? g.children.length === 1 : true),
      'NOT groups must have exactly one child'
    )
);

export const FilterNodeSchema: z.ZodType<FilterNode> = z.lazy(() =>
  z.union([FilterLeafSchema, FilterGroupSchema])
);

export type FilterGroup = {
  type: 'group';
  id: string;
  op: FilterGroupOp;
  children: FilterNode[];
};

export type FilterNode = FilterLeaf | FilterGroup;

export const FilterTreeSchema = FilterGroupSchema;
export type FilterTree = FilterGroup;

// ── Helpers ──────────────────────────────────────────────────────────────────

let _idCounter = 0;
export function nextNodeId(prefix = 'n'): string {
  _idCounter += 1;
  return `${prefix}_${_idCounter.toString(36)}_${Math.floor(Math.random() * 0xffffff).toString(36)}`;
}

export function emptyTree(): FilterTree {
  return { type: 'group', id: 'root', op: 'AND', children: [] };
}

export function makeLeaf(key: string, op: MetaFilterOp, value: string | string[]): FilterLeaf {
  return { type: 'filter', id: nextNodeId('l'), key, op, value };
}

export function makeGroup(op: FilterGroupOp, children: FilterNode[] = []): FilterGroup {
  return { type: 'group', id: nextNodeId('g'), op, children };
}

export function makeNot(child: FilterNode): FilterGroup {
  return { type: 'group', id: nextNodeId('g'), op: 'NOT', children: [child] };
}

export function isLeaf(node: FilterNode): node is FilterLeaf {
  return node.type === 'filter';
}

export function isGroup(node: FilterNode): node is FilterGroup {
  return node.type === 'group';
}

export function walkTree(node: FilterNode, visit: (n: FilterNode) => void): void {
  visit(node);
  if (isGroup(node)) {
    for (const child of node.children) walkTree(child, visit);
  }
}

export function cloneTree<T extends FilterNode>(tree: T): T {
  if (typeof structuredClone === 'function') {
    return structuredClone(tree);
  }
  return JSON.parse(JSON.stringify(tree)) as T;
}

export function collectLeaves(node: FilterNode): FilterLeaf[] {
  const out: FilterLeaf[] = [];
  walkTree(node, n => {
    if (isLeaf(n)) out.push(n);
  });
  return out;
}

// Return a copy of `tree` with every leaf whose key === `key` removed, and any
// groups that end up empty as a result also removed. If the whole tree
// collapses (root's only descendants were leaves with this key), returns a
// fresh empty root group. Used by the leaf editor to ask the server "what
// values would be available if this field's filters were disabled?" — the
// stripping is by key rather than by leaf id so that when the same field
// appears in multiple badges, sibling badges don't narrow the value set.
export function cloneTreeWithoutKey(tree: FilterTree, key: string): FilterTree {
  function strip(node: FilterNode): FilterNode | null {
    if (isLeaf(node)) return node.key === key ? null : { ...node };
    const kept: FilterNode[] = [];
    for (const child of node.children) {
      const cloned = strip(child);
      if (cloned !== null) kept.push(cloned);
    }
    if (kept.length === 0) return null;
    return { ...node, children: kept };
  }
  const stripped = strip(tree);
  if (stripped === null || isLeaf(stripped)) return emptyTree();
  return stripped;
}

// `true` iff every leaf descendant of `node` is wrapped in a unary NOT group.
// Empty groups return `false` (no leaves to negate). Used to derive a group's
// "negated" state from its children rather than tracking it separately.
export function allLeavesNegated(node: FilterNode): boolean {
  if (isLeaf(node)) return false;
  if (node.op === 'NOT' && node.children.length === 1 && isLeaf(node.children[0])) {
    return true;
  }
  if (node.children.length === 0) return false;
  return node.children.every(allLeavesNegated);
}

// Distribute any NOT-wrapping-a-group into per-leaf NOT wrappers within the
// group. The UI model only has NOT(leaf); legacy NOT(group) data is reshaped
// here so the rest of the UI never has to handle it. Idempotent.
//
// Note: this changes boolean semantics — NOT(A AND B) ≠ AND(NOT A, NOT B) by
// De Morgan — but the UI's model treats "negate this group" as "negate each
// leaf", so the reshape matches the user's mental model.
export function distributeGroupNots(node: FilterNode): FilterNode {
  if (isLeaf(node)) return node;
  if (node.op === 'NOT' && node.children.length === 1 && isGroup(node.children[0])) {
    return toggleEveryLeafNot(distributeGroupNots(node.children[0]));
  }
  return { ...node, children: node.children.map(distributeGroupNots) };
}

function toggleEveryLeafNot(node: FilterNode): FilterNode {
  if (isLeaf(node)) return makeNot(node);
  if (node.op === 'NOT' && node.children.length === 1 && isLeaf(node.children[0])) {
    return node.children[0];
  }
  return { ...node, children: node.children.map(toggleEveryLeafNot) };
}
