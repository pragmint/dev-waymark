import type { Context } from 'hono';
import { z } from 'zod';
import { getAppStateRepo } from '../db/appState/index';
import { getEntityRepo } from '../db/source/index';
import { TemplateIdSchema, type TemplateId } from '../schemas/visualizationTemplate';
import { MetaFilterSchema } from '../schemas/entity';
import type { AvailableFilter, MetadataValueType } from '../schemas/entity';
import { resolveTemplate } from '../domain/templateResolver';

// ── Schemas ──────────────────────────────────────────────────────────────────

const SeedPresetBodySchema = z.object({
  name: z.string().min(1),
  filters: z.array(MetaFilterSchema).optional(),
});

const SeedVisualizationBodySchema = z.object({
  name: z.string().min(1),
  presetId: z.number().int(),
  templateId: TemplateIdSchema,
});

// ── Handlers ─────────────────────────────────────────────────────────────────

export async function testSeedPresetHandler(c: Context) {
  const body = await c.req.json().catch(() => null);
  const parsed = SeedPresetBodySchema.safeParse(body);
  if (!parsed.success) return c.json({ error: 'invalid body' }, 400);

  const id = await getAppStateRepo().savePreset(parsed.data.name, parsed.data.filters ?? []);
  return c.json({ id });
}

export async function testClearPresetsHandler(c: Context) {
  await getAppStateRepo().deleteAllPresets();
  return c.json({ ok: true });
}

export async function testSeedVisualizationHandler(c: Context) {
  const body = await c.req.json().catch(() => null);
  const parsed = SeedVisualizationBodySchema.safeParse(body);
  if (!parsed.success) return c.json({ error: 'invalid body' }, 400);
  const { name, presetId, templateId } = parsed.data;

  const repo = getAppStateRepo();
  const preset = await repo.getPreset(presetId);
  if (!preset) return c.json({ error: 'preset not found' }, 404);

  const entityRepo = getEntityRepo();
  const entities = await entityRepo.list(preset.filters);
  const fields = entities.length
    ? await entityRepo.getAvailableFilters(entities.map(e => e.id))
    : [];

  const templateConfig = buildTemplate(templateId, fields);
  if (!templateConfig) return c.json({ error: 'no fields available to fill slots' }, 400);

  const config = resolveTemplate(templateConfig);
  const configWithTemplate = { ...config, _templateConfig: templateConfig };

  const id = await repo.saveVisualization(name, null, presetId, configWithTemplate);
  return c.json({ id });
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function pickField(fields: AvailableFilter[], primaryType: MetadataValueType): string | null {
  const field = fields.find(f => f.value_type === primaryType) ?? fields[0];
  return field?.key ?? null;
}

function buildTemplate(templateId: TemplateId, fields: AvailableFilter[]) {
  switch (templateId) {
    case 'duration_trend': {
      const startDateField = pickField(fields, 'date');
      const endDateField = pickField(
        fields.filter(f => f.key !== startDateField),
        'date'
      );
      if (!startDateField || !endDateField) return null;
      return {
        templateId,
        slots: {
          startDateField,
          endDateField,
          timeBucket: 'week' as const,
          unit: 'days' as const,
        },
      };
    }
    case 'category_breakdown': {
      const categoryField = pickField(fields, 'string');
      if (!categoryField) return null;
      return { templateId, slots: { categoryField } };
    }
    case 'phase_snapshot': {
      const categoryField = pickField(fields, 'string');
      const dateField = pickField(fields, 'date');
      if (!categoryField || !dateField) return null;
      return { templateId, slots: { categoryField, dateField } };
    }
    case 'throughput_over_time': {
      const dateField = pickField(fields, 'date');
      if (!dateField) return null;
      return { templateId, slots: { dateField, timeBucket: 'week' as const } };
    }
    case 'field_trend': {
      const dateField = pickField(fields, 'date');
      const numericField = pickField(fields, 'number');
      if (!dateField || !numericField) return null;
      return {
        templateId,
        slots: {
          dateField,
          numericField,
          timeBucket: 'week' as const,
          aggregation: 'avg' as const,
        },
      };
    }
    case 'category_comparison': {
      const categoryField = pickField(fields, 'string');
      const numericField = pickField(fields, 'number');
      if (!categoryField || !numericField) return null;
      return {
        templateId,
        slots: { categoryField, numericField, aggregation: 'avg' as const },
      };
    }
  }
}
