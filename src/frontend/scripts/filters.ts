// Client-side state machine for the filter bar. The server renders an initial
// shell + JSON embeds; from DOMContentLoaded onward, the entire filter tree
// view is driven by `state.current` and re-rendered on every change.

import { encodeTreeHex } from '../../domain/filterTreeCodec';

type LeafOp = 'eq' | 'contains' | 'gte' | 'lte' | 're';
type GroupOp = 'AND' | 'OR' | 'NOT';

type FilterLeaf = {
  type: 'filter';
  id: string;
  key: string;
  op: LeafOp;
  value: string | string[];
};

type FilterGroup = {
  type: 'group';
  id: string;
  op: GroupOp;
  children: FilterNode[];
};

type FilterNode = FilterLeaf | FilterGroup;
type FilterTree = FilterGroup;

type AvailableFilter = {
  key: string;
  value_type: 'string' | 'number' | 'date' | 'boolean';
  entityType: string;
  distinctValues?: string[];
};

type FilterConfig = {
  selectedPresetId: number | null;
  selectedEntityType: string | null;
  isDraft: boolean;
};

const state = {
  current: emptyTree(),
  available: [] as AvailableFilter[],
  config: { selectedPresetId: null, selectedEntityType: null, isDraft: false } as FilterConfig,
  selected: new Set<string>(),
};

document.addEventListener('DOMContentLoaded', () => {
  // No-op when loaded on a page that doesn't render the filter UI. Without
  // this guard, the document-level click/keydown handlers wired below fire
  // on every page and crash if another bundle has shadowed `state` on the
  // global scope (Bun emits non-module scripts whose top-level `var`
  // declarations end up on `window`).
  if (!document.querySelector('[data-filter-tree-root]')) return;
  hydrate();
  wireSavePresetPanel();
  wirePresetCombo();
  wirePresetNameDraftDetection();
  wireDeletePresetConfirm();
  wireEntityTypeSelect();
  wirePresetSelect();
  wireTreeContainer();
  wireAddFilter();
  wireSavePresetForm();
  wireClearAll();
  wirePresetSaveChanges();
  wireSelectionToolbar();
  wireGlobalKeys();
  render();
});

// ── Hydration ────────────────────────────────────────────────────────────────

function hydrate() {
  const treeRaw = readJsonEmbed('filter-tree-initial');
  if (treeRaw && isFilterTree(treeRaw)) {
    // Normalize any legacy NOT(group) into per-leaf NOTs. The SSR already
    // does this for its DOM render, but if the JSON embed was produced by an
    // older code path we make sure the live state matches the UI model.
    state.current = normalizeTreeNots(treeRaw) as FilterTree;
  }
  const available = readJsonEmbed('filter-available');
  if (Array.isArray(available)) state.available = available as AvailableFilter[];
  const config = readJsonEmbed('filter-config');
  if (config && typeof config === 'object') {
    state.config = { ...state.config, ...(config as FilterConfig) };
  }
}

function readJsonEmbed(id: string): unknown {
  const el = document.getElementById(id);
  if (!el) return null;
  try {
    return JSON.parse(el.textContent ?? '');
  } catch {
    return null;
  }
}

function isFilterTree(v: unknown): v is FilterTree {
  return (
    !!v &&
    typeof v === 'object' &&
    (v as FilterTree).type === 'group' &&
    Array.isArray((v as FilterTree).children)
  );
}

// ── Tree helpers ─────────────────────────────────────────────────────────────

function emptyTree(): FilterTree {
  return { type: 'group', id: 'root', op: 'AND', children: [] };
}

