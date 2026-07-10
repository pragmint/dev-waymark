// Helpers for constructing the new filter-tree URL format in Playwright tests.

import { decodeTreeHex, encodeTreeHex } from '../src/domain/filterTreeCodec';
import type { FilterTree } from '../src/schemas/filterTree';

type Leaf = {
  type: 'filter';
  id: string;
  key: string;
  op: 'eq' | 'contains' | 'gte' | 'lte';
  value: string | string[];
};

type Group = {
  type: 'group';
  id: string;
  op: 'AND' | 'OR';
  children: (Leaf | Group)[];
};

let _id = 0;
function nextId(prefix: string): string {
  _id += 1;
  return `${prefix}_${_id}`;
}

export function leaf(key: string, op: Leaf['op'], value: string | string[]): Leaf {
  return { type: 'filter', id: nextId('l'), key, op, value };
}

export function group(op: Group['op'], children: (Leaf | Group)[]): Group {
  return { type: 'group', id: nextId('g'), op, children };
}

export function decodeTreeFromUrl(rawUrl: string): FilterTree | null {
  const f = new URL(rawUrl).searchParams.get('f');
  if (!f) return null;
  return decodeTreeHex(f);
}

export function entitiesUrl(
  entityType: string | null,
  extraChildren: (Leaf | Group)[] = [],
  extraParams: Record<string, string | number> = {}
): string {
  const children: (Leaf | Group)[] = [];
  if (entityType) children.push(leaf('entity_type', 'eq', entityType));
  children.push(...extraChildren);

  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(extraParams)) params.set(k, String(v));
  if (children.length > 0) {
    const tree: Group = { type: 'group', id: 'root', op: 'AND', children };
    params.set('f', encodeTreeHex(tree));
  }
  const qs = params.toString();
  return qs ? `/entities?${qs}` : '/entities';
}
