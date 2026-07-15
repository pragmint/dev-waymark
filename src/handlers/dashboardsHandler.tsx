import type { Context } from 'hono';
import { getAppStateRepo } from '../db/appState/index';
import { getEntityRepo } from '../db/source/index';
import {
  buildChartData,
  buildChartJsConfig,
  buildExcludedEntityFilters,
  buildLookbackSmoothingDataset,
  buildPointEntityFilters,
  buildSmoothingWindowEntityFilters,
  validateVisualizationConfig,
} from '../domain/chartDataBuilder';
import {
  buildDateRangeFilters,
  computeDateRange,
  parseDateRangeFromQuery,
  resolveVizDateField,
} from '../domain/dateRange';
import type { ComputedDateRange, DateRange } from '../domain/dateRange';
import { buildEntityUrl } from '../domain/filterUrl';
import { resolveTemplate } from '../domain/templateResolver';
import { TemplateConfigSchema } from '../schemas/visualizationTemplate';
import { DashboardPage } from '../frontend/Pages/DashboardPage';
import type { DashboardCard } from '../frontend/Pages/DashboardPage';
import type { FilterNode, FilterTree } from '../schemas/filterTree';
import { VisualizationLayoutSchema } from '../schemas/visualization';
import type { VisualizationConfig, VisualizationSummary } from '../schemas/visualization';
import type { ChartDataResult } from '../domain/chartDataBuilder';

// Wraps the preset's tree (the saved structure stays intact) plus extra leaves
// under a fresh root AND group, so click-through URLs narrow the entity list
// to the chart point without flattening the preset's own logic.
function combineWithExtras(presetTree: FilterTree, extras: FilterNode[]): FilterTree {
  if (extras.length === 0) return presetTree;
  return { type: 'group', id: 'root', op: 'AND', children: [presetTree, ...extras] };
}

// A bounded dashboard date range clips the entities the smoothing line's
// rolling average is computed over, so the first few visible points would
// otherwise average fewer than `windowSize` points instead of a TRUE rolling
// average. This re-queries with no lower bound at all — a calendar-based
// lookback (e.g. "windowSize - 1 weeks earlier") isn't reliable, since a
// window needs `windowSize - 1` *populated* buckets of history, and buckets
// can be sparse (a week/day with zero entities). Fetching full history is the
// only way to guarantee enough real data points regardless of gaps — then the
// result is narrowed back down to the visible labels. Returns the extended
// label list (used to build correctly-windowed click-through URLs), or null
// when there's nothing to widen (unbounded range, or smoothing not
// configured).
async function applyLookbackSmoothing(
  chartResult: ChartDataResult,
  config: VisualizationConfig,
  presetTree: FilterTree,
  computedRange: ComputedDateRange,
  dateField: string | null,
  entityRepo: ReturnType<typeof getEntityRepo>
): Promise<string[] | null> {
  if (!config.smoothing || !computedRange.start || !dateField) return null;
  if (chartResult.smoothingDatasetIndex == null) return null;

  const lookbackFilters = buildDateRangeFilters(
    { start: null, end: computedRange.end, label: '' },
    dateField
  );
  const lookbackEntities = await entityRepo.list(combineWithExtras(presetTree, lookbackFilters));

  const mainLabel = chartResult.datasets[0].label;
  const lookback = buildLookbackSmoothingDataset(
    chartResult.labels,
    lookbackEntities,
    mainLabel,
    config
  );
  if (!lookback) return null;

  chartResult.datasets[chartResult.smoothingDatasetIndex] = lookback.dataset;
  return lookback.extendedLabels;
}

// Builds the smoothing line's click-through URLs. When lookback history was
// used to compute a TRUE rolling average (extendedLabels set), the window for
// an early point can reach before the visible range's own start — so the
// filter must be scoped to the bare preset tree rather than `filteredTree`,
// whose own range bound would otherwise clip the wider window right back.
function buildSmoothingPointUrls(
  visibleLabels: string[],
  extendedLabels: string[] | null,
  windowSize: number,
  config: VisualizationConfig,
  presetTree: FilterTree,
  filteredTree: FilterTree
): string[] {
  const labelsForWindow = extendedLabels ?? visibleLabels;
  const offset = labelsForWindow.length - visibleLabels.length;
  const baseTree = extendedLabels ? presetTree : filteredTree;
  return visibleLabels.map((_, i) =>
    buildEntityUrl(
      combineWithExtras(
        baseTree,
        buildSmoothingWindowEntityFilters(labelsForWindow, offset + i, windowSize, config)
      )
    )
  );
}