function nextId(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.floor(Math.random() * 1e6).toString(36)}`;
}

function findNode(node: FilterNode, id: string): FilterNode | null {
  if (node.id === id) return node;
  if (node.type === 'group') {
    for (const c of node.children) {
      const found = findNode(c, id);
      if (found) return found;
    }
  }
  return null;
}

type ParentRef = { parent: FilterGroup; index: number };

function findParent(root: FilterGroup, id: string): ParentRef | null {
  for (let i = 0; i < root.children.length; i++) {
    if (root.children[i].id === id) return { parent: root, index: i };
    const child = root.children[i];
    if (child.type === 'group') {
      const inside = findParent(child, id);
      if (inside) return inside;
    }
  }
  return null;
}

function isAncestor(maybeAncestor: FilterNode, target: string): boolean {
  if (maybeAncestor.id === target) return true;
  if (maybeAncestor.type !== 'group') return false;
  return maybeAncestor.children.some(c => isAncestor(c, target));
}

function canonicalize(node: FilterNode): unknown {
  if (node.type === 'filter') {
    return { type: 'filter', key: node.key, op: node.op, value: node.value };
  }
  return {
    type: 'group',
    op: node.op,
    children: node.children.map(canonicalize),
  };
}

function treesEqual(a: FilterTree, b: FilterTree): boolean {
  return JSON.stringify(canonicalize(a)) === JSON.stringify(canonicalize(b));
}

// ── URL building ─────────────────────────────────────────────────────────────

function mergeEntityType(visible: FilterTree): FilterTree {
  // The visible tree (client state) excludes entity_type; we merge it back
  // before building a URL so the server sees the full tree. entity_type must
  // always be ANDed with whatever the user built — if the visible root is an
  // OR (or any non-AND), wrap it as a child of a fresh AND root so the type
  // filter doesn't get OR'd against the user's predicates.
  const et = state.config.selectedEntityType;
  if (!et) return visible;
  const etLeaf: FilterLeaf = {
    type: 'filter',
    id: nextId('l'),
    key: 'entity_type',
    op: 'eq',
    value: et,
  };
  if (visible.op === 'AND') {
    return { ...visible, children: [etLeaf, ...visible.children] };
  }
  return {
    type: 'group',
    id: 'root',
    op: 'AND',
    children: [etLeaf, { ...visible, id: nextId('g') }],
  };
}

function buildUrl(visible: FilterTree, presetId: number | null): string {
  const fullTree = mergeEntityType(visible);
  const params = new URLSearchParams();
  if (presetId != null) params.set('preset', String(presetId));
  if (fullTree.children.length > 0) params.set('f', encodeTreeHex(fullTree));
  const qs = params.toString();
  return qs ? `/entities?${qs}` : '/entities';
}

// ── Rendering ────────────────────────────────────────────────────────────────

function render() {
  const root = document.querySelector<HTMLElement>('[data-filter-tree-root]');
  if (!root) return;
  root.innerHTML = '';
  root.appendChild(renderNode(state.current, 0, true));

  // Preset "Save changes" button shows when the visible tree no longer matches
  // the active preset's saved tree (or when the preset name has been edited).
  // The server's initial draft verdict is preserved via `data-server-is-draft`
  // so a fresh page load with `?preset=N&f=...` (pinned-but-drifted state)
  // still surfaces the dot.
  const presetForm = document.querySelector<HTMLElement>('[data-preset-save-changes]');
  if (presetForm) {
    const treeDirty = presetTreesDiffer();
    const nameInput = presetForm.querySelector<HTMLInputElement>('[data-preset-name-input]');
    const original = nameInput?.dataset.originalName ?? '';
    const nameDirty = nameInput ? nameInput.value !== original : false;
    presetForm.dataset.isDraft =
      treeDirty || nameDirty || presetForm.dataset.serverIsDraft === 'true' ? 'true' : 'false';
  }

  refreshSelectionToolbar();
}

// Auto-apply: every filter-tree mutation calls commit(), which both re-renders
// the chips and kicks off a fetch that swaps the results region + count in
// place. The URL is updated via replaceState so the address bar always reflects
// the live tree. Stale-response races are handled by `pendingApplyId`.
let pendingApplyId = 0;

function commit() {
  render();
  applyFilters();
}

async function applyFilters() {
  const url = buildUrl(state.current, state.config.selectedPresetId);
  const myId = ++pendingApplyId;
  history.replaceState(null, '', url);
  document.body.classList.add('filter-results-loading');
  try {
    const resp = await fetch(url, { headers: { Accept: 'text/html' }, credentials: 'same-origin' });
    if (myId !== pendingApplyId) return;
    if (!resp.ok) return;
    const html = await resp.text();
    if (myId !== pendingApplyId) return;
    swapResults(html);
  } catch {
    // network failures: leave stale results in place; the next mutation retries
  } finally {
    // Only the latest in-flight request clears the loading class. A superseded
    // earlier request must NOT remove it — the newer fetch is still pending.
    if (myId === pendingApplyId) {
      document.body.classList.remove('filter-results-loading');
    }
  }
}

function swapResults(html: string) {
  const doc = new DOMParser().parseFromString(html, 'text/html');

  const newCount = doc.querySelector('[data-results-count]');
  const oldCount = document.querySelector('[data-results-count]');
  if (newCount && oldCount) oldCount.replaceWith(newCount);

  const newRegion = doc.querySelector('[data-results-region]');
  const oldRegion = document.querySelector('[data-results-region]');
  if (newRegion && oldRegion) {
    oldRegion.replaceWith(newRegion);
    document.dispatchEvent(new CustomEvent('entities:results-swapped'));
  }
}

function presetTreesDiffer(): boolean {
  const raw = readJsonEmbed('filter-selected-preset-tree');
  if (!raw || !isFilterTree(raw)) return false;
  return !treesEqual(mergeEntityType(state.current), raw);
}

// NOT(leaf) collapses into a negated chip; the wrapper itself isn't rendered.
// All other NOT shapes were eliminated on hydrate (`normalizeTreeNots`), so
// the view layer only deals with NOT(leaf) and AND/OR groups.
function renderNode(node: FilterNode, depth: number, isRoot: boolean): HTMLElement {
  if (
    node.type === 'group' &&
    node.op === 'NOT' &&
    node.children.length === 1 &&
    node.children[0].type === 'filter'
  ) {
    return renderLeaf(node.children[0], true);
  }
  if (node.type === 'filter') return renderLeaf(node, false);
  return renderGroup(node, depth, isRoot);
}

function notBtn(id: string, active: boolean, label: string): HTMLButtonElement {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = `filter-not-btn${active ? ' filter-not-btn--active' : ''}`;
  btn.dataset.toggleNot = id;
  btn.draggable = false;
  btn.setAttribute('aria-pressed', active ? 'true' : 'false');
  btn.setAttribute('aria-label', label);
  btn.title = active ? 'Remove !' : 'Negate';
  btn.textContent = '!';
  return btn;
}

function renderLeaf(leaf: FilterLeaf, negated: boolean): HTMLElement {
  const chip = document.createElement('span');
  chip.className = `filter-chip${negated ? ' filter-chip--negated' : ''}`;
  if (state.selected.has(leaf.id)) chip.classList.add('filter-chip--selected');
  chip.dataset.nodeId = leaf.id;
  chip.dataset.nodeType = 'filter';
  chip.dataset.filterKey = leaf.key;
  if (negated) chip.dataset.negated = 'true';
  chip.draggable = true;

  const grip = document.createElement('span');
  grip.className = 'filter-chip-grip';
  grip.setAttribute('aria-hidden', 'true');
  grip.textContent = '⋮⋮';
  chip.appendChild(grip);

  const content = document.createElement('span');
  content.className = 'filter-chip-content';
  content.dataset.editLeaf = '1';
  const valLabel = leafLabel(leaf);
  content.innerHTML = `<span class="filter-chip-key">${escapeHtml(formatFieldLabel(leaf.key))}:</span> <span class="filter-chip-val" title="${escapeHtml(valLabel)}">${escapeHtml(valLabel)}</span>`;
  chip.appendChild(content);

  chip.appendChild(notBtn(leaf.id, negated, `Negate ${leaf.key} filter`));

  const removeBtn = document.createElement('button');
  removeBtn.type = 'button';
  removeBtn.className = 'filter-chip-x';
  removeBtn.dataset.removeNode = '1';
  removeBtn.setAttribute('aria-label', `Remove ${leaf.key} filter`);
  removeBtn.textContent = '×';
  chip.appendChild(removeBtn);

  return chip;
}

function dropLine(parentId: string, index: number): HTMLElement {
  const line = document.createElement('span');
  line.className = 'filter-drop-line';
  line.dataset.dropLine = `${parentId}:${index}`;
  return line;
}

function renderGroup(group: FilterGroup, depth: number, isRoot: boolean): HTMLElement {
  const negated = allLeavesNegatedClient(group);
  const el = document.createElement('div');
  el.className = `filter-group${isRoot ? ' filter-group--root' : ''}${!isRoot && negated ? ' filter-group--negated' : ''}`;
  el.dataset.nodeId = group.id;
  el.dataset.nodeType = 'group';
  el.dataset.groupOp = group.op;
  el.dataset.depth = String(depth);
  if (!isRoot && negated) el.dataset.negated = 'true';
  if (!isRoot) el.draggable = true;

  if (!isRoot) {
    const grip = document.createElement('span');
    grip.className = 'filter-group-grip';
    grip.setAttribute('aria-hidden', 'true');
    grip.textContent = '⋮⋮';
    el.appendChild(grip);
  }

  if (group.children.length === 0) {
    const empty = document.createElement('span');
    empty.className = 'filter-group-empty';
    empty.textContent = 'No filters yet';
    el.appendChild(empty);
  } else {
    // Insertion-line drop zones bracket every child so the user has a drop
    // target on both sides of every node. Between two siblings the op-badge
    // is flanked by drop-lines, both targeting the same index. Each drop-line
    // is bundled with its adjacent chip / op-badge into a .filter-tree-cluster
    // so the pair wraps together and never orphans onto its own line.
    // The leading drop-line lives INSIDE the badge's cluster (not as the
    // trailing of the previous cluster) so that when the cluster wraps to a
    // new line the drop-line indents the badge to align with the chip column
    // above.
    const last = group.children.length - 1;
    group.children.forEach((child, i) => {
      const cluster = document.createElement('div');
      cluster.className = 'filter-tree-cluster';
      cluster.appendChild(dropLine(group.id, i));
      if (i > 0) {
        const badge = document.createElement('button');
        badge.type = 'button';
        badge.className = 'filter-op-badge';
        badge.dataset.togglePair = `${group.id}:${i}`;
        badge.draggable = false;
        badge.setAttribute('aria-label', `Toggle operator between filters (currently ${group.op})`);
        badge.textContent = group.op;
        cluster.appendChild(badge);
        cluster.appendChild(dropLine(group.id, i));
      }
      cluster.appendChild(renderNode(child, depth + 1, false));
      if (i === last) cluster.appendChild(dropLine(group.id, i + 1));
      el.appendChild(cluster);
    });
  }

  if (!isRoot) {
    el.appendChild(notBtn(group.id, negated, 'Negate group'));
    const removeBtn = document.createElement('button');
    removeBtn.type = 'button';
    removeBtn.className = 'filter-group-x';
    removeBtn.dataset.removeNode = '1';
    removeBtn.setAttribute('aria-label', 'Remove group');
    removeBtn.textContent = '×';
    el.appendChild(removeBtn);
  }

  return el;
}

function leafLabel(leaf: FilterLeaf): string {
  const v = leaf.value;
  if (leaf.op === 'eq') return Array.isArray(v) ? v.join(', ') : v;
  const s = Array.isArray(v) ? v[0] : v;
  if (leaf.op === 'gte' || leaf.op === 'lte') {
    if (!s) return 'null';
    return leaf.op === 'gte' ? `≥ ${s}` : `≤ ${s}`;
  }
  if (leaf.op === 're') return `/${s}/`;
  if (leaf.op === 'contains') return `~${s}`;
  return String(s);
}

function formatFieldLabel(key: string): string {
  return key
    .split('_')
    .map(w => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// ── Mutations ────────────────────────────────────────────────────────────────

function addLeaf(key: string) {
  const available = state.available.find(f => f.key === key);
  const op = defaultOpFor(available);
  const value = defaultValueFor(available);
  state.current.children.push({ type: 'filter', id: nextId('l'), key, op, value });
  commit();
}

function defaultOpFor(f: AvailableFilter | undefined): LeafOp {
  if (!f) return 'eq';
  if (f.value_type === 'string') {
    return f.distinctValues && f.distinctValues.length > 0 ? 'eq' : 're';
  }
  if (f.value_type === 'number' || f.value_type === 'date') return 'gte';
  return 'eq';
}

function defaultValueFor(f: AvailableFilter | undefined): string | string[] {
  if (f?.value_type === 'string' && f.distinctValues && f.distinctValues.length > 0) {
    return [f.distinctValues[0]];
  }
  if (f?.value_type === 'boolean') return 'true';
  return '';
}

function removeNode(id: string) {
  const ref = findParent(state.current, id);
  if (!ref) return;
  ref.parent.children.splice(ref.index, 1);
  flattenSameOp(state.current);
  pruneEmptyGroups(state.current);
  // Intentionally skip collapseSingletons: an OR (or any) group that loses a
  // sibling should keep its container so the remaining filter doesn't get
  // silently re-parented under the surrounding AND — that reads as the user's
  // OR being converted to AND.
  commit();
}

// Dissolve a group container, splicing its children up into the parent.
// Intentionally skips flattenSameOp: ungrouping must not flip AND↔OR on
// neighbouring same-op nesting as a side effect.
function ungroupNode(id: string) {
  const ref = findParent(state.current, id);
  if (!ref) return;
  const target = ref.parent.children[ref.index];
  if (target.type !== 'group') return;
  if (target.op === 'NOT') return;
  ref.parent.children.splice(ref.index, 1, ...target.children);
  collapseSingletons(state.current);
  commit();
}

// If any non-root group has exactly one child after a mutation, replace the
// group with that child in its parent. Single-child groups serve no purpose —
// except for NOT, which is unary by definition.
function collapseSingletons(group: FilterGroup) {
  for (let i = 0; i < group.children.length; i++) {
    const c = group.children[i];
    if (c.type !== 'group') continue;
    collapseSingletons(c);
    if (c.op !== 'NOT' && c.children.length === 1) {
      group.children[i] = c.children[0];
    }
  }
}

// Remove any groups left childless by an earlier splice. NOT must be unary,
// and an empty AND/OR has no semantic content; either would break the schema
// if serialised.
function pruneEmptyGroups(group: FilterGroup) {
  for (let i = group.children.length - 1; i >= 0; i--) {
    const c = group.children[i];
    if (c.type !== 'group') continue;
    pruneEmptyGroups(c);
    if (c.children.length === 0) {
      group.children.splice(i, 1);
    }
  }
}

// Clicking any op-badge in a group flips the entire group's op. Every badge
// in a group already displays the same value (the group's op), so the click
// matches what's shown. We deliberately do NOT wrap the adjacent pair in a
// new sub-group — that surprises users who clicked "AND" expecting a flip,
// not a structural change.
function togglePairOp(groupId: string, _rightIndex: number) {
  const group = findNode(state.current, groupId);
  if (!group || group.type !== 'group') return;
  if (group.op === 'NOT') return; // NOT is unary — no inter-sibling op to toggle.
  if (group.children.length < 2) return;

  group.op = group.op === 'AND' ? 'OR' : 'AND';
  flattenSameOp(state.current);
  commit();
}

// Collapse a child group whose op matches its parent's into the parent — e.g.
// `(A AND (B AND C))` becomes `(A AND B AND C)`. Keeps the tree canonical so
// equivalent expressions stringify the same way. NOT is excluded because
// `NOT(NOT(X))` is a deliberate double-negation the user chose — collapsing
// it would silently change semantics.
function flattenSameOp(group: FilterGroup) {
  for (let i = group.children.length - 1; i >= 0; i--) {
    const c = group.children[i];
    if (c.type !== 'group') continue;
    flattenSameOp(c);
    if (c.op === group.op && c.op !== 'NOT') {
      group.children.splice(i, 1, ...c.children);
    }
  }
}

// Toggle the negation of a chip or group.
//
// - Chip (leaf): wraps the leaf in NOT, or unwraps if it's already in a unary
//   NOT. The button's `id` is the leaf's id even when negated (rendering
//   collapses NOT(leaf) → negated chip), so unwrap checks the parent.
// - Group: bulk-toggle every leaf descendant to a single target state. The
//   target is the inverse of the current "all leaves negated" state, so the
//   button effectively means "make every filter inside match my new state".
//   A child chip's own ! can still flip just that one — when it does, the
//   group's ! falls back to OFF because not all leaves are negated anymore.
function toggleNot(id: string) {
  if (id === 'root') return;
  const node = findNode(state.current, id);
  if (!node) return;

  if (node.type === 'filter') {
    const ref = findParent(state.current, id);
    if (!ref) return;
    if (ref.parent.op === 'NOT' && ref.parent.children.length === 1) {
      // Already negated — remove the wrapper by replacing it in the grandparent.
      const grandRef = findParent(state.current, ref.parent.id);
      if (grandRef) {
        grandRef.parent.children.splice(grandRef.index, 1, node);
        commit();
        return;
      }
    }
    // Wrap in a fresh unary NOT.
    const notGroup: FilterGroup = {
      type: 'group',
      id: nextId('g'),
      op: 'NOT',
      children: [node],
    };
    ref.parent.children.splice(ref.index, 1, notGroup);
    commit();
    return;
  }

  // Group: bulk-set every leaf to !current-state.
  const target = !allLeavesNegatedClient(node);
  setAllLeavesNegated(node, target);
  commit();
}

// `true` iff every leaf descendant of `node` sits in a unary NOT wrapper.
// Empty groups return false. Matches the shared helper in filterTree.ts; kept
// inline because the client uses its own type aliases for FilterNode.
function allLeavesNegatedClient(node: FilterNode): boolean {
  if (node.type === 'filter') return false;
  if (node.op === 'NOT' && node.children.length === 1 && node.children[0].type === 'filter') {
    return true;
  }
  if (node.children.length === 0) return false;
  return node.children.every(allLeavesNegatedClient);
}

// Bulk-toggle every leaf descendant of `group` to the target negation state.
// Mutates in place. Walks the tree; at each leaf slot (bare leaf or NOT(leaf))
// it either wraps or unwraps to match the target. Sub-groups recurse.
function setAllLeavesNegated(group: FilterGroup, target: boolean): void {
  for (let i = 0; i < group.children.length; i++) {
    const c = group.children[i];
    if (c.type === 'filter') {
      if (target) {
        group.children[i] = { type: 'group', id: nextId('g'), op: 'NOT', children: [c] };
      }
      continue;
    }
    if (c.op === 'NOT' && c.children.length === 1 && c.children[0].type === 'filter') {
      if (!target) {
        group.children[i] = c.children[0];
      }
      continue;
    }
    setAllLeavesNegated(c, target);
  }
}

// Distribute any NOT-wrapping-a-group into per-leaf NOT wrappers within the
// group, applied at hydrate time so the live tree only has NOT(leaf). Mirrors
// `distributeGroupNots` in filterTree.ts but uses the client's `nextId`.
function normalizeTreeNots(node: FilterNode): FilterNode {
  if (node.type === 'filter') return node;
  if (node.op === 'NOT' && node.children.length === 1 && node.children[0].type === 'group') {
    return toggleEveryLeafNotClient(normalizeTreeNots(node.children[0]));
  }
  return { ...node, children: node.children.map(normalizeTreeNots) };
}

function toggleEveryLeafNotClient(node: FilterNode): FilterNode {
  if (node.type === 'filter') {
    return { type: 'group', id: nextId('g'), op: 'NOT', children: [node] };
  }
  if (node.op === 'NOT' && node.children.length === 1 && node.children[0].type === 'filter') {
    return node.children[0];
  }
  return { ...node, children: node.children.map(toggleEveryLeafNotClient) };
}

function wrapWithNew(targetId: string, draggedId: string, op: GroupOp) {
  // Remove dragged from wherever it is, then wrap it + the target in a new
  // group at the target's original position. Skip flattenSameOp so the new
  // group survives even when its op matches the parent's — the user wanted a
  // group here and we don't auto-flip ops to "preserve" it.
  if (isAncestor(findNodeOrThrow(draggedId), targetId)) return;
  if (targetId === draggedId) return;
  const draggedRef = findParent(state.current, draggedId);
  if (!draggedRef) return;
  const dragged = draggedRef.parent.children.splice(draggedRef.index, 1)[0];
  // Refind the target — its index may have shifted.
  const targetRef = findParent(state.current, targetId);
  if (!targetRef) {
    // Restore the dragged node and bail.
    draggedRef.parent.children.splice(draggedRef.index, 0, dragged);
    return;
  }
  const target = targetRef.parent.children[targetRef.index];
  const group: FilterGroup = { type: 'group', id: nextId('g'), op, children: [target, dragged] };
  targetRef.parent.children.splice(targetRef.index, 1, group);
  pruneEmptyGroups(state.current);
  collapseSingletons(state.current);
  commit();
}

function findNodeOrThrow(id: string): FilterNode {
  const n = findNode(state.current, id);
  if (!n) throw new Error(`node ${id} not found`);
  return n;
}

// When a node is the sole child of a NOT chain, drag/drop should treat the
// whole chain as one unit so the negation travels with the chip/group the
// user sees. Walks up while each parent is a unary NOT and returns the
// outermost wrapper's id.
function effectiveDragId(visualId: string): string {
  let id = visualId;
  for (;;) {
    const ref = findParent(state.current, id);
    if (!ref || ref.parent.op !== 'NOT' || ref.parent.children.length !== 1) return id;
    id = ref.parent.id;
  }
}

function moveNode(sourceId: string, dest: { parentId: string; index: number }) {
  if (sourceId === dest.parentId) return;
  const sourceNode = findNode(state.current, sourceId);
  if (!sourceNode) return;
  if (isAncestor(sourceNode, dest.parentId)) return;
  const destGroup = findNode(state.current, dest.parentId);
  if (!destGroup || destGroup.type !== 'group') return;
  // NOT groups are unary — refuse to add a sibling. The user must remove the
  // NOT first if they want to change what it wraps.
  if (destGroup.op === 'NOT') return;
  const sourceRef = findParent(state.current, sourceId);
  if (!sourceRef) return;
  const [removed] = sourceRef.parent.children.splice(sourceRef.index, 1);
  // If removal shifted indices within the same parent, adjust.
  let targetIndex = dest.index;
  if (sourceRef.parent === destGroup && sourceRef.index < dest.index) targetIndex -= 1;
  destGroup.children.splice(targetIndex, 0, removed);
  flattenSameOp(state.current);
  pruneEmptyGroups(state.current);
  collapseSingletons(state.current);
  commit();
}

function updateLeaf(id: string, patch: Partial<Pick<FilterLeaf, 'op' | 'value'>>) {
  const node = findNode(state.current, id);
  if (!node || node.type !== 'filter') return;
  if (patch.op !== undefined) node.op = patch.op;
  if (patch.value !== undefined) node.value = patch.value;
  commit();
}

// ── Selection ────────────────────────────────────────────────────────────────

function toggleSelection(id: string) {
  if (state.selected.has(id)) state.selected.delete(id);
  else state.selected.add(id);
  // Drop ids that no longer exist in the tree (e.g. removed since selection).
  for (const sid of [...state.selected]) {
    if (!findNode(state.current, sid)) state.selected.delete(sid);
  }
  render();
}

function clearSelection() {
  if (state.selected.size === 0) return;
  state.selected.clear();
  render();
}

// Find the common parent of all selected nodes. Returns null if any selected
// node has no parent (root) or if not all share the same parent group.
function commonParentOfSelection(): FilterGroup | null {
  if (state.selected.size === 0) return null;
  let parent: FilterGroup | null = null;
  for (const id of state.selected) {
    const ref = findParent(state.current, id);
    if (!ref) return null;
    if (parent && ref.parent !== parent) return null;
    parent = ref.parent;
  }
  return parent;
}

function groupNodes(ids: string[], op: GroupOp) {
  const parent = commonParentOfSelection();
  if (!parent) return;
  // Collect (index, node) pairs in tree order so the new group preserves the
  // sibling order the user sees.
  const entries: { index: number; node: FilterNode }[] = [];
  parent.children.forEach((child, index) => {
    if (ids.includes(child.id)) entries.push({ index, node: child });
  });
  if (entries.length < 2) return;
  const firstIndex = entries[0].index;
  // Remove from highest to lowest to keep indices stable.
  for (let i = entries.length - 1; i >= 0; i--) {
    parent.children.splice(entries[i].index, 1);
  }
  const newGroup: FilterGroup = {
    type: 'group',
    id: nextId('g'),
    op,
    children: entries.map(e => e.node),
  };
  parent.children.splice(firstIndex, 0, newGroup);
  state.selected.clear();
  // Skip flattenSameOp: the user explicitly picked this op via the toolbar;
  // don't silently collapse the resulting nesting even if it matches parent.
  collapseSingletons(state.current);
  commit();
}

function refreshSelectionToolbar() {
  const toolbar = document.querySelector<HTMLElement>('[data-filter-selection-toolbar]');
  if (!toolbar) return;
  const count = state.selected.size;
  if (count < 2) {
    toolbar.hidden = true;
    return;
  }
  toolbar.hidden = false;
  const countEl = toolbar.querySelector<HTMLElement>('[data-selection-count]');
  if (countEl) countEl.textContent = String(count);

  const parent = commonParentOfSelection();
  const canGroup = parent != null;
  toolbar.querySelectorAll<HTMLButtonElement>('[data-group-as]').forEach(btn => {
    btn.disabled = !canGroup;
    btn.title = canGroup
      ? ''
      : 'Selected filters must share the same parent group to be grouped together';
  });
}

function wireSelectionToolbar() {
  const toolbar = document.querySelector<HTMLElement>('[data-filter-selection-toolbar]');
  if (!toolbar) return;
  toolbar.addEventListener('click', e => {
    const btn = (e.target as HTMLElement).closest<HTMLButtonElement>(
      '[data-group-as], [data-clear-selection]'
    );
    if (!btn) return;
    if (btn.dataset.clearSelection !== undefined) {
      clearSelection();
      return;
    }
    const op = btn.dataset.groupAs as GroupOp | undefined;
    if (!op) return;
    groupNodes([...state.selected], op);
  });
}

function wireGlobalKeys() {
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && state.selected.size > 0) {
      clearSelection();
    }
  });
  // Click outside the filter tree clears selection.
  document.addEventListener('click', e => {
    if (state.selected.size === 0) return;
    const target = e.target as HTMLElement;
    if (target.closest('[data-filter-tree-root]')) return;
    if (target.closest('[data-filter-selection-toolbar]')) return;
    clearSelection();
  });
}

// ── Event wiring ─────────────────────────────────────────────────────────────

function wireTreeContainer() {
  const root = document.querySelector<HTMLElement>('[data-filter-tree-root]');
  if (!root) return;

  root.addEventListener('click', e => {
    const target = e.target as HTMLElement;
    const removeBtn = target.closest<HTMLElement>('[data-remove-node]');
    if (removeBtn) {
      const nodeEl = removeBtn.closest<HTMLElement>('[data-node-id]');
      if (nodeEl) {
        const id = nodeEl.dataset.nodeId!;
        // A group X is ambiguous — does the user want to nuke the contents or
        // just dissolve the container? Always open the confirm popover and let
        // the user pick; never short-circuit to either action. Chips are
        // unambiguous; remove immediately.
        if (nodeEl.dataset.nodeType === 'group') {
          openGroupRemoveConfirm(id, removeBtn);
        } else {
          removeNode(id);
        }
      }
      e.stopPropagation();
      return;
    }
    const badge = target.closest<HTMLElement>('[data-toggle-pair]');
    if (badge) {
      const [groupId, idxStr] = badge.dataset.togglePair!.split(':');
      togglePairOp(groupId, parseInt(idxStr, 10));
      return;
    }
    const notBtn = target.closest<HTMLElement>('[data-toggle-not]');
    if (notBtn) {
      toggleNot(notBtn.dataset.toggleNot!);
      e.stopPropagation();
      return;
    }
    // Shift-click on a leaf toggles selection without opening the editor.
    // stopPropagation prevents the document-level "click outside clears"
    // handler from firing on the same event — by the time it would run,
    // render() has detached the chip from the DOM and `closest` can't tell
    // the click happened inside the tree.
    const chip = target.closest<HTMLElement>('[data-node-type="filter"]');
    if (chip && (e.shiftKey || e.metaKey)) {
      toggleSelection(chip.dataset.nodeId!);
      e.preventDefault();
      e.stopPropagation();
      return;
    }
    // Plain click on the chip body opens the leaf editor.
    const editTarget = target.closest<HTMLElement>('[data-edit-leaf]');
    if (editTarget) {
      const leafChip = editTarget.closest<HTMLElement>('[data-node-id]');
      if (leafChip) openLeafEditor(leafChip.dataset.nodeId!);
    }
  });

  // ── Drag and drop ──
  root.addEventListener('dragstart', e => {
    const target = e.target as HTMLElement;
    // Drags initiated from a badge / × button / ¬ button would otherwise
    // bubble up and start a drag on the enclosing group container. Suppress.
    if (target.closest('.filter-op-badge, [data-remove-node], [data-toggle-not]')) {
      e.preventDefault();
      return;
    }
    const node = target.closest<HTMLElement>('[data-node-id]');
    if (!node) return;
    const id = node.dataset.nodeId!;
    if (id === 'root') {
      e.preventDefault();
      return;
    }
    // A negated chip's data-node-id is the inner leaf, but the user is
    // dragging the visible (NOT-wrapped) unit — promote to the outermost
    // wrapper so negation travels with the move.
    e.dataTransfer?.setData('text/plain', effectiveDragId(id));
    e.dataTransfer!.effectAllowed = 'move';
    node.classList.add('filter-node--dragging');
    document.body.classList.add('filter-dragging');
  });

  root.addEventListener('dragend', e => {
    const node = (e.target as HTMLElement).closest<HTMLElement>('[data-node-id]');
    node?.classList.remove('filter-node--dragging');
    document.body.classList.remove('filter-dragging');
    clearDropFeedback(root);
  });

  root.addEventListener('dragover', e => {
    const dropTarget = resolveDropTarget(e.target as HTMLElement);
    if (!dropTarget) return;
    e.preventDefault();
    e.dataTransfer!.dropEffect = 'move';
    clearDropFeedback(root);
    dropTarget.classList.add('filter-drop-active');
    showDropHint(dropTarget);
  });

  root.addEventListener('drop', e => {
    e.preventDefault();
    const draggedId = e.dataTransfer?.getData('text/plain');
    if (!draggedId) return;
    const targetEl = resolveDropTarget(e.target as HTMLElement);
    document.body.classList.remove('filter-dragging');
    if (!targetEl) {
      clearDropFeedback(root);
      return;
    }
    handleDrop(draggedId, targetEl);
    clearDropFeedback(root);
  });
}

function clearDropFeedback(root: HTMLElement) {
  root
    .querySelectorAll('.filter-drop-active')
    .forEach(el => el.classList.remove('filter-drop-active'));
  root.querySelectorAll('.filter-drop-hint').forEach(el => el.remove());
}

function showDropHint(target: HTMLElement) {
  const hint = document.createElement('span');
  hint.className = 'filter-drop-hint';

  if (target.dataset.dropLine) {
    hint.textContent = 'Move here';
  } else if (target.dataset.nodeType === 'filter') {
    const key = target.dataset.filterKey ?? 'filter';
    hint.textContent = `Create a new group with ${formatFieldLabel(key)}`;
  } else if (target.dataset.nodeType === 'group') {
    hint.textContent = 'Append to group';
  } else {
    return;
  }
  target.appendChild(hint);
}

function resolveDropTarget(el: HTMLElement): HTMLElement | null {
  // Op badges, × and NOT pills are not drop targets — dropping on them
  // would otherwise bubble up to the enclosing group and surprise the user
  // with an "append to group" outcome.
  if (el.closest('.filter-op-badge, [data-remove-node], [data-toggle-not]')) return null;
  // Insertion lines beat chip drops beat group container drops. Drop lines are
  // most specific (a precise position between two siblings); chips imply
  // "create a sub-group with this filter"; groups imply "append to group end".
  const line = el.closest<HTMLElement>('[data-drop-line]');
  if (line) return line;
  const chip = el.closest<HTMLElement>('[data-node-type="filter"]');
  if (chip) return chip;
  return el.closest<HTMLElement>('[data-node-type="group"]');
}

function handleDrop(draggedId: string, targetEl: HTMLElement) {
  if (targetEl.dataset.dropLine) {
    const [parentId, idxStr] = targetEl.dataset.dropLine.split(':');
    moveNode(draggedId, { parentId, index: parseInt(idxStr, 10) });
    return;
  }
  const targetId = targetEl.dataset.nodeId;
  if (!targetId || targetId === draggedId) return;
  if (targetEl.dataset.nodeType === 'filter') {
    // Drop on a chip → wrap the two in a NEW sub-group using the parent's op
    // verbatim (no auto-flip). The user can click the inner badge to change
    // the op if they want a different operator inside this new group.
    // Promote the visible target to its NOT-wrapper so a negated chip wraps
    // as a unit (the new group sits where the negated chip sat).
    const effectiveTargetId = effectiveDragId(targetId);
    const ref = findParent(state.current, effectiveTargetId);
    const parentOp: GroupOp = ref?.parent.op ?? 'AND';
    const wrapOp: GroupOp = parentOp === 'NOT' ? 'AND' : parentOp;
    wrapWithNew(effectiveTargetId, draggedId, wrapOp);
    return;
  }
  if (targetEl.dataset.nodeType === 'group') {
    const group = findNode(state.current, targetId);
    if (!group || group.type !== 'group') return;
    moveNode(draggedId, { parentId: targetId, index: group.children.length });
  }
}

function wireEntityTypeSelect() {
  const select = document.querySelector<HTMLSelectElement>('[data-entity-type-select]');
  if (!select) return;
  const raw = select.dataset.baseUrlTemplate;
  let template: { type: string; url: string }[] = [];
  if (raw) {
    try {
      template = JSON.parse(raw);
    } catch {
      template = [];
    }
  }
  select.addEventListener('change', () => {
    const t = template.find(x => x.type === select.value);
    if (t) location.href = t.url;
  });
}

function wirePresetSelect() {
  const presetSelect = document.querySelector<HTMLSelectElement>('[data-preset-select]');
  if (!presetSelect) return;
  presetSelect.addEventListener('change', () => {
    const v = presetSelect.value;
    if (v) location.href = v;
  });
}

function wireAddFilter() {
  const select = document.querySelector<HTMLSelectElement>('[data-filter-add-select]');
  if (!select) return;
  select.addEventListener('change', () => {
    const key = select.value;
    if (!key) return;
    addLeaf(key);
    select.value = '';
    // Open editor on the newly added leaf (last child of root).
    const last = state.current.children[state.current.children.length - 1];
    if (last && last.type === 'filter') openLeafEditor(last.id);
  });
}

function wireSavePresetForm() {
  const form = document.querySelector<HTMLFormElement>('[data-save-preset-form]');
  if (!form) return;
  form.addEventListener('submit', () => {
    const input = form.querySelector<HTMLInputElement>('[data-save-preset-tree]');
    if (!input) return;
    input.value = encodeTreeHex(mergeEntityType(state.current));
  });
}

function wireClearAll() {
  // The Clear-all link is server-rendered; nothing to wire — it navigates.
}

function wirePresetSaveChanges() {
  const btn = document.querySelector<HTMLButtonElement>('[data-preset-save-submit]');
  if (!btn) return;
  const presetIdRaw = btn.dataset.presetId;
  const presetId = presetIdRaw ? parseInt(presetIdRaw, 10) : NaN;
  if (isNaN(presetId)) return;
  btn.addEventListener('click', () => {
    const nameInput = document.querySelector<HTMLInputElement>('[data-preset-name-input]');
    const name = (nameInput?.value ?? '').trim();
    if (!name) return;
    const form = document.createElement('form');
    form.method = 'post';
    form.action = `/entities/presets/${presetId}`;
    form.style.display = 'none';
    const nameField = document.createElement('input');
    nameField.name = 'name';
    nameField.value = name;
    form.appendChild(nameField);
    const treeField = document.createElement('input');
    treeField.name = 'tree';
    treeField.value = encodeTreeHex(mergeEntityType(state.current));
    form.appendChild(treeField);
    document.body.appendChild(form);
    form.submit();
  });
}

// ── Leaf editor ──────────────────────────────────────────────────────────────

function openLeafEditor(leafId: string) {
  const leaf = findNode(state.current, leafId);
  if (!leaf || leaf.type !== 'filter') return;
  const initialAvailable = state.available.find(a => a.key === leaf.key);
  if (!initialAvailable) return;

  const existing = document.querySelector<HTMLElement>('[data-leaf-editor]');
  existing?.remove();

  // While the editor is open the chip is "disabled" — visually greyed out so
  // the user can see the filter is being excluded from the value computation.
  const chip = document.querySelector<HTMLElement>(`[data-node-id="${leafId}"]`);
  chip?.classList.add('filter-chip--editing');

  const editor = document.createElement('div');
  editor.className = 'filter-widget-panel';
  editor.dataset.leafEditor = '1';
  editor.dataset.filterType = initialAvailable.value_type;
  editor.style.position = 'absolute';
  editor.innerHTML = '';

  const label = document.createElement('span');
  label.className = 'filter-widget-label';
  label.textContent = formatFieldLabel(leaf.key);
  editor.appendChild(label);

  // `body` and `activeAvailable` are mutable so the async fetch for the
  // unrestricted value set can replace the rendered widget once it lands.
  let activeAvailable: AvailableFilter = initialAvailable;
  let body = renderWidgetBody(leaf, activeAvailable);
  editor.appendChild(body);

  const apply = document.createElement('button');
  apply.type = 'button';
  apply.className = 'filter-btn filter-widget-apply';
  apply.textContent = 'Apply';
  editor.appendChild(apply);

  const cancel = document.createElement('button');
  cancel.type = 'button';
  cancel.className = 'filter-clear filter-widget-cancel';
  cancel.textContent = 'Cancel';
  editor.appendChild(cancel);

  document.body.appendChild(editor);

  positionEditor(editor, leafId);

  // Fetch the available-values set with this leaf removed from the tree, so
  // the multi-select shows every value reachable when the filter is disabled
  // (not just the narrow set its own predicate currently allows).
  fetchAvailableWithoutLeaf(leafId).then(unrestricted => {
    if (!editor.isConnected) return;
    const match = unrestricted.find(a => a.key === leaf.key);
    if (!match) return;
    activeAvailable = match;
    const fresh = renderWidgetBody(leaf, activeAvailable);
    body.replaceWith(fresh);
    body = fresh;
    editor.dataset.filterType = activeAvailable.value_type;
    positionEditor(editor, leafId);
  });

  const close = () => {
    editor.remove();
    chip?.classList.remove('filter-chip--editing');
    document.removeEventListener('keydown', escListener);
    document.removeEventListener('mousedown', outsideClick);
  };

  apply.addEventListener('click', () => {
    const patch = readWidgetBody(body, activeAvailable);
    if (patch) updateLeaf(leafId, patch);
    close();
  });
  cancel.addEventListener('click', close);
  document.addEventListener('keydown', escListener);

  function escListener(e: KeyboardEvent) {
    if (e.key === 'Escape') close();
  }

  document.addEventListener('mousedown', outsideClick);
  function outsideClick(e: MouseEvent) {
    if (!editor.contains(e.target as Node)) close();
  }
}

// Build a clone of state.current with `leafId` removed, then collapse any
// groups it leaves empty. Used by the editor to ask the server "what values
// would be available if this leaf were turned off?".
function cloneTreeWithoutLeaf(tree: FilterTree, leafId: string): FilterTree {
  function strip(node: FilterNode): FilterNode | null {
    if (node.type === 'filter') return node.id === leafId ? null : { ...node };
    const kept: FilterNode[] = [];
    for (const c of node.children) {
      const cloned = strip(c);
      if (cloned !== null) kept.push(cloned);
    }
    if (kept.length === 0) return null;
    return { ...node, children: kept };
  }
  const stripped = strip(tree);
  if (stripped === null || stripped.type === 'filter') return emptyTree();
  return stripped as FilterTree;
}

async function fetchAvailableWithoutLeaf(leafId: string): Promise<AvailableFilter[]> {
  const cloned = cloneTreeWithoutLeaf(state.current, leafId);
  const baseUrl = buildUrl(cloned, state.config.selectedPresetId);
  // `all_distinct=1` tells the handler to skip the default 20-value cap so
  // the editor's multi-select gets every value, not a truncated set.
  const url = baseUrl.includes('?') ? `${baseUrl}&all_distinct=1` : `${baseUrl}?all_distinct=1`;
  try {
    const resp = await fetch(url, { headers: { Accept: 'text/html' }, credentials: 'same-origin' });
    if (!resp.ok) return state.available;
    const html = await resp.text();
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const embed = doc.getElementById('filter-available');
    if (!embed) return state.available;
    const parsed = JSON.parse(embed.textContent ?? '');
    if (Array.isArray(parsed)) return parsed as AvailableFilter[];
  } catch {
    // Fall back to whatever's already in client state; better than nothing.
  }
  return state.available;
}

function positionEditor(editor: HTMLElement, leafId: string) {
  const chip = document.querySelector<HTMLElement>(`[data-node-id="${leafId}"]`);
  if (!chip) return;
  const rect = chip.getBoundingClientRect();
  editor.style.top = `${rect.bottom + window.scrollY + 4}px`;
  editor.style.left = `${rect.left + window.scrollX}px`;
}

// Confirm popover for the group × — disambiguates "remove the whole subtree"
// from "dissolve just this container, keep the chips inside". Anchored to the
// × button so it appears right where the user clicked.
function openGroupRemoveConfirm(groupId: string, anchor: HTMLElement) {
  document.querySelector<HTMLElement>('[data-group-remove-confirm]')?.remove();

  const panel = document.createElement('div');
  panel.className = 'filter-widget-panel filter-group-remove-confirm';
  panel.dataset.groupRemoveConfirm = '1';
  panel.style.position = 'absolute';

  const removeAll = document.createElement('button');
  removeAll.type = 'button';
  removeAll.className = 'filter-btn filter-btn-danger';
  removeAll.textContent = 'Remove all';
  removeAll.title = 'Delete this group and every filter inside it';
  panel.appendChild(removeAll);

  const ungroupBtn = document.createElement('button');
  ungroupBtn.type = 'button';
  ungroupBtn.className = 'filter-btn filter-btn-secondary';
  ungroupBtn.textContent = 'Ungroup';
  ungroupBtn.title = 'Keep the filters, remove just the grouping container';
  panel.appendChild(ungroupBtn);

  const cancel = document.createElement('button');
  cancel.type = 'button';
  cancel.className = 'filter-clear';
  cancel.textContent = 'Cancel';
  panel.appendChild(cancel);

  document.body.appendChild(panel);

  const rect = anchor.getBoundingClientRect();
  panel.style.top = `${rect.bottom + window.scrollY + 4}px`;
  panel.style.left = `${rect.right + window.scrollX - panel.offsetWidth}px`;

  function close() {
    panel.remove();
    document.removeEventListener('keydown', escListener);
    document.removeEventListener('mousedown', outsideClick);
  }
  function escListener(e: KeyboardEvent) {
    if (e.key === 'Escape') close();
  }
  function outsideClick(e: MouseEvent) {
    if (!panel.contains(e.target as Node)) close();
  }

  removeAll.addEventListener('click', () => {
    close();
    removeNode(groupId);
  });
  ungroupBtn.addEventListener('click', () => {
    close();
    ungroupNode(groupId);
  });
  cancel.addEventListener('click', close);
  document.addEventListener('keydown', escListener);
  document.addEventListener('mousedown', outsideClick);
}

function renderWidgetBody(leaf: FilterLeaf, available: AvailableFilter): HTMLElement {
  const body = document.createElement('div');
  body.className = 'filter-widget-body';

  if (available.value_type === 'date') {
    const gte = inputEl('date', 'gte', singleValue(leaf, 'gte'));
    const sep = document.createElement('span');
    sep.className = 'filter-sep';
    sep.textContent = '–';
    const lte = inputEl('date', 'lte', singleValue(leaf, 'lte'));
    body.append(gte, sep, lte);
    return body;
  }
  if (available.value_type === 'number') {
    const gte = inputEl('number', 'gte', singleValue(leaf, 'gte'));
    gte.placeholder = 'min';
    const sep = document.createElement('span');
    sep.className = 'filter-sep';
    sep.textContent = '–';
    const lte = inputEl('number', 'lte', singleValue(leaf, 'lte'));
    lte.placeholder = 'max';
    body.append(gte, sep, lte);
    return body;
  }
  if (available.value_type === 'boolean') {
    const sel = document.createElement('select');
    sel.className = 'filter-select';
    sel.dataset.op = 'eq';
    ['true', 'false'].forEach(v => {
      const o = document.createElement('option');
      o.value = v;
      o.textContent = v.charAt(0).toUpperCase() + v.slice(1);
      if (singleValue(leaf, 'eq') === v) o.selected = true;
      sel.appendChild(o);
    });
    body.appendChild(sel);
    return body;
  }
  // string
  if (available.distinctValues && available.distinctValues.length > 0) {
    return renderStringWidget(leaf, available, body);
  }
  const input = inputEl('text', 're', singleValue(leaf, 're') || singleValue(leaf, 'contains'));
  input.placeholder = 'regex…';
  body.appendChild(input);
  return body;
}

function renderStringWidget(
  leaf: FilterLeaf,
  available: AvailableFilter,
  body: HTMLElement
): HTMLElement {
  const wrap = document.createElement('div');
  wrap.className = 'filter-string-modes';
  const activeMode = leaf.op === 're' ? 'regex' : 'multi';
  wrap.dataset.activeMode = activeMode;

  const tabs = document.createElement('div');
  tabs.className = 'filter-mode-tabs';
  const multiTab = modeTabBtn('multi', activeMode === 'multi');
  const regexTab = modeTabBtn('regex', activeMode === 'regex');
  tabs.append(multiTab, regexTab);
  wrap.appendChild(tabs);

  const multiPane = document.createElement('div');
  multiPane.dataset.modeContent = 'multi';
  if (activeMode !== 'multi') multiPane.style.display = 'none';
  const select = document.createElement('select');
  select.multiple = true;
  select.className = 'filter-multi-select';
  select.size = Math.min(available.distinctValues!.length, 6);
  select.dataset.op = 'eq';
  const eqValues = leaf.op === 'eq' ? (Array.isArray(leaf.value) ? leaf.value : [leaf.value]) : [];
  available.distinctValues!.forEach(v => {
    const o = document.createElement('option');
    o.value = v;
    o.textContent = v;
    if (eqValues.includes(v)) o.selected = true;
    select.appendChild(o);
  });
  multiPane.appendChild(select);

  const regexPane = document.createElement('div');
  regexPane.dataset.modeContent = 'regex';
  if (activeMode !== 'regex') regexPane.style.display = 'none';
  const regexInput = inputEl(
    'text',
    're',
    leaf.op === 're' ? (Array.isArray(leaf.value) ? leaf.value[0] : leaf.value) : ''
  );
  regexInput.placeholder = 'regex…';
  regexPane.appendChild(regexInput);

  wrap.append(multiPane, regexPane);
  body.appendChild(wrap);

  const switchMode = (mode: 'multi' | 'regex') => {
    wrap.dataset.activeMode = mode;
    multiPane.style.display = mode === 'multi' ? '' : 'none';
    regexPane.style.display = mode === 'regex' ? '' : 'none';
    multiTab.classList.toggle('filter-mode-tab--active', mode === 'multi');
    regexTab.classList.toggle('filter-mode-tab--active', mode === 'regex');
  };
  multiTab.addEventListener('click', () => switchMode('multi'));
  regexTab.addEventListener('click', () => switchMode('regex'));

  return body;
}

function modeTabBtn(mode: string, active: boolean): HTMLButtonElement {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = `filter-mode-tab${active ? ' filter-mode-tab--active' : ''}`;
  b.dataset.modeTab = mode;
  b.textContent = mode === 'multi' ? 'Values' : 'Regex';
  return b;
}

function inputEl(type: string, op: string, value: string): HTMLInputElement {
  const i = document.createElement('input');
  i.type = type;
  i.className = 'filter-input';
  i.dataset.op = op;
  i.value = value;
  return i;
}

function singleValue(leaf: FilterLeaf, op: LeafOp): string {
  if (leaf.op !== op) return '';
  const v = leaf.value;
  return Array.isArray(v) ? (v[0] ?? '') : v;
}

type LeafPatch = Partial<Pick<FilterLeaf, 'op' | 'value'>> | null;

function readRangeBody(body: HTMLElement): LeafPatch {
  const gte = body.querySelector<HTMLInputElement>('input[data-op="gte"]')?.value ?? '';
  const lte = body.querySelector<HTMLInputElement>('input[data-op="lte"]')?.value ?? '';
  if (gte) return { op: 'gte', value: gte };
  if (lte) return { op: 'lte', value: lte };
  // Both bounds blank → commit an IS NULL filter (match entities with no value).
  return { op: 'gte', value: '' };
}

function readStringModesBody(modes: HTMLElement): LeafPatch {
  if (modes.dataset.activeMode === 'regex') {
    const v = modes.querySelector<HTMLInputElement>('input[data-op="re"]')?.value ?? '';
    return v ? { op: 're', value: v } : null;
  }
  const select = modes.querySelector<HTMLSelectElement>('select.filter-multi-select');
  if (!select) return null;
  const values = Array.from(select.selectedOptions).map(o => o.value);
  if (values.length === 0) return null;
  return { op: 'eq', value: values.length === 1 ? values[0] : values };
}

function readWidgetBody(body: HTMLElement, available: AvailableFilter): LeafPatch {
  if (available.value_type === 'date' || available.value_type === 'number') {
    return readRangeBody(body);
  }
  if (available.value_type === 'boolean') {
    const v = body.querySelector<HTMLSelectElement>('select')?.value ?? 'true';
    return { op: 'eq', value: v };
  }
  const modes = body.querySelector<HTMLElement>('[data-active-mode]');
  if (modes) return readStringModesBody(modes);
  const v = body.querySelector<HTMLInputElement>('input[data-op="re"]')?.value ?? '';
  return v ? { op: 're', value: v } : null;
}

// ── Surviving helpers ────────────────────────────────────────────────────────

function wireSavePresetPanel() {
  const btn = document.getElementById('save-preset-btn');
  const panel = document.getElementById('save-preset-panel');
  const cancel = document.getElementById('save-preset-cancel');

  if (btn && panel) {
    btn.addEventListener('click', () => {
      const treeInput = panel.querySelector<HTMLInputElement>('[data-save-preset-tree]');
      if (treeInput) treeInput.value = encodeTreeHex(mergeEntityType(state.current));
      panel.style.display = '';
      panel.querySelector<HTMLInputElement>('input[name="name"]')?.focus();
    });
  }
  if (cancel && panel) {
    cancel.addEventListener('click', () => {
      panel.style.display = 'none';
    });
  }
}

function wirePresetCombo() {
  const combo = document.querySelector<HTMLElement>('[data-preset-combo]');
  if (!combo) return;

  const toggle = combo.querySelector<HTMLButtonElement>('[data-preset-combo-toggle]');
  const list = combo.querySelector<HTMLElement>('[data-preset-combo-list]');
  if (!toggle || !list) return;

  function open() {
    list!.hidden = false;
    toggle!.setAttribute('aria-expanded', 'true');
  }
  function close() {
    list!.hidden = true;
    toggle!.setAttribute('aria-expanded', 'false');
  }

  toggle.addEventListener('click', () => {
    if (list.hidden) open();
    else close();
  });

  document.addEventListener('click', e => {
    if (!combo.contains(e.target as Node)) close();
  });

  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && !list.hidden) {
      close();
      toggle.focus();
    }
  });
}

function wirePresetNameDraftDetection() {
  const form = document.querySelector<HTMLElement>('[data-preset-save-changes]');
  if (!form) return;
  const input = form.querySelector<HTMLInputElement>('[data-preset-name-input]');
  if (!input) return;
  form.dataset.serverIsDraft = form.dataset.isDraft ?? 'false';
  input.addEventListener('input', () => {
    const originalName = input.dataset.originalName ?? '';
    const nameChanged = input.value !== originalName;
    if (nameChanged) form.dataset.isDraft = 'true';
    else if (form.dataset.serverIsDraft !== 'true') form.dataset.isDraft = 'false';
  });
}

function wireDeletePresetConfirm() {
  const form = document.querySelector<HTMLFormElement>('[data-preset-delete-form]');
  if (!form) return;
  const name = form.dataset.presetName ?? 'this preset';
  form.addEventListener('submit', e => {
    if (!confirm(`Delete preset "${name}"?`)) e.preventDefault();
  });
}
