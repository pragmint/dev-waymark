import type { Context } from 'hono';
import { getAppStateRepo } from '../db/appState/index';
import { getEntityRepo } from '../db/source/index';
import { TemplateConfigSchema, TemplateIdSchema } from '../schemas/visualizationTemplate';
import { resolveTemplate } from '../domain/templateResolver';
import {
  buildChartData,
  buildChartJsConfig,
  buildPointEntityFilters,
  validateVisualizationConfig,
} from '../domain/chartDataBuilder';
import { VisualizationsPage } from '../frontend/Pages/VisualizationsPage';
import { TemplatePickerPage } from '../frontend/Pages/TemplatePickerPage';
import { TemplateConfigPage } from '../frontend/Pages/TemplateConfigPage';
import { VisualizationDetailPage } from '../frontend/Pages/VisualizationDetailPage';
import type { AvailableFilter, MetaFilter } from '../schemas/entity';
import type { TemplateId } from '../schemas/visualizationTemplate';

function entitiesUrl(filters: MetaFilter[]): string {
  const params = new URLSearchParams();
  for (const f of filters) {
    params.append(`mf__${f.key}__${f.op}`, f.value);
  }
  const qs = params.toString();
  return qs ? `/entities?${qs}` : '/entities';
}

export async function visualizationsListHandler(c: Context) {
  const repo = getAppStateRepo();
  const visualizations = await repo.listVisualizations();
  const presets = await repo.listPresets();
  const presetMap = new Map(presets.map(d => [d.id, d.name]));
  return c.html(<VisualizationsPage visualizations={visualizations} presetMap={presetMap} />);
}

export async function visualizationsNewHandler(c: Context) {
  const repo = getAppStateRepo();
  const presets = await repo.listPresets();
  const presetIdRaw = c.req.query('preset_id');
  const parsedId = presetIdRaw ? parseInt(presetIdRaw, 10) : null;
  const selectedPresetId =
    parsedId != null && !isNaN(parsedId) ? parsedId : presets.length > 0 ? presets[0].id : null;

  return c.html(<TemplatePickerPage presets={presets} selectedPresetId={selectedPresetId} />);
}