async function buildCard(
  vizId: number,
  repo: ReturnType<typeof getAppStateRepo>,
  computedRange: ComputedDateRange
): Promise<DashboardCard | null> {
  const viz = await repo.getVisualization(vizId);
  if (!viz) return null;

  const preset = await repo.getPreset(viz.presetId);
  if (!preset) return null;

  // If the dashboard's date range is bounded and this viz has a resolvable
  // date field, layer gte/lte leaves over the preset tree so the entity
  // query already applies the time window — no need to re-aggregate later.
  const dateField = resolveVizDateField(viz.config);
  const rangeFilters =
    dateField && (computedRange.start || computedRange.end)
      ? buildDateRangeFilters(computedRange, dateField)
      : [];
  const filteredTree = combineWithExtras(preset.tree, rangeFilters);

  const entityRepo = getEntityRepo();
  const entities = await entityRepo.list(filteredTree);

  const chartResult = buildChartData(entities, viz.config);
  const extendedLabelsForSmoothing = await applyLookbackSmoothing(
    chartResult,
    viz.config,
    preset.tree,
    computedRange,
    dateField,
    entityRepo
  );
  const chartJsConfig = buildChartJsConfig(chartResult, viz.config);

  const pointUrls = chartResult.labels.map(label =>
    buildEntityUrl(combineWithExtras(filteredTree, buildPointEntityFilters(label, viz.config)))
  );

  const smoothingWindowSize = viz.config.smoothing?.windowSize;
  const smoothingPointUrls =
    chartResult.smoothingDatasetIndex != null && smoothingWindowSize
      ? buildSmoothingPointUrls(
          chartResult.labels,
          extendedLabelsForSmoothing,
          smoothingWindowSize,
          viz.config,
          preset.tree,
          filteredTree
        )
      : null;

  const excludedFilters = buildExcludedEntityFilters(viz.config);
  const excludedEntitiesUrl =
    chartResult.excludedEntityCount > 0 && excludedFilters.length > 0
      ? buildEntityUrl(combineWithExtras(filteredTree, excludedFilters))
      : null;

  return {
    id: viz.id,
    name: viz.name,
    chartJsConfig,
    pointUrls,
    smoothingPointUrls,
    smoothingDatasetIndex: chartResult.smoothingDatasetIndex,
    warnings: chartResult.warnings,
    excludedEntityCount: chartResult.excludedEntityCount,
    excludedEntitiesUrl,
    layout: viz.config.layout ?? 'normal',
  };
}

function parseVizIds(formData: FormData): number[] {
  const ids: number[] = [];
  for (const v of formData.getAll('viz_ids[]')) {
    if (typeof v !== 'string') continue;
    const n = parseInt(v, 10);
    if (!isNaN(n)) ids.push(n);
  }
  return ids;
}

export async function dashboardSaveHandler(c: Context) {
  const repo = getAppStateRepo();
  const formData = await c.req.formData();
  const name = (formData.get('name') as string | null)?.trim() ?? '';
  if (!name) return c.redirect('/visualizations');

  const vizIds = parseVizIds(formData);
  const id = await repo.saveDashboard(name, vizIds);
  return c.redirect(`/visualizations?dashboard=${id}`);
}

export async function dashboardUpdateHandler(c: Context) {
  const repo = getAppStateRepo();
  const id = parseInt(c.req.param('id') ?? '', 10);
  if (isNaN(id)) return c.redirect('/visualizations');

  const formData = await c.req.formData();
  const name = (formData.get('name') as string | null)?.trim() ?? '';
  if (!name) return c.redirect(`/visualizations?dashboard=${id}`);

  const existing = await repo.getDashboard(id);
  if (!existing) return c.redirect('/visualizations');

  const vizIds = parseVizIds(formData);
  await repo.updateDashboard(id, name, vizIds);
  return c.redirect(`/visualizations?dashboard=${id}`);
}

