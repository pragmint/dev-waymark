import type { Context } from 'hono';
import { getAppStateRepo } from '../db/appState/index';
import { getEntityRepo } from '../db/source/index';
import { VisualizationConfigSchema } from '../schemas/visualization';
import {
  buildChartData,
  buildChartJsConfig,
  validateVisualizationConfig,
} from '../domain/chartDataBuilder';
import { VisualizationsPage } from '../frontend/Pages/VisualizationsPage';
import { ChartBuilderPage } from '../frontend/Pages/ChartBuilderPage';
import { VisualizationDetailPage } from '../frontend/Pages/VisualizationDetailPage';
import type { AvailableFilter } from '../schemas/entity';

export async function visualizationsListHandler(c: Context) {
  const repo = getAppStateRepo();
  const visualizations = await repo.listVisualizations();
  const datasets = await repo.listDatasets();
  const datasetMap = new Map(datasets.map(d => [d.id, d.name]));
  return c.html(<VisualizationsPage visualizations={visualizations} datasetMap={datasetMap} />);
}

export async function visualizationsNewHandler(c: Context) {
  const repo = getAppStateRepo();
  const datasets = await repo.listDatasets();

  const datasetIdRaw = c.req.query('dataset_id');
  const parsedId = datasetIdRaw ? parseInt(datasetIdRaw, 10) : null;
  const datasetId =
    parsedId != null && !isNaN(parsedId) ? parsedId : datasets.length > 0 ? datasets[0].id : null;

  let availableFilters: AvailableFilter[] = [];
  let selectedDatasetName: string | null = null;

  if (datasetId != null) {
    const dataset = await repo.getDataset(datasetId);
    if (dataset) {
      selectedDatasetName = dataset.name;
      const entityRepo = getEntityRepo();
      const entities = await entityRepo.list(dataset.filters);
      const entityIds = entities.map(e => e.id);
      if (entityIds.length > 0) {
        availableFilters = await entityRepo.getAvailableFilters(entityIds);
      }
    }
  }

  return c.html(
    <ChartBuilderPage
      datasets={datasets}
      selectedDatasetId={datasetId}
      selectedDatasetName={selectedDatasetName}
      availableFilters={availableFilters}
      visualization={null}
      errors={[]}
    />
  );
}

export async function visualizationsSaveHandler(c: Context) {
  const repo = getAppStateRepo();
  const formData = await c.req.formData();

  const name = (formData.get('name') as string | null)?.trim() ?? '';
  const description = (formData.get('description') as string | null)?.trim() || null;
  const datasetIdRaw = formData.get('dataset_id') as string | null;
  const datasetId = datasetIdRaw ? parseInt(datasetIdRaw, 10) : null;

  if (!name || datasetId == null || isNaN(datasetId)) {
    return c.redirect('/visualizations/new');
  }

  const configRaw = parseVisualizationForm(formData);
  const parsed = VisualizationConfigSchema.safeParse(configRaw);
  if (!parsed.success) {
    return c.redirect('/visualizations/new');
  }

  const config = parsed.data;
  const errors = validateVisualizationConfig(config);
  if (errors.length > 0) {
    const datasets = await repo.listDatasets();
    return c.html(
      <ChartBuilderPage
        datasets={datasets}
        selectedDatasetId={datasetId}
        selectedDatasetName={null}
        availableFilters={[]}
        visualization={null}
        errors={errors}
      />,
      400
    );
  }

  const id = await repo.saveVisualization(name, description, datasetId, config);
  return c.redirect(`/visualizations/${id}`);
}

export async function visualizationsDetailHandler(c: Context) {
  const repo = getAppStateRepo();
  const id = parseInt(c.req.param('id') ?? '', 10);
  if (isNaN(id)) return c.notFound();

  const viz = await repo.getVisualization(id);
  if (!viz) return c.notFound();

  const dataset = await repo.getDataset(viz.datasetId);
  if (!dataset) return c.notFound();

  const entityRepo = getEntityRepo();
  const entities = await entityRepo.list(dataset.filters);

  const chartResult = buildChartData(entities, viz.config);
  const chartJsConfig = buildChartJsConfig(chartResult, viz.config);

  const params = new URLSearchParams();
  for (const f of dataset.filters) {
    params.append(`mf__${f.key}__${f.op}`, f.value);
  }
  const qs = params.toString();
  const datasetUrl = qs ? `/entities?${qs}` : '/entities';

  return c.html(
    <VisualizationDetailPage
      visualization={viz}
      datasetName={dataset.name}
      datasetUrl={datasetUrl}
      chartResult={chartResult}
      chartJsConfig={chartJsConfig}
    />
  );
}