export async function visualizationsTemplateHandler(c: Context) {
  const templateIdRaw = c.req.param('templateId');
  const parsed = TemplateIdSchema.safeParse(templateIdRaw);
  if (!parsed.success) return c.notFound();
  const templateId = parsed.data;

  const repo = getAppStateRepo();
  const presetIdRaw = c.req.query('preset_id');
  const presetId = presetIdRaw ? parseInt(presetIdRaw, 10) : NaN;
  if (isNaN(presetId)) return c.redirect('/visualizations/new');

  const preset = await repo.getPreset(presetId);
  if (!preset) return c.redirect('/visualizations/new');

  const entityRepo = getEntityRepo();
  const entities = await entityRepo.list(preset.filters);
  const entityIds = entities.map(e => e.id);
  let availableFilters: AvailableFilter[] = [];
  if (entityIds.length > 0) {
    availableFilters = await entityRepo.getAvailableFilters(entityIds);
  }

  return c.html(
    <TemplateConfigPage
      templateId={templateId}
      presetId={presetId}
      presetName={preset.name}
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
  const presetIdRaw = formData.get('preset_id') as string | null;
  const presetId = presetIdRaw ? parseInt(presetIdRaw, 10) : null;
  const templateIdRaw = formData.get('template_id') as string | null;

  if (!name || presetId == null || isNaN(presetId) || !templateIdRaw) {
    return c.redirect('/visualizations/new');
  }

  const templateIdParsed = TemplateIdSchema.safeParse(templateIdRaw);
  if (!templateIdParsed.success) return c.redirect('/visualizations/new');
  const templateId = templateIdParsed.data;

  const templateConfig = parseTemplateForm(templateId, formData);
  const tcParsed = TemplateConfigSchema.safeParse(templateConfig);
  if (!tcParsed.success) {
    return c.redirect(`/visualizations/new/${templateId}?preset_id=${presetId}`);
  }

  const config = resolveTemplate(tcParsed.data);
  // Store template config alongside for editing round-trips
  const configWithTemplate = { ...config, _templateConfig: tcParsed.data };

  const errors = validateVisualizationConfig(config);
  if (errors.length > 0) {
    const preset = await repo.getPreset(presetId);
    const entityRepo = getEntityRepo();
    let availableFilters: AvailableFilter[] = [];
    if (preset) {
      const entities = await entityRepo.list(preset.filters);
      const entityIds = entities.map(e => e.id);
      if (entityIds.length > 0) {
        availableFilters = await entityRepo.getAvailableFilters(entityIds);
      }
    }
    return c.html(
      <TemplateConfigPage
        templateId={templateId}
        presetId={presetId}
        presetName={preset?.name ?? `Preset ${presetId}`}
        availableFilters={availableFilters}
        visualization={null}
        errors={errors}
      />,
      400
    );
  }

  const id = await repo.saveVisualization(name, description, presetId, configWithTemplate);
  return c.redirect(`/visualizations/${id}`);
}

export async function visualizationsDetailHandler(c: Context) {
  const repo = getAppStateRepo();
  const id = parseInt(c.req.param('id') ?? '', 10);
  if (isNaN(id)) return c.notFound();

  const viz = await repo.getVisualization(id);
  if (!viz) return c.notFound();

  const preset = await repo.getPreset(viz.presetId);
  if (!preset) return c.notFound();

  const entityRepo = getEntityRepo();
  const entities = await entityRepo.list(preset.filters);

  const chartResult = buildChartData(entities, viz.config);
  const chartJsConfig = buildChartJsConfig(chartResult, viz.config);

  const presetUrl = entitiesUrl(preset.filters);
  const pointUrls = chartResult.labels.map(label =>
    entitiesUrl([...preset.filters, ...buildPointEntityFilters(label, viz.config)])
  );

  return c.html(
    <VisualizationDetailPage
      visualization={viz}
      presetName={preset.name}
      presetUrl={presetUrl}
      chartResult={chartResult}
      chartJsConfig={chartJsConfig}
      pointUrls={pointUrls}
    />
  );
}

export async function visualizationsEditHandler(c: Context) {
  const repo = getAppStateRepo();
  const id = parseInt(c.req.param('id') ?? '', 10);
  if (isNaN(id)) return c.notFound();

  const viz = await repo.getVisualization(id);
  if (!viz) return c.notFound();

  const tc = viz.config._templateConfig;
  if (!tc) {
    // Legacy visualization without template config — redirect to detail
    return c.redirect(`/visualizations/${id}`);
  }

  const preset = await repo.getPreset(viz.presetId);
  let availableFilters: AvailableFilter[] = [];
  if (preset) {
    const entityRepo = getEntityRepo();
    const entities = await entityRepo.list(preset.filters);
    const entityIds = entities.map(e => e.id);
    if (entityIds.length > 0) {
      availableFilters = await entityRepo.getAvailableFilters(entityIds);
    }
  }

  return c.html(
    <TemplateConfigPage
      templateId={tc.templateId}
      presetId={viz.presetId}
      presetName={preset?.name ?? `Preset ${viz.presetId}`}
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
  const templateIdRaw = formData.get('template_id') as string | null;

  if (!name || !templateIdRaw) return c.redirect(`/visualizations/${id}/edit`);

  const templateIdParsed = TemplateIdSchema.safeParse(templateIdRaw);
  if (!templateIdParsed.success) return c.redirect(`/visualizations/${id}/edit`);

  const templateConfig = parseTemplateForm(templateIdParsed.data, formData);
  const tcParsed = TemplateConfigSchema.safeParse(templateConfig);
  if (!tcParsed.success) return c.redirect(`/visualizations/${id}/edit`);

  const config = resolveTemplate(tcParsed.data);
  const configWithTemplate = { ...config, _templateConfig: tcParsed.data };

  const errors = validateVisualizationConfig(config);
  if (errors.length > 0) return c.redirect(`/visualizations/${id}/edit`);

  await repo.updateVisualization(id, name, description, configWithTemplate);
  return c.redirect(`/visualizations/${id}`);
}

export async function visualizationsDeleteHandler(c: Context) {
  const repo = getAppStateRepo();
  const id = parseInt(c.req.param('id') ?? '', 10);
  if (!isNaN(id)) await repo.deleteVisualization(id);
  return c.redirect('/visualizations');
}

// ── Form parsing ──────────────────────────────────────────────────────────────

function str(s: FormDataEntryValue | null): string {
  return ((s as string | null)?.trim() ?? '') || '';
}

function parseTemplateForm(templateId: TemplateId, formData: FormData): Record<string, unknown> {
  const slots: Record<string, string> = {};

  switch (templateId) {
    case 'duration_trend':
      slots.startDateField = str(formData.get('start_date_field'));
      slots.endDateField = str(formData.get('end_date_field'));
      slots.timeBucket = str(formData.get('time_bucket')) || 'week';
      slots.unit = str(formData.get('unit')) || 'days';
      break;
    case 'category_breakdown':
      slots.categoryField = str(formData.get('category_field'));
      break;
    case 'phase_snapshot':
      slots.categoryField = str(formData.get('category_field'));
      slots.dateField = str(formData.get('date_field'));
      break;
    case 'throughput_over_time':
      slots.dateField = str(formData.get('date_field'));
      slots.timeBucket = str(formData.get('time_bucket')) || 'week';
      break;
    case 'field_trend':
      slots.dateField = str(formData.get('date_field'));
      slots.numericField = str(formData.get('numeric_field'));
      slots.timeBucket = str(formData.get('time_bucket')) || 'week';
      slots.aggregation = str(formData.get('aggregation')) || 'avg';
      break;
    case 'category_comparison':
      slots.categoryField = str(formData.get('category_field'));
      slots.numericField = str(formData.get('numeric_field'));
      slots.aggregation = str(formData.get('aggregation')) || 'avg';
      break;
  }

  return { templateId, slots };
}