export async function dashboardDeleteHandler(c: Context) {
  const repo = getAppStateRepo();
  const id = parseInt(c.req.param('id') ?? '', 10);
  if (!isNaN(id)) await repo.deleteDashboard(id);
  return c.redirect('/visualizations');
}

export async function dashboardAddVisualizationHandler(c: Context) {
  const repo = getAppStateRepo();
  const id = parseInt(c.req.param('id') ?? '', 10);
  if (isNaN(id)) return c.redirect('/visualizations');

  const formData = await c.req.formData();
  const vizIdRaw = formData.get('visualization_id') as string | null;
  const vizId = vizIdRaw ? parseInt(vizIdRaw, 10) : NaN;
  if (isNaN(vizId)) return c.redirect(`/visualizations?dashboard=${id}`);

  await repo.addVisualizationToDashboard(id, vizId);
  return c.redirect(`/visualizations?dashboard=${id}`);
}

export async function dashboardRemoveVisualizationHandler(c: Context) {
  const repo = getAppStateRepo();
  const dashboardId = parseInt(c.req.param('id') ?? '', 10);
  const vizId = parseInt(c.req.param('vizId') ?? '', 10);
  if (isNaN(dashboardId) || isNaN(vizId)) return c.redirect('/visualizations');

  await repo.removeVisualizationFromDashboard(dashboardId, vizId);
  return c.redirect(`/visualizations?dashboard=${dashboardId}`);
}

// Shared by create and update: parses name/description/presetId/templateConfig from the
// request body and validates each. Returns `response` (an error to return as-is) on failure.
async function parseVisualizationInput(
  c: Context,
  repo: ReturnType<typeof getAppStateRepo>
): Promise<
  | { response: Response }
  | {
      name: string;
      description: string | null;
      presetId: number;
      configWithTemplate: VisualizationConfig;
    }
> {
  const body = await c.req.json<{
    name?: unknown;
    description?: unknown;
    presetId?: unknown;
    templateConfig?: unknown;
    layout?: unknown;
  }>();

  const name = typeof body.name === 'string' ? body.name.trim() : '';
  if (!name) return { response: c.json({ error: 'Name required' }, 400) };

  const description =
    typeof body.description === 'string' && body.description.trim().length > 0
      ? body.description.trim()
      : null;

  if (typeof body.presetId !== 'number') {
    return { response: c.json({ error: 'presetId required' }, 400) };
  }

  const preset = await repo.getPreset(body.presetId);
  if (!preset) return { response: c.json({ error: 'Preset not found' }, 404) };

  const tcParsed = TemplateConfigSchema.safeParse(body.templateConfig);
  if (!tcParsed.success) {
    return {
      response: c.json({ error: 'Invalid template config', details: tcParsed.error.issues }, 400),
    };
  }

  const layoutParsed = VisualizationLayoutSchema.safeParse(body.layout ?? 'normal');
  if (!layoutParsed.success) {
    return {
      response: c.json({ error: 'Invalid layout', details: layoutParsed.error.issues }, 400),
    };
  }

  const config = resolveTemplate(tcParsed.data);
  const validationErrors = validateVisualizationConfig(config);
  if (validationErrors.length > 0) {
    return {
      response: c.json({ error: 'Config validation failed', details: validationErrors }, 400),
    };
  }

  const configWithTemplate = {
    ...config,
    layout: layoutParsed.data,
    _templateConfig: tcParsed.data,
  };
  return { name, description, presetId: body.presetId, configWithTemplate };
}

export async function visualizationCreateApiHandler(c: Context) {
  const repo = getAppStateRepo();
  const parsed = await parseVisualizationInput(c, repo);
  if ('response' in parsed) return parsed.response;

  const id = await repo.saveVisualization(
    parsed.name,
    parsed.description,
    parsed.presetId,
    parsed.configWithTemplate
  );
  return c.json({ id });
}

export async function visualizationDeleteApiHandler(c: Context) {
  const repo = getAppStateRepo();
  const id = parseInt(c.req.param('id') ?? '', 10);
  if (isNaN(id)) return c.json({ error: 'Invalid id' }, 400);
  await repo.deleteVisualization(id);
  return c.body(null, 204);
}

