import type { Context } from 'hono';
import { getAppStateRepo } from '../db/appState/index';
import { getEntityRepo } from '../db/source/index';
import { TemplateConfigSchema } from '../schemas/visualizationTemplate';
import { resolveTemplate } from '../domain/templateResolver';
import {
  buildChartData,
  buildChartJsConfig,
  validateVisualizationConfig,
} from '../domain/chartDataBuilder';

/** GET /api/preset-fields/:id — returns available filter fields for a preset */
export async function presetFieldsHandler(c: Context) {
  const repo = getAppStateRepo();
  const id = parseInt(c.req.param('id') ?? '', 10);
  if (isNaN(id)) return c.json({ error: 'Invalid id' }, 400);

  const preset = await repo.getPreset(id);
  if (!preset) return c.json({ error: 'Not found' }, 404);

  const entityRepo = getEntityRepo();
  const entities = await entityRepo.list(preset.filters);
  const entityIds = entities.map(e => e.id);

  if (entityIds.length === 0) return c.json([]);

  const fields = await entityRepo.getAvailableFilters(entityIds);
  return c.json(fields);
}

/** GET /api/chart-data/:id — returns Chart.js config for a saved visualization */
export async function chartDataByIdHandler(c: Context) {
  const repo = getAppStateRepo();
  const id = parseInt(c.req.param('id') ?? '', 10);
  if (isNaN(id)) return c.json({ error: 'Invalid id' }, 400);

  const viz = await repo.getVisualization(id);
  if (!viz) return c.json({ error: 'Not found' }, 404);

  const preset = await repo.getPreset(viz.presetId);
  if (!preset) return c.json({ error: 'Preset not found' }, 404);

  const entityRepo = getEntityRepo();
  const entities = await entityRepo.list(preset.filters);

  const chartResult = buildChartData(entities, viz.config);
  const chartJsConfig = buildChartJsConfig(chartResult, viz.config);

  return c.json({
    chartJsConfig,
    warnings: chartResult.warnings,
    excludedEntityCount: chartResult.excludedEntityCount,
  });
}

/** POST /api/chart-data/preview — preview chart data from template config */
export async function chartDataPreviewHandler(c: Context) {
  const repo = getAppStateRepo();
  const body = await c.req.json<{ presetId: number; templateConfig: unknown }>();

  if (!body || typeof body.presetId !== 'number') {
    return c.json({ error: 'presetId required' }, 400);
  }

  const tcParsed = TemplateConfigSchema.safeParse(body.templateConfig);
  if (!tcParsed.success) {
    return c.json({ error: 'Invalid template config', details: tcParsed.error.issues }, 400);
  }

  const config = resolveTemplate(tcParsed.data);
  const validationErrors = validateVisualizationConfig(config);
  if (validationErrors.length > 0) {
    return c.json({ error: 'Config validation failed', details: validationErrors }, 400);
  }

  const preset = await repo.getPreset(body.presetId);
  if (!preset) return c.json({ error: 'Preset not found' }, 404);

  const entityRepo = getEntityRepo();
  const entities = await entityRepo.list(preset.filters);

  const chartResult = buildChartData(entities, config);
  const chartJsConfig = buildChartJsConfig(chartResult, config);

  return c.json({
    chartJsConfig,
    warnings: chartResult.warnings,
    excludedEntityCount: chartResult.excludedEntityCount,
  });
}
