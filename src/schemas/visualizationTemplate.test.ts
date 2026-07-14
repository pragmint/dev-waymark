import { describe, expect, it } from 'bun:test';
import { TemplateIdSchema, TemplateConfigSchema, TEMPLATES } from './visualizationTemplate';

describe('TemplateIdSchema', () => {
  it('accepts every known template id', () => {
    for (const id of [
      'duration_trend',
      'category_breakdown',
      'phase_snapshot',
      'throughput_over_time',
      'field_trend',
      'category_comparison',
    ]) {
      expect(TemplateIdSchema.safeParse(id).success).toBe(true);
    }
  });

  it('rejects an unknown template id', () => {
    expect(TemplateIdSchema.safeParse('not_a_template').success).toBe(false);
  });
});

describe('TemplateConfigSchema — discriminator', () => {
  it('rejects a config with no templateId', () => {
    expect(TemplateConfigSchema.safeParse({ slots: {} }).success).toBe(false);
  });

  it('rejects a config with an unknown templateId', () => {
    const result = TemplateConfigSchema.safeParse({
      templateId: 'made_up_template',
      slots: {},
    });
    expect(result.success).toBe(false);
  });
});

describe('TemplateConfigSchema — duration_trend', () => {
  const validSlots = {
    startDateField: 'created_at',
    endDateField: 'closed_at',
    timeBucket: 'week',
    unit: 'days',
  };

  it('accepts a valid config', () => {
    const result = TemplateConfigSchema.safeParse({
      templateId: 'duration_trend',
      slots: validSlots,
    });
    expect(result.success).toBe(true);
  });

  it('rejects an empty startDateField', () => {
    const result = TemplateConfigSchema.safeParse({
      templateId: 'duration_trend',
      slots: { ...validSlots, startDateField: '' },
    });
    expect(result.success).toBe(false);
  });

  it('rejects an invalid timeBucket', () => {
    const result = TemplateConfigSchema.safeParse({
      templateId: 'duration_trend',
      slots: { ...validSlots, timeBucket: 'fortnight' },
    });
    expect(result.success).toBe(false);
  });

  it('rejects an invalid unit', () => {
    const result = TemplateConfigSchema.safeParse({
      templateId: 'duration_trend',
      slots: { ...validSlots, unit: 'months' },
    });
    expect(result.success).toBe(false);
  });

  it("rejects another template's slot shape", () => {
    const result = TemplateConfigSchema.safeParse({
      templateId: 'duration_trend',
      slots: { categoryField: 'team' },
    });
    expect(result.success).toBe(false);
  });
});

describe('TemplateConfigSchema — category_breakdown', () => {
  it('accepts a valid config', () => {
    const result = TemplateConfigSchema.safeParse({
      templateId: 'category_breakdown',
      slots: { categoryField: 'team' },
    });
    expect(result.success).toBe(true);
  });

  it('rejects an empty categoryField', () => {
    const result = TemplateConfigSchema.safeParse({
      templateId: 'category_breakdown',
      slots: { categoryField: '' },
    });
    expect(result.success).toBe(false);
  });

  it('rejects a missing categoryField', () => {
    const result = TemplateConfigSchema.safeParse({
      templateId: 'category_breakdown',
      slots: {},
    });
    expect(result.success).toBe(false);
  });
});

describe('TemplateConfigSchema — phase_snapshot', () => {
  const validSlots = { categoryField: 'status', dateField: 'updated_at' };

  it('accepts a valid config', () => {
    const result = TemplateConfigSchema.safeParse({
      templateId: 'phase_snapshot',
      slots: validSlots,
    });
    expect(result.success).toBe(true);
  });

  it('rejects an empty dateField', () => {
    const result = TemplateConfigSchema.safeParse({
      templateId: 'phase_snapshot',
      slots: { ...validSlots, dateField: '' },
    });
    expect(result.success).toBe(false);
  });

  it('rejects a missing categoryField', () => {
    const result = TemplateConfigSchema.safeParse({
      templateId: 'phase_snapshot',
      slots: { dateField: 'updated_at' },
    });
    expect(result.success).toBe(false);
  });
});