export async function visualizationDetailApiHandler(c: Context) {
  const repo = getAppStateRepo();
  const id = parseInt(c.req.param('id') ?? '', 10);
  if (isNaN(id)) return c.json({ error: 'Invalid id' }, 400);

  const viz = await repo.getVisualization(id);
  if (!viz) return c.json({ error: 'Not found' }, 404);

  return c.json({
    id: viz.id,
    name: viz.name,
    description: viz.description,
    presetId: viz.presetId,
    templateConfig: viz.config._templateConfig ?? null,
    layout: viz.config.layout ?? 'normal',
  });
}

export async function visualizationDashboardsApiHandler(c: Context) {
  const repo = getAppStateRepo();
  const id = parseInt(c.req.param('id') ?? '', 10);
  if (isNaN(id)) return c.json({ error: 'Invalid id' }, 400);
  const dashboards = await repo.listDashboardsForVisualization(id);
  return c.json({ dashboards });
}

export async function visualizationUpdateApiHandler(c: Context) {
  const repo = getAppStateRepo();
  const id = parseInt(c.req.param('id') ?? '', 10);
  if (isNaN(id)) return c.json({ error: 'Invalid id' }, 400);

  const existing = await repo.getVisualization(id);
  if (!existing) return c.json({ error: 'Not found' }, 404);

  const parsed = await parseVisualizationInput(c, repo);
  if ('response' in parsed) return parsed.response;

  await repo.updateVisualization(
    id,
    parsed.name,
    parsed.description,
    parsed.presetId,
    parsed.configWithTemplate
  );
  return c.json({ id });
}

// Returns the same card data the page handler builds, but as JSON — used by the
// client to swap charts in place when the date range changes, without a full
// page reload. The dashboard's viz list is read from the saved dashboard, so
// reordering or add/remove still requires a full reload.
export async function dashboardCardsApiHandler(c: Context) {
  const repo = getAppStateRepo();
  const id = parseInt(c.req.param('id') ?? '', 10);
  if (isNaN(id)) return c.json({ error: 'Invalid id' }, 400);

  const dashboard = await repo.getDashboard(id);
  if (!dashboard) return c.json({ error: 'Not found' }, 404);

  const queryString = new URL(c.req.url).search.slice(1);
  const dateRange = parseDateRangeFromQuery(new URLSearchParams(queryString));
  const computedRange = computeDateRange(dateRange, new Date());

  const built = await Promise.all(
    dashboard.visualizationIds.map(vizId => buildCard(vizId, repo, computedRange))
  );
  const cards = built.filter((c): c is DashboardCard => c !== null);

  return c.json({ cards, dateRangeLabel: computedRange.label });
}

export async function dashboardsPageHandler(c: Context) {
  const repo = getAppStateRepo();
  const dashboards = await repo.listDashboards();

  const dashboardIdRaw = c.req.query('dashboard');
  const dashboardId = dashboardIdRaw ? parseInt(dashboardIdRaw, 10) : null;
  const selected =
    dashboardId != null && !isNaN(dashboardId) ? await repo.getDashboard(dashboardId) : null;

  // Unknown dashboard id → redirect to bare URL, mirroring entityPresetsUpdateHandler.
  if (dashboardId != null && !isNaN(dashboardId) && !selected) {
    return c.redirect('/visualizations');
  }

  const queryString = new URL(c.req.url).search.slice(1);
  const dateRange: DateRange = parseDateRangeFromQuery(new URLSearchParams(queryString));
  const computedRange = computeDateRange(dateRange, new Date());

  let cards: DashboardCard[] = [];
  let availableVisualizations: VisualizationSummary[] = [];

  if (selected) {
    const built = await Promise.all(
      selected.visualizationIds.map(id => buildCard(id, repo, computedRange))
    );
    cards = built.filter((c): c is DashboardCard => c !== null);
    availableVisualizations = await repo.listVisualizationsNotOnDashboard(selected.id);
  }

  const vizDashboardCounts = await repo.getDashboardCountsByViz();
  const presets = await repo.listPresets();

  return c.html(
    <DashboardPage
      dashboards={dashboards}
      selectedDashboard={selected}
      cards={cards}
      availableVisualizations={availableVisualizations}
      vizDashboardCounts={vizDashboardCounts}
      presets={presets}
      dateRange={dateRange}
      dateRangeLabel={computedRange.label}
    />
  );
}
