import { emptyTree, canonicalizeTree } from '../schemas/filterTree';
import type { FilterTree } from '../schemas/filterTree';
import { decodeTreeHex, encodeTreeHex } from './filterTreeCodec';

// Filter trees ride in the URL as a hex-encoded binary payload in the `f`
// param — hex keeps it URL-safe with no percent escapes. The codec lives in
// filterTreeCodec; this module is the URL/serialization surface.

export function encodeTree(tree: FilterTree): string {
  return encodeTreeHex(tree);
}

export function decodeTree(raw: string): FilterTree | null {
  return decodeTreeHex(raw);
}

export function parseTreeFromUrl(url: URL): FilterTree {
  const raw = url.searchParams.get('f');
  if (!raw) return emptyTree();
  return decodeTree(raw) ?? emptyTree();
}

function isTreeEmpty(tree: FilterTree): boolean {
  return tree.children.length === 0;
}

export function buildEntityUrl(tree: FilterTree, presetId?: number | null): string {
  const params = new URLSearchParams();
  if (presetId != null) params.set('preset', String(presetId));
  if (!isTreeEmpty(tree)) params.set('f', encodeTree(tree));
  const qs = params.toString();
  return qs ? `/entities?${qs}` : '/entities';
}

// Canonical-stringify two trees and compare. Group child order IS significant
// (it's what the user explicitly arranged). For `eq` leaves with array values,
// element order IS also significant — UI should preserve the order the user picks.
export function treesEqual(a: FilterTree, b: FilterTree): boolean {
  return JSON.stringify(canonicalizeTree(a)) === JSON.stringify(canonicalizeTree(b));
}

export type PresetWithTreeRef = { id: number; tree: FilterTree };

export function findMatchingPresetId(
  active: FilterTree,
  presets: PresetWithTreeRef[]
): number | null {
  for (const p of presets) {
    if (treesEqual(active, p.tree)) return p.id;
  }
  return null;
}
