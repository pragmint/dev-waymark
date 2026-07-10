import { splitListValue } from '../schemas/entity';
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

type LeafValue = { raw: string | null; isList: boolean };

function leafValueFor(leaf: FilterLeaf, entity: EntityWithMetadata): LeafValue {
  const getter = ENTITY_FIELD_GETTERS[leaf.key];
  if (getter) return { raw: getter(entity), isList: false };
  const meta = entity.metadata.find(m => m.key === leaf.key);
  return { raw: meta?.value ?? null, isList: meta?.value_type === 'list' };
}

// eq against a list-typed value is membership: the list includes the value.
// Ops other than eq keep operating on the raw joined string.
function matchesEq({ raw, isList }: LeafValue, value: string | string[]): boolean {
  if (raw == null) return false;
  const requested = Array.isArray(value) ? value : [value];
  if (isList) {
    const elements = splitListValue(raw);
    return requested.some(v => elements.includes(v));
  }
  return requested.includes(raw);
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
  const leafValue = leafValueFor(leaf, entity);
  if (leaf.op === 'eq') return matchesEq(leafValue, leaf.value);
  const raw = leafValue.raw;
  const target = Array.isArray(leaf.value) ? leaf.value[0] : leaf.value;
  // Empty-value range filters carry IS NULL semantics — a date/number filter
  // with no bound specified matches entities whose value is unset.
  if ((leaf.op === 'gte' || leaf.op === 'lte') && !target) return raw == null;
  if (raw == null) return false;
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