export async function visualizationsEditHandler(c: Context) {
  const repo = getAppStateRepo();
  const id = parseInt(c.req.param('id') ?? '', 10);
  if (isNaN(id)) return c.notFound();

  const viz = await repo.getVisualization(id);
  if (!viz) return c.notFound();

  const datasets = await repo.listDatasets();
  const dataset = await repo.getDataset(viz.datasetId);

  let availableFilters: AvailableFilter[] = [];
  if (dataset) {
    const entityRepo = getEntityRepo();
    const entities = await entityRepo.list(dataset.filters);
    const entityIds = entities.map(e => e.id);
    if (entityIds.length > 0) {
      availableFilters = await entityRepo.getAvailableFilters(entityIds);
    }
  }

  return c.html(
    <ChartBuilderPage
      datasets={datasets}
      selectedDatasetId={viz.datasetId}
      selectedDatasetName={dataset?.name ?? null}
      availableFilters={availableFilters}
      visualization={viz}
      errors={[]}
    />
  );
}

export async function visualizationsUpdateHandler(c: Context) {
  const repo = getAppStateRepo();
  const id = parseInt(c.req.param('id') ?? '', 10);
  if (isNaN(id)) return c.notFound();

  const formData = await c.req.formData();
  const name = (formData.get('name') as string | null)?.trim() ?? '';
  const description = (formData.get('description') as string | null)?.trim() || null;

  if (!name) return c.redirect(`/visualizations/${id}/edit`);

  const configRaw = parseVisualizationForm(formData);
  const parsed = VisualizationConfigSchema.safeParse(configRaw);
  if (!parsed.success) return c.redirect(`/visualizations/${id}/edit`);

  const errors = validateVisualizationConfig(parsed.data);
  if (errors.length > 0) return c.redirect(`/visualizations/${id}/edit`);

  await repo.updateVisualization(id, name, description, parsed.data);
  return c.redirect(`/visualizations/${id}`);
}

export async function visualizationsDeleteHandler(c: Context) {
  const repo = getAppStateRepo();
  const id = parseInt(c.req.param('id') ?? '', 10);
  if (!isNaN(id)) await repo.deleteVisualization(id);
  return c.redirect('/visualizations');
}

// ── Form parsing ──────────────────────────────────────────────────────────────

function str(s: FormDataEntryValue | null): string | undefined {
  const v = (s as string | null)?.trim();
  return v || undefined;
}

function parseAxesFromForm(formData: FormData) {
  const xAxisKey = str(formData.get('x_axis_key'));
  const xAxis = xAxisKey
    ? {
        metadataKey: xAxisKey,
        type: formData.get('x_axis_type') ?? 'date',
        timeBucket: str(formData.get('x_axis_time_bucket')),
      }
    : undefined;

  const yAxisKey = str(formData.get('y_axis_key'));
  const yAxis = yAxisKey
    ? {
        metadataKey: yAxisKey,
        type: formData.get('y_axis_type') ?? 'number',
        unit: str(formData.get('y_axis_unit')),
        displayUnit: str(formData.get('y_axis_display_unit')),
      }
    : undefined;

  const categoryKey = str(formData.get('category_key'));
  const category = categoryKey
    ? { metadataKey: categoryKey, sortBy: str(formData.get('category_sort_by')) }
    : undefined;

  return { xAxis, yAxis, category };
}

function parseDerivedMetricFromForm(formData: FormData): Record<string, unknown> | undefined {
  if (formData.get('derived_metric_enabled') !== 'on') return undefined;
  return {
    name: str(formData.get('derived_metric_name')) ?? 'derived',
    type: 'duration',
    startMetadataKey: formData.get('derived_metric_start_key'),
    endMetadataKey: formData.get('derived_metric_end_key'),
    unit: formData.get('derived_metric_unit') ?? 'seconds',
  };
}

function parseTargetFromForm(formData: FormData): Record<string, unknown> | undefined {
  if (formData.get('target_enabled') !== 'on') return undefined;
  const targetType = formData.get('target_type') as string | null;
  const label = str(formData.get('target_label'));
  if (targetType === 'horizontal_line') {
    return { type: 'horizontal_line', value: Number(formData.get('target_value') ?? 0), label };
  }
  if (targetType === 'vertical_line') {
    return { type: 'vertical_line', value: formData.get('target_value_str') ?? '', label };
  }
  if (targetType === 'band') {
    return {
      type: 'band',
      min: Number(formData.get('target_min') ?? 0),
      max: Number(formData.get('target_max') ?? 0),
      label,
    };
  }
  return undefined;
}

function parseVisualizationForm(formData: FormData): Record<string, unknown> {
  const chartType = formData.get('chart_type') ?? 'bar';
  const aggregation = { function: formData.get('aggregation_fn') ?? 'count' };
  const { xAxis, yAxis, category } = parseAxesFromForm(formData);
  const derivedMetric = parseDerivedMetricFromForm(formData);
  const target = parseTargetFromForm(formData);
  return { chartType, xAxis, yAxis, category, aggregation, derivedMetric, target };
}
