import { describe, test, expect } from 'bun:test';
import { resolveTemplate } from './templateResolver';

describe('resolveTemplate', () => {
  test('duration_trend produces line chart with derived metric', () => {
    const config = resolveTemplate({
      templateId: 'duration_trend',
      slots: {
        startDateField: 'started_at',
        endDateField: 'completed_at',
        timeBucket: 'week',
        unit: 'days',
      },
    });

    expect(config.chartType).toBe('line');
    expect(config.xAxis?.metadataKey).toBe('completed_at');
    expect(config.xAxis?.timeBucket).toBe('week');
    expect(config.aggregation.function).toBe('avg');
    expect(config.derivedMetric?.type).toBe('duration');
    if (config.derivedMetric?.type === 'duration') {
      expect(config.derivedMetric.startMetadataKey).toBe('started_at');
      expect(config.derivedMetric.endMetadataKey).toBe('completed_at');
      expect(config.derivedMetric.unit).toBe('days');
    }
  });

  test('category_breakdown produces pie chart', () => {
    const config = resolveTemplate({
      templateId: 'category_breakdown',
      slots: { categoryField: 'ticket_type' },
    });

    expect(config.chartType).toBe('pie');
    expect(config.category?.metadataKey).toBe('ticket_type');
    expect(config.aggregation.function).toBe('count');
  });

  test('phase_snapshot produces bar chart with category', () => {
    const config = resolveTemplate({
      templateId: 'phase_snapshot',
      slots: { categoryField: 'phase', dateField: 'updated_at' },
    });

    expect(config.chartType).toBe('bar');
    expect(config.category?.metadataKey).toBe('phase');
    expect(config.xAxis?.metadataKey).toBe('updated_at');
    expect(config.aggregation.function).toBe('count');
  });

  test('throughput_over_time produces bar chart with time bucket', () => {
    const config = resolveTemplate({
      templateId: 'throughput_over_time',
      slots: { dateField: 'completed_at', timeBucket: 'month' },
    });

    expect(config.chartType).toBe('bar');
    expect(config.xAxis?.metadataKey).toBe('completed_at');
    expect(config.xAxis?.timeBucket).toBe('month');
    expect(config.aggregation.function).toBe('count');
  });

  test('field_trend produces line chart with aggregation', () => {
    const config = resolveTemplate({
      templateId: 'field_trend',
      slots: {
        dateField: 'created_at',
        numericField: 'story_points',
        timeBucket: 'week',
        aggregation: 'median',
      },
    });

    expect(config.chartType).toBe('line');
    expect(config.xAxis?.metadataKey).toBe('created_at');
    expect(config.xAxis?.timeBucket).toBe('week');
    expect(config.yAxis?.metadataKey).toBe('story_points');
    expect(config.aggregation.function).toBe('median');
  });

  test('category_comparison produces bar chart with numeric field', () => {
    const config = resolveTemplate({
      templateId: 'category_comparison',
      slots: {
        categoryField: 'team',
        numericField: 'lead_time',
        aggregation: 'p90',
      },
    });

    expect(config.chartType).toBe('bar');
    expect(config.category?.metadataKey).toBe('team');
    expect(config.yAxis?.metadataKey).toBe('lead_time');
    expect(config.aggregation.function).toBe('p90');
  });
});

describe('resolveTemplate new templates', () => {
  test('combined_metric_trend produces a line with a sum derived metric', () => {
    const config = resolveTemplate({
      templateId: 'combined_metric_trend',
      slots: {
        dateField: 'computed_completed_at',
        numericFields: ['full_development_seconds', 'full_review_seconds'],
        timeBucket: 'week',
        aggregation: 'median',
        referenceLines: [{ value: 30, label: 'Goal' }],
      },
    });

    expect(config.chartType).toBe('line');
    expect(config.xAxis?.metadataKey).toBe('computed_completed_at');
    expect(config.aggregation.function).toBe('median');
    expect(config.derivedMetric?.type).toBe('sum');
    if (config.derivedMetric?.type === 'sum') {
      expect(config.derivedMetric.metadataKeys).toEqual([
        'full_development_seconds',
        'full_review_seconds',
      ]);
    }
    expect(config.targets?.[0]).toMatchObject({
      type: 'horizontal_line',
      value: 30,
      label: 'Goal',
    });
  });

  test('composition_over_time produces a stacked series config', () => {
    const config = resolveTemplate({
      templateId: 'composition_over_time',
      slots: {
        dateField: 'computed_completed_at',
        numericFields: ['full_grooming_seconds', 'full_development_seconds', 'full_review_seconds'],
        timeBucket: 'month',
        aggregation: 'avg',
        mode: 'percent',
      },
    });

    expect(config.chartType).toBe('bar');
    expect(config.xAxis?.timeBucket).toBe('month');
    expect(config.aggregation.function).toBe('avg');
    expect(config.series?.metadataKeys.length).toBe(3);
    expect(config.series?.mode).toBe('percent');
  });
});

describe('resolveTemplate rolling_trend', () => {
  test('produces a scatter with a rolling config and no time bucket', () => {
    const config = resolveTemplate({
      templateId: 'rolling_trend',
      slots: {
        dateField: 'computed_completed_at',
        numericFields: ['full_development_seconds', 'full_review_seconds'],
        windowDays: 28,
        aggregation: 'median',
      },
    });
    expect(config.chartType).toBe('scatter');
    expect(config.xAxis?.type).toBe('date');
    expect(config.xAxis?.timeBucket).toBeUndefined();
    expect(config.rolling?.windowDays).toBe(28);
    expect(config.rolling?.aggregation).toBe('median');
    expect(config.rolling?.metadataKeys.length).toBe(2);
  });
});