describe('TemplateConfigSchema — throughput_over_time', () => {
  const validSlots = { dateField: 'closed_at', timeBucket: 'month' };

  it('accepts a valid config', () => {
    const result = TemplateConfigSchema.safeParse({
      templateId: 'throughput_over_time',
      slots: validSlots,
    });
    expect(result.success).toBe(true);
  });

  it('rejects an invalid timeBucket', () => {
    const result = TemplateConfigSchema.safeParse({
      templateId: 'throughput_over_time',
      slots: { ...validSlots, timeBucket: 'hour' },
    });
    expect(result.success).toBe(false);
  });

  it('rejects an empty dateField', () => {
    const result = TemplateConfigSchema.safeParse({
      templateId: 'throughput_over_time',
      slots: { ...validSlots, dateField: '' },
    });
    expect(result.success).toBe(false);
  });
});

describe('TemplateConfigSchema — field_trend', () => {
  const validSlots = {
    dateField: 'created_at',
    numericFields: ['story_points'],
    timeBucket: 'week',
    aggregation: 'avg',
  };

  it('accepts a valid config', () => {
    const result = TemplateConfigSchema.safeParse({
      templateId: 'field_trend',
      slots: validSlots,
    });
    expect(result.success).toBe(true);
  });

  it('accepts multiple numeric fields to sum', () => {
    const result = TemplateConfigSchema.safeParse({
      templateId: 'field_trend',
      slots: { ...validSlots, numericFields: ['story_points', 'bonus_points'] },
    });
    expect(result.success).toBe(true);
  });

  it('accepts a percentile aggregation', () => {
    const result = TemplateConfigSchema.safeParse({
      templateId: 'field_trend',
      slots: { ...validSlots, aggregation: 'p95' },
    });
    expect(result.success).toBe(true);
  });

  it('rejects an invalid aggregation', () => {
    const result = TemplateConfigSchema.safeParse({
      templateId: 'field_trend',
      slots: { ...validSlots, aggregation: 'mode' },
    });
    expect(result.success).toBe(false);
  });

  it('rejects a missing numericFields', () => {
    const result = TemplateConfigSchema.safeParse({
      templateId: 'field_trend',
      slots: {
        dateField: validSlots.dateField,
        timeBucket: validSlots.timeBucket,
        aggregation: validSlots.aggregation,
      },
    });
    expect(result.success).toBe(false);
  });

  it('rejects an empty numericFields array', () => {
    const result = TemplateConfigSchema.safeParse({
      templateId: 'field_trend',
      slots: { ...validSlots, numericFields: [] },
    });
    expect(result.success).toBe(false);
  });
});

describe('TemplateConfigSchema — category_comparison', () => {
  const validSlots = {
    categoryField: 'team',
    numericField: 'story_points',
    aggregation: 'sum',
  };

  it('accepts a valid config', () => {
    const result = TemplateConfigSchema.safeParse({
      templateId: 'category_comparison',
      slots: validSlots,
    });
    expect(result.success).toBe(true);
  });

  it('rejects an empty numericField', () => {
    const result = TemplateConfigSchema.safeParse({
      templateId: 'category_comparison',
      slots: { ...validSlots, numericField: '' },
    });
    expect(result.success).toBe(false);
  });

  it('rejects an invalid aggregation', () => {
    const result = TemplateConfigSchema.safeParse({
      templateId: 'category_comparison',
      slots: { ...validSlots, aggregation: 'count' },
    });
    expect(result.success).toBe(false);
  });
});

describe('TEMPLATES registry', () => {
  it('has an entry for every TemplateId', () => {
    const registryIds = TEMPLATES.map(t => t.id).sort();
    const schemaIds = [...TemplateIdSchema.options].sort();
    expect(registryIds).toEqual(schemaIds);
  });

  it('has no duplicate template ids', () => {
    const ids = TEMPLATES.map(t => t.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
