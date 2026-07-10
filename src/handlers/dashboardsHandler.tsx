import type { Context } from 'hono';
import { getAppStateRepo } from '../db/appState/index';
import { getEntityRepo } from '../db/source/index';
import {
  buildChartData,
  buildChartJsConfig,
  buildExcludedEntityFilters,
  buildPointEntityFilters,
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
import type { VisualizationSummary } from '../schemas/visualization';

// Wraps the preset's tree (the saved structure stays intact) plus extra leaves
// under a fresh root AND group, so click-through URLs narrow the entity list
// to the chart point without flattening the preset's own logic.
function combineWithExtras(presetTree: FilterTree, extras: FilterNode[]): FilterTree {
  if (extras.length === 0) return presetTree;
  return { type: 'group', id: 'root', op: 'AND', children: [presetTree, ...extras] };
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

  const chartResult = buildChartData(entities, viz.config, filteredTree);
  const chartJsConfig = buildChartJsConfig(chartResult, viz.config);

  const pointUrls = chartResult.labels.map(label =>
    buildEntityUrl(combineWithExtras(filteredTree, buildPointEntityFilters(label, viz.config)))
  );

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
    warnings: chartResult.warnings,
    excludedEntityCount: chartResult.excludedEntityCount,
    excludedEntitiesUrl,
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

export async function visualizationCreateApiHandler(c: Context) {
  const repo = getAppStateRepo();
  const body = await c.req.json<{
    name?: unknown;
    description?: unknown;
    presetId?: unknown;
    templateConfig?: unknown;
  }>();

  const name = typeof body.name === 'string' ? body.name.trim() : '';
  if (!name) return c.json({ error: 'Name required' }, 400);

  const description =
    typeof body.description === 'string' && body.description.trim().length > 0
      ? body.description.trim()
      : null;

  if (typeof body.presetId !== 'number') {
    return c.json({ error: 'presetId required' }, 400);
  }

  const tcParsed = TemplateConfigSchema.safeParse(body.templateConfig);
  if (!tcParsed.success) {
    return c.json({ error: 'Invalid template config', details: tcParsed.error.issues }, 400);
  }

  const preset = await repo.getPreset(body.presetId);
  if (!preset) return c.json({ error: 'Preset not found' }, 404);

  const config = resolveTemplate(tcParsed.data);
  const validationErrors = validateVisualizationConfig(config);
  if (validationErrors.length > 0) {
    return c.json({ error: 'Config validation failed', details: validationErrors }, 400);
  }

  const configWithTemplate = { ...config, _templateConfig: tcParsed.data };
  const id = await repo.saveVisualization(name, description, body.presetId, configWithTemplate);
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

  const body = await c.req.json<{
    name?: unknown;
    description?: unknown;
    templateConfig?: unknown;
  }>();

  const name = typeof body.name === 'string' ? body.name.trim() : '';
  if (!name) return c.json({ error: 'Name required' }, 400);
  const description =
    typeof body.description === 'string' && body.description.trim().length > 0
      ? body.description.trim()
      : null;

  const tcParsed = TemplateConfigSchema.safeParse(body.templateConfig);
  if (!tcParsed.success) {
    return c.json({ error: 'Invalid template config', details: tcParsed.error.issues }, 400);
  }

  const config = resolveTemplate(tcParsed.data);
  const validationErrors = validateVisualizationConfig(config);
  if (validationErrors.length > 0) {
    return c.json({ error: 'Config validation failed', details: validationErrors }, 400);
  }

  const configWithTemplate = { ...config, _templateConfig: tcParsed.data };
  await repo.updateVisualization(id, name, description, configWithTemplate);
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
