import type { EntityWithMetadata } from '../schemas/entity';
import { isGroup, isLeaf } from '../schemas/filterTree';
import type { FilterLeaf, FilterNode } from '../schemas/filterTree';

// Pure predicate: does the entity match this filter tree?
// Single source of truth for filter semantics — the SQL builder produces an
// over-approximation when the tree contains regex leaves, and this function
// trims the result set to the exact matching rows.

const ENTITY_FIELD_GETTERS: Record<string, (e: EntityWithMetadata) => string> = {
  entity_name: e => e.name,
  entity_type: e => e.type,
  entity_created_at: e => e.created_at,
};

function leafValueFor(leaf: FilterLeaf, entity: EntityWithMetadata): string | null {
  const getter = ENTITY_FIELD_GETTERS[leaf.key];
  if (getter) return getter(entity);
  const meta = entity.metadata.find(m => m.key === leaf.key);
  return meta?.value ?? null;
}

function matchesEq(raw: string | null, value: string | string[]): boolean {
  if (raw == null) return false;
  return Array.isArray(value) ? value.includes(raw) : raw === value;
}

function compareNumOrLex(raw: string, target: string, op: 'gte' | 'lte'): boolean {
  const a = Number(raw);
  const b = Number(target);
  if (Number.isFinite(a) && Number.isFinite(b)) return op === 'gte' ? a >= b : a <= b;
  return op === 'gte' ? raw >= target : raw <= target;
}

function matchesRegex(raw: string, pattern: string): boolean {
  try {
    return new RegExp(pattern).test(raw);
  } catch {
    return false;
  }
}

function leafMatches(leaf: FilterLeaf, entity: EntityWithMetadata): boolean {
  const raw = leafValueFor(leaf, entity);
  if (leaf.op === 'eq') return matchesEq(raw, leaf.value);
  if (raw == null) return false;
  const target = Array.isArray(leaf.value) ? leaf.value[0] : leaf.value;
  if (target == null) return false;
  if (leaf.op === 'contains') return raw.includes(target);
  if (leaf.op === 'gte' || leaf.op === 'lte') return compareNumOrLex(raw, target, leaf.op);
  if (leaf.op === 're') return matchesRegex(raw, target);
  return false;
}

export function evaluateFilterTree(node: FilterNode, entity: EntityWithMetadata): boolean {
  if (isLeaf(node)) return leafMatches(node, entity);
  if (isGroup(node)) {
    if (node.children.length === 0) return true;
    if (node.op === 'NOT') return !evaluateFilterTree(node.children[0], entity);
    return node.op === 'AND'
      ? node.children.every(c => evaluateFilterTree(c, entity))
      : node.children.some(c => evaluateFilterTree(c, entity));
  }
  return true;
}
