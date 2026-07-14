import type { Context } from 'hono';
import { getEntityRepo } from '../db/source/index';
import { getAppStateRepo } from '../db/appState/index';
import type { PagedEntities } from '../db/entityRepository';
import type { AvailableFilter } from '../schemas/entity';
import type { PresetWithTree } from '../schemas/preset';
import { collectLeaves, emptyTree, isLeaf, makeLeaf } from '../schemas/filterTree';
import type { FilterTree } from '../schemas/filterTree';
import { EntitiesPage } from '../frontend/Pages/EntitiesPage';
import {
  buildEntityUrl,
  encodeTree,
  findMatchingPresetId,
  parseTreeFromUrl,
  treesEqual,
} from '../domain/filterUrl';

const DEFAULT_PAGE_SIZE = 50;
const MAX_PAGE_SIZE = 200;

function parsePositiveInt(raw: string | undefined, fallback: number, max?: number): number {
  if (!raw) return fallback;
  const n = parseInt(raw, 10);
  if (isNaN(n) || n < 1) return fallback;
  return max ? Math.min(n, max) : n;
}

function findEntityTypeValue(tree: FilterTree): string | null {
  for (const leaf of collectLeaves(tree)) {
    if (leaf.key === 'entity_type' && leaf.op === 'eq') {
      return Array.isArray(leaf.value) ? (leaf.value[0] ?? null) : leaf.value;
    }
  }
  return null;
}

type PresetResolution = {
  selectedPresetId: number | null;
  selectedPresetTree: FilterTree | null;
  isDraft: boolean;
};

// Resolve the "active" preset. When a `preset=N` URL param is present and
// valid, that preset is pinned regardless of tree matching (so the dropdown
// stays selected while the user drafts changes). Otherwise fall back to
// matching the current tree against saved presets.
function resolvePreset(
  presetParam: string | undefined,
  activeTree: FilterTree,
  presetsWithTree: PresetWithTree[]
): PresetResolution {
  const presetParamId = presetParam ? parseInt(presetParam, 10) : NaN;
  const pinned = !isNaN(presetParamId)
    ? presetsWithTree.find(p => p.id === presetParamId)
    : undefined;

  if (pinned) {
    return {
      selectedPresetId: pinned.id,
      selectedPresetTree: pinned.tree,
      isDraft: !treesEqual(activeTree, pinned.tree),
    };
  }

  const presetRefs = presetsWithTree.map(p => ({ id: p.id, tree: p.tree }));
  const matchedId = findMatchingPresetId(activeTree, presetRefs);
  const matched = matchedId != null ? presetsWithTree.find(p => p.id === matchedId) : undefined;
  return {
    selectedPresetId: matchedId,
    selectedPresetTree: matched?.tree ?? null,
    isDraft: false,
  };
}

export async function entitiesHandler(c: Context) {
  const repo = getEntityRepo();
  const appStateRepo = getAppStateRepo();

  const url = new URL(c.req.url);
  const activeTree = parseTreeFromUrl(url);

  const perPage = parsePositiveInt(c.req.query('per_page'), DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE);
  const page = parsePositiveInt(c.req.query('page'), 1);

  const entityTypes = await repo.listEntityTypes();
  const selectedEntityType = findEntityTypeValue(activeTree);

  // Redirect to the first entity type when none is selected. entity_type must
  // AND with the rest of the tree — if the user's tree is an OR root, wrap it
  // so the type filter isn't OR'd against the predicates.
  if (!selectedEntityType && entityTypes.length > 0) {
    const etLeaf = makeLeaf('entity_type', 'eq', entityTypes[0]);
    const existing = activeTree.children.filter(c => !(isLeaf(c) && c.key === 'entity_type'));
    const seededTree: FilterTree =
      activeTree.op === 'AND'
        ? { ...activeTree, children: [etLeaf, ...existing] }
        : {
            type: 'group',
            id: 'root',
            op: 'AND',
            children: [etLeaf, { ...activeTree, id: `${activeTree.id}_inner`, children: existing }],
          };
    const redirectParams = new URLSearchParams(url.searchParams);
    redirectParams.set('f', encodeTree(seededTree));
    return c.redirect(`/entities?${redirectParams.toString()}`, 302);
  }

  // The filter editor refetches available values with the leaf-being-edited
  // removed and needs every distinct value (not the capped initial-render set)
  // — when `all_distinct=1` is set, lift the per-field cap.
  const allDistinctValues = c.req.query('all_distinct') === '1';

  let pagedResult: PagedEntities;
  let availableFilters: AvailableFilter[];
  let metadataKeys: string[];
  if (selectedEntityType) {
    pagedResult = await repo.listPaged(activeTree, {
      limit: perPage,
      offset: (page - 1) * perPage,
    });
    availableFilters = await repo.getAvailableFilters(activeTree, { allDistinctValues });
    // Columns reflect every key the type defines, not just keys with non-null
    // values in the current (possibly null-filtered) population.
    metadataKeys = await repo.listMetadataKeys(selectedEntityType);
  } else {
    // No entity types means a (near-)empty entities table — the unfiltered
    // population is the only case rendered without a type selected.
    pagedResult = { pageEntities: [], total: 0 };
    availableFilters = await repo.getAvailableFilters(emptyTree());
    metadataKeys = [];
  }

  const presetsWithTree = await appStateRepo.listPresetsWithTree();
  const presets = presetsWithTree.map(p => ({
    id: p.id,
    name: p.name,
    url: buildEntityUrl(p.tree, p.id),
  }));

  const { selectedPresetId, selectedPresetTree, isDraft } = resolvePreset(
    c.req.query('preset'),
    activeTree,
    presetsWithTree
  );

  return c.html(
    <EntitiesPage
      entities={pagedResult.pageEntities}
      totalCount={pagedResult.total}
      page={page}
      perPage={perPage}
      activeTree={activeTree}
      availableFilters={availableFilters}
      metadataKeys={metadataKeys}
      entityTypes={entityTypes}
      presets={presets}
      selectedPresetId={selectedPresetId}
      selectedPresetTree={selectedPresetTree}
      selectedEntityType={selectedEntityType}
      isDraft={isDraft}
    />
  );
}
