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
    expect(config.derivedMetric?.type === 'duration' && config.derivedMetric.startMetadataKey).toBe(
      'started_at'
    );
    expect(config.derivedMetric?.type === 'duration' && config.derivedMetric.endMetadataKey).toBe(
      'completed_at'
    );
    expect(config.derivedMetric?.type === 'duration' && config.derivedMetric.unit).toBe('days');
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
        numericFields: ['story_points'],
        timeBucket: 'week',
        aggregation: 'median',
      },
    });

    expect(config.chartType).toBe('line');
    expect(config.xAxis?.metadataKey).toBe('created_at');
    expect(config.xAxis?.timeBucket).toBe('week');
    expect(config.derivedMetric?.type).toBe('sum');
    expect(config.derivedMetric?.type === 'sum' && config.derivedMetric.metadataKeys).toEqual([
      'story_points',
    ]);
    expect(config.aggregation.function).toBe('median');
  });

  test('field_trend sums multiple numeric fields via derived metric', () => {
    const config = resolveTemplate({
      templateId: 'field_trend',
      slots: {
        dateField: 'created_at',
        numericFields: ['story_points', 'bonus_points'],
        timeBucket: 'week',
        aggregation: 'sum',
      },
    });

    expect(config.derivedMetric?.type).toBe('sum');
    expect(config.derivedMetric?.type === 'sum' && config.derivedMetric.metadataKeys).toEqual([
      'story_points',
      'bonus_points',
    ]);
    expect(config.derivedMetric?.name).toBe('Sum of values');
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

  test('category_comparison with unit divisor/label produces a measureTransform', () => {
    const config = resolveTemplate({
      templateId: 'category_comparison',
      slots: {
        categoryField: 'team',
        numericField: 'lead_time_seconds',
        aggregation: 'avg',
        unitDivisor: '86400',
        unitLabel: 'days',
      },
    });

    expect(config.measureTransform).toEqual({ divisor: 86400, unitLabel: 'days' });
  });

  test('category_comparison omits measureTransform when unitLabel is blank', () => {
    const config = resolveTemplate({
      templateId: 'category_comparison',
      slots: {
        categoryField: 'team',
        numericField: 'lead_time_seconds',
        aggregation: 'avg',
        unitDivisor: '86400',
        unitLabel: '',
      },
    });

    expect(config.measureTransform).toBeUndefined();
  });

  test('category_comparison falls back to divisor 1 when unitDivisor is invalid', () => {
    const config = resolveTemplate({
      templateId: 'category_comparison',
      slots: {
        categoryField: 'team',
        numericField: 'lead_time_seconds',
        aggregation: 'avg',
        unitDivisor: 'not-a-number',
        unitLabel: 'story points',
      },
    });

    expect(config.measureTransform).toEqual({ divisor: 1, unitLabel: 'story points' });
  });

  test('field_trend with unit divisor/label produces a measureTransform', () => {
    const config = resolveTemplate({
      templateId: 'field_trend',
      slots: {
        dateField: 'created_at',
        numericFields: ['cycle_time_seconds'],
        timeBucket: 'week',
        aggregation: 'avg',
        unitDivisor: '3600',
        unitLabel: 'hours',
      },
    });

    expect(config.measureTransform).toEqual({ divisor: 3600, unitLabel: 'hours' });
  });

  test('field_trend omits measureTransform when unit slots are absent', () => {
    const config = resolveTemplate({
      templateId: 'field_trend',
      slots: {
        dateField: 'created_at',
        numericFields: ['story_points'],
        timeBucket: 'week',
        aggregation: 'avg',
      },
    });

    expect(config.measureTransform).toBeUndefined();
  });

  test('field_trend with smoothingWindow produces a smoothing config', () => {
    const config = resolveTemplate({
      templateId: 'field_trend',
      slots: {
        dateField: 'created_at',
        numericFields: ['story_points'],
        timeBucket: 'week',
        aggregation: 'avg',
        smoothingWindow: '4',
      },
    });

    expect(config.smoothing).toEqual({ windowSize: 4 });
  });

  test('field_trend omits smoothing when smoothingWindow is absent', () => {
    const config = resolveTemplate({
      templateId: 'field_trend',
      slots: {
        dateField: 'created_at',
        numericFields: ['story_points'],
        timeBucket: 'week',
        aggregation: 'avg',
      },
    });

    expect(config.smoothing).toBeUndefined();
  });

  test('field_trend omits smoothing when smoothingWindow is invalid', () => {
    const config = resolveTemplate({
      templateId: 'field_trend',
      slots: {
        dateField: 'created_at',
        numericFields: ['story_points'],
        timeBucket: 'week',
        aggregation: 'avg',
        smoothingWindow: '1',
      },
    });

    expect(config.smoothing).toBeUndefined();
  });
});
