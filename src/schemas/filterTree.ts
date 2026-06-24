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

export const FilterGroupOpSchema = z.enum(['AND', 'OR']);
export type FilterGroupOp = z.infer<typeof FilterGroupOpSchema>;

export const FilterGroupSchema: z.ZodType<FilterGroup> = z.lazy(() =>
  z.object({
    type: z.literal('group'),
    id: z.string(),
    op: FilterGroupOpSchema,
    children: z.array(FilterNodeSchema),
  })
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

export function treeHasRegex(node: FilterNode): boolean {
  if (isLeaf(node)) return node.op === 're';
  return node.children.some(treeHasRegex);
}

export function collectLeaves(node: FilterNode): FilterLeaf[] {
  const out: FilterLeaf[] = [];
  walkTree(node, n => {
    if (isLeaf(n)) out.push(n);
  });
  return out;
}
