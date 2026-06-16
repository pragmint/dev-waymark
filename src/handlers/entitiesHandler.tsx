import type { Context } from 'hono';
import { getEntityRepo } from '../db/source/index';
import { getAppStateRepo } from '../db/appState/index';
import type { EntityRepository, PagedEntities } from '../db/entityRepository';
import { MetaFilterOpSchema } from '../schemas/entity';
import type { AvailableFilter, MetaFilter } from '../schemas/entity';
import type { PresetWithFilters } from '../schemas/preset';
import { EntitiesPage } from '../frontend/Pages/EntitiesPage';
import {
  buildEntityUrl,
  findMatchingPresetId,
  metaFiltersEqual,
  META_FILTER_RE,
} from '../domain/filterUrl';

const DEFAULT_PAGE_SIZE = 50;
const MAX_PAGE_SIZE = 200;

function parsePositiveInt(raw: string | undefined, fallback: number, max?: number): number {
  if (!raw) return fallback;
  const n = parseInt(raw, 10);
  if (isNaN(n) || n < 1) return fallback;
  return max ? Math.min(n, max) : n;
}

function parseFiltersFromUrl(url: URL): MetaFilter[] {
  const filters: MetaFilter[] = [];
  for (const [name, value] of url.searchParams) {
    if (!value) continue;
    const match = META_FILTER_RE.exec(name);
    if (!match) continue;
    const [, key, opRaw] = match;
    const parsed = MetaFilterOpSchema.safeParse(opRaw);
    if (!parsed.success) continue;
    filters.push({ key, op: parsed.data, value });
  }
  return filters;
}

async function loadUnfilteredView(repo: EntityRepository): Promise<{
  ids: number[];
  available: AvailableFilter[];
  entityTypes: string[];
}> {
  const { allIds } = await repo.listPaged([], { limit: 1000000, offset: 0 });
  const available = await repo.getAvailableFilters(allIds);
  const entityTypes = available.find(f => f.key === 'entity_type')?.distinctValues ?? [];
  return { ids: allIds, available, entityTypes };
}

type PresetResolution = {
  selectedPresetId: number | null;
  selectedPresetFilters: MetaFilter[] | null;
  isDraft: boolean;
};

// Resolve the "active" preset. When a `preset=N` URL param is present and
// valid, that preset is pinned regardless of filter matching (so the dropdown
// stays selected while the user drafts changes). Otherwise fall back to
// matching the current filters against saved presets.
function resolvePreset(
  presetParam: string | undefined,
  allFilters: MetaFilter[],
  presetsWithFilters: PresetWithFilters[]
): PresetResolution {
  const presetParamId = presetParam ? parseInt(presetParam, 10) : NaN;
  const pinned = !isNaN(presetParamId)
    ? presetsWithFilters.find(p => p.id === presetParamId)
    : undefined;

  if (pinned) {
    return {
      selectedPresetId: pinned.id,
      selectedPresetFilters: pinned.filters,
      isDraft: !metaFiltersEqual(allFilters, pinned.filters),
    };
  }

  const matchedId = findMatchingPresetId(allFilters, presetsWithFilters);
  const matched = matchedId != null ? presetsWithFilters.find(p => p.id === matchedId) : undefined;
  return {
    selectedPresetId: matchedId,
    selectedPresetFilters: matched?.filters ?? null,
    isDraft: false,
  };
}

export async function entitiesHandler(c: Context) {
  const repo = getEntityRepo();
  const appStateRepo = getAppStateRepo();

  const url = new URL(c.req.url);
  const allFilters = parseFiltersFromUrl(url);

  const addingKey = c.req.query('add_filter') || undefined;
  const editingKey = c.req.query('edit_filter') || undefined;

  const perPage = parsePositiveInt(c.req.query('per_page'), DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE);
  const page = parsePositiveInt(c.req.query('page'), 1);

  // When editing a filter, exclude it from the query so results are unfiltered by that key
  const queryFilters = editingKey ? allFilters.filter(f => f.key !== editingKey) : allFilters;

  const unfiltered = await loadUnfilteredView(repo);
  const selectedEntityType = allFilters.find(f => f.key === 'entity_type')?.value ?? null;

  // Redirect to the first entity type when none is selected. This guarantees
  // the page is never rendered without a type. Preserve all existing query
  // params (preset, per_page, page, etc.) so bookmarked URLs survive.
  if (!selectedEntityType && unfiltered.entityTypes.length > 0) {
    const redirectParams = new URLSearchParams(url.searchParams);
    redirectParams.set('mf__entity_type__eq', unfiltered.entityTypes[0]);
    return c.redirect(`/entities?${redirectParams.toString()}`, 302);
  }

  let pagedResult: PagedEntities;
  if (selectedEntityType) {
    pagedResult = await repo.listPaged(queryFilters, {
      limit: perPage,
      offset: (page - 1) * perPage,
    });
    if (editingKey) pagedResult.allIds = unfiltered.ids;
  } else {
    pagedResult = { pageEntities: [], allIds: unfiltered.ids, total: 0 };
  }

  const availableFilters = selectedEntityType
    ? await repo.getAvailableFilters(pagedResult.allIds)
    : unfiltered.available;

  const presetsWithFilters = await appStateRepo.listPresetsWithFilters();
  const presets = presetsWithFilters.map(p => ({
    id: p.id,
    name: p.name,
    url: buildEntityUrl(p.filters, p.id),
  }));

  const { selectedPresetId, selectedPresetFilters, isDraft } = resolvePreset(
    c.req.query('preset'),
    allFilters,
    presetsWithFilters
  );

  return c.html(
    <EntitiesPage
      entities={pagedResult.pageEntities}
      totalCount={pagedResult.total}
      page={page}
      perPage={perPage}
      activeFilters={allFilters}
      availableFilters={availableFilters}
      addingKey={addingKey}
      editingKey={editingKey}
      entityTypes={unfiltered.entityTypes}
      presets={presets}
      selectedPresetId={selectedPresetId}
      selectedPresetFilters={selectedPresetFilters}
      selectedEntityType={selectedEntityType}
      isDraft={isDraft}
    />
  );
}
