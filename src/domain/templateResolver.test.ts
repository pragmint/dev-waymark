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
    expect(config.derivedMetric?.startMetadataKey).toBe('started_at');
    expect(config.derivedMetric?.endMetadataKey).toBe('completed_at');
    expect(config.derivedMetric?.unit).toBe('days');
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
