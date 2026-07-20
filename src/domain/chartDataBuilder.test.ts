import { describe, test, expect } from 'bun:test';
import type { EntityWithMetadata } from '../schemas/entity';
import type { VisualizationConfig } from '../schemas/visualization';
import type { Waymark } from '../schemas/waymark';
import type { ChartDataResult, ChartJsDataset } from './chartDataBuilder';
import {
  aggregate,
  anchorBoundariesToAdjacentData,
  bucketDate,
  convertUnit,
  computeDerivedMetric,
  buildChartData,
  buildChartJsConfig,
  buildExcludedEntityFilters,
  buildLookbackSmoothingDataset,
  buildPointEntityFilters,
  buildSmoothingWindowEntityFilters,
  buildWaymarkDataset,
  extendLabelsForWaymarks,
  fillRangeGapLabels,
  filterWaymarksInRange,
  padDatasetsToLength,
  resolveWaymarkAnchors,
  suppressAnchoredPointMarkers,
  syncComparisonYAxis,
  validateVisualizationConfig,
} from './chartDataBuilder';
import { isGroup, isLeaf } from '../schemas/filterTree';
import type { ComputedDateRange } from './dateRange';

// ── Fixtures ──────────────────────────────────────────────────────────────────

function makeEntity(
  id: number,
  metadata: Record<
    string,
    { value: string | null; value_type: 'string' | 'number' | 'date' | 'boolean' }
  >
): EntityWithMetadata {
  return {
    id,
    name: `entity-${id}`,
    type: '',
    created_at: '',
    metadata: Object.entries(metadata).map(([key, { value, value_type }]) => ({
      entity_id: id,
      key,
      value,
      value_type,
      created_at: '',
      updated_at: '',
    })),
  };
}

/** Jira-ticket-like entities with known values */
const tickets: EntityWithMetadata[] = [
  // Week of 2026-04-27 (Monday)
  makeEntity(1, {
    created_at: { value: '2026-04-20T10:00:00Z', value_type: 'date' },
    done_at: { value: '2026-04-27T10:00:00Z', value_type: 'date' },
    lead_time_seconds: { value: '604800', value_type: 'number' }, // 7 days
    team: { value: 'Alpha', value_type: 'string' },
    issue_type: { value: 'Story', value_type: 'string' },
  }),
  makeEntity(2, {
    created_at: { value: '2026-04-22T10:00:00Z', value_type: 'date' },
    done_at: { value: '2026-04-29T10:00:00Z', value_type: 'date' },
    lead_time_seconds: { value: '432000', value_type: 'number' }, // 5 days
    team: { value: 'Beta', value_type: 'string' },
    issue_type: { value: 'Bug', value_type: 'string' },
  }),
  // Week of 2026-05-04 (Monday)
  makeEntity(3, {
    created_at: { value: '2026-04-28T10:00:00Z', value_type: 'date' },
    done_at: { value: '2026-05-05T10:00:00Z', value_type: 'date' },
    lead_time_seconds: { value: '604800', value_type: 'number' }, // 7 days
    team: { value: 'Alpha', value_type: 'string' },
    issue_type: { value: 'Story', value_type: 'string' },
  }),
  makeEntity(4, {
    created_at: { value: '2026-04-30T10:00:00Z', value_type: 'date' },
    done_at: { value: '2026-05-07T10:00:00Z', value_type: 'date' },
    lead_time_seconds: { value: '604800', value_type: 'number' }, // 7 days
    team: { value: 'Beta', value_type: 'string' },
    issue_type: { value: 'Task', value_type: 'string' },
  }),
  // Week of 2026-05-11 (Monday)
  makeEntity(5, {
    created_at: { value: '2026-05-06T10:00:00Z', value_type: 'date' },
    done_at: { value: '2026-05-12T10:00:00Z', value_type: 'date' },
    lead_time_seconds: { value: '518400', value_type: 'number' }, // 6 days
    team: { value: 'Alpha', value_type: 'string' },
    issue_type: { value: 'Bug', value_type: 'string' },
  }),
  // Entity missing done_at (will be excluded from time-series)
  makeEntity(6, {
    created_at: { value: '2026-05-10T10:00:00Z', value_type: 'date' },
    lead_time_seconds: { value: '86400', value_type: 'number' },
    team: { value: 'Alpha', value_type: 'string' },
    issue_type: { value: 'Task', value_type: 'string' },
  }),
];

// ── Aggregation tests ─────────────────────────────────────────────────────────

describe('aggregate', () => {
  const values = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];

  test('count', () => expect(aggregate(values, 'count')).toBe(10));
  test('sum', () => expect(aggregate(values, 'sum')).toBe(55));
  test('avg', () => expect(aggregate(values, 'avg')).toBe(5.5));
  test('min', () => expect(aggregate(values, 'min')).toBe(1));
  test('max', () => expect(aggregate(values, 'max')).toBe(10));
  test('median (even count)', () => expect(aggregate(values, 'median')).toBe(5.5));
  test('median (odd count)', () => expect(aggregate([1, 2, 3], 'median')).toBe(2));
  test('p75', () => expect(aggregate(values, 'p75')).toBeCloseTo(7.75));
  test('p90', () => expect(aggregate(values, 'p90')).toBeCloseTo(9.1));
  test('p95', () => expect(aggregate(values, 'p95')).toBeCloseTo(9.55));
  test('p99', () => expect(aggregate(values, 'p99')).toBeCloseTo(9.91));
  test('empty array returns 0', () => expect(aggregate([], 'avg')).toBe(0));
  test('single value', () => expect(aggregate([42], 'p95')).toBe(42));
});

// ── Time bucketing tests ──────────────────────────────────────────────────────

describe('bucketDate', () => {
  test('day', () => expect(bucketDate('2026-05-19T14:30:00Z', 'day')).toBe('2026-05-19'));

  test('week — returns Monday of the week', () => {
    // 2026-05-19 is a Tuesday; Monday is 2026-05-18
    expect(bucketDate('2026-05-19T10:00:00Z', 'week')).toBe('Week of 2026-05-18');
  });

  test('week — Monday stays Monday', () => {
    expect(bucketDate('2026-05-18T10:00:00Z', 'week')).toBe('Week of 2026-05-18');
  });

  test('week — Sunday wraps to previous Monday', () => {
    // 2026-05-17 is a Sunday; Monday is 2026-05-11
    expect(bucketDate('2026-05-17T10:00:00Z', 'week')).toBe('Week of 2026-05-11');
  });

  test('month', () => expect(bucketDate('2026-05-19T10:00:00Z', 'month')).toBe('2026-05'));

  test('quarter Q1', () => expect(bucketDate('2026-02-15T10:00:00Z', 'quarter')).toBe('2026-Q1'));
  test('quarter Q2', () => expect(bucketDate('2026-05-01T10:00:00Z', 'quarter')).toBe('2026-Q2'));
  test('quarter Q3', () => expect(bucketDate('2026-09-30T10:00:00Z', 'quarter')).toBe('2026-Q3'));
  test('quarter Q4', () => expect(bucketDate('2026-11-15T10:00:00Z', 'quarter')).toBe('2026-Q4'));

  test('year', () => expect(bucketDate('2026-05-19T10:00:00Z', 'year')).toBe('2026'));

  test('invalid date returns null', () => expect(bucketDate('not-a-date', 'day')).toBeNull());
});

// ── Unit conversion tests ─────────────────────────────────────────────────────

describe('convertUnit', () => {
  test('seconds to days', () => expect(convertUnit(432000, 'seconds', 'days')).toBe(5));
  test('seconds to hours', () => expect(convertUnit(7200, 'seconds', 'hours')).toBe(2));
  test('seconds to minutes', () => expect(convertUnit(120, 'seconds', 'minutes')).toBe(2));
  test('days to seconds', () => expect(convertUnit(1, 'days', 'seconds')).toBe(86400));
  test('weeks to days', () => expect(convertUnit(1, 'weeks', 'days')).toBe(7));
  test('same unit is identity', () => expect(convertUnit(42, 'seconds', 'seconds')).toBe(42));
  test('seconds to weeks', () => expect(convertUnit(604800, 'seconds', 'weeks')).toBe(1));
});

// ── Derived metric tests ──────────────────────────────────────────────────────

describe('computeDerivedMetric', () => {
  test('computes duration in seconds', () => {
    const entity = makeEntity(1, {
      created_at: { value: '2026-05-01T10:00:00Z', value_type: 'date' },
      done_at: { value: '2026-05-06T10:00:00Z', value_type: 'date' },
    });
    const result = computeDerivedMetric(entity, {
      name: 'lead_time',
      type: 'duration',
      startMetadataKey: 'created_at',
      endMetadataKey: 'done_at',
      unit: 'seconds',
    });
    expect(result).toBe(432000); // 5 days in seconds
  });

  test('computes duration in days', () => {
    const entity = makeEntity(1, {
      created_at: { value: '2026-05-01T00:00:00Z', value_type: 'date' },
      done_at: { value: '2026-05-06T00:00:00Z', value_type: 'date' },
    });
    const result = computeDerivedMetric(entity, {
      name: 'lead_time',
      type: 'duration',
      startMetadataKey: 'created_at',
      endMetadataKey: 'done_at',
      unit: 'days',
    });
    expect(result).toBe(5);
  });

  test('returns null when start field is missing', () => {
    const entity = makeEntity(1, {
      done_at: { value: '2026-05-06T10:00:00Z', value_type: 'date' },
    });
    expect(
      computeDerivedMetric(entity, {
        name: 'lt',
        type: 'duration',
        startMetadataKey: 'created_at',
        endMetadataKey: 'done_at',
        unit: 'seconds',
      })
    ).toBeNull();
  });

  test('returns null when end field is missing', () => {
    const entity = makeEntity(1, {
      created_at: { value: '2026-05-01T10:00:00Z', value_type: 'date' },
    });
    expect(
      computeDerivedMetric(entity, {
        name: 'lt',
        type: 'duration',
        startMetadataKey: 'created_at',
        endMetadataKey: 'done_at',
        unit: 'seconds',
      })
    ).toBeNull();
  });

  test('returns null when date value is invalid', () => {
    const entity = makeEntity(1, {
      created_at: { value: 'not-a-date', value_type: 'date' },
      done_at: { value: '2026-05-06T10:00:00Z', value_type: 'date' },
    });
    expect(
      computeDerivedMetric(entity, {
        name: 'lt',
        type: 'duration',
        startMetadataKey: 'created_at',
        endMetadataKey: 'done_at',
        unit: 'seconds',
      })
    ).toBeNull();
  });

  test('sums multiple numeric fields', () => {
    const entity = makeEntity(1, {
      story_points: { value: '3', value_type: 'number' },
      bonus_points: { value: '2', value_type: 'number' },
    });
    const result = computeDerivedMetric(entity, {
      name: 'total_points',
      type: 'sum',
      metadataKeys: ['story_points', 'bonus_points'],
    });
    expect(result).toBe(5);
  });

  test('sum returns null when any field is missing', () => {
    const entity = makeEntity(1, {
      story_points: { value: '3', value_type: 'number' },
    });
    const result = computeDerivedMetric(entity, {
      name: 'total_points',
      type: 'sum',
      metadataKeys: ['story_points', 'bonus_points'],
    });
    expect(result).toBeNull();
  });

  test('sum returns null when any field is non-numeric', () => {
    const entity = makeEntity(1, {
      story_points: { value: '3', value_type: 'number' },
      bonus_points: { value: 'not-a-number', value_type: 'number' },
    });
    const result = computeDerivedMetric(entity, {
      name: 'total_points',
      type: 'sum',
      metadataKeys: ['story_points', 'bonus_points'],
    });
    expect(result).toBeNull();
  });
});

// ── Validation tests ──────────────────────────────────────────────────────────

describe('validateVisualizationConfig', () => {
  test('valid time-series config has no errors', () => {
    const config: VisualizationConfig = {
      chartType: 'line',
      xAxis: { metadataKey: 'done_at', type: 'date', timeBucket: 'week' },
      yAxis: {
        metadataKey: 'lead_time_seconds',
        type: 'number',
        unit: 'seconds',
        displayUnit: 'days',
      },
      aggregation: { function: 'avg' },
    };
    expect(validateVisualizationConfig(config)).toEqual([]);
  });

  test('valid categorical config has no errors', () => {
    const config: VisualizationConfig = {
      chartType: 'bar',
      category: { metadataKey: 'team' },
      yAxis: { metadataKey: 'lead_time_seconds', type: 'number' },
      aggregation: { function: 'avg' },
    };
    expect(validateVisualizationConfig(config)).toEqual([]);
  });

  test('valid count config has no errors', () => {
    const config: VisualizationConfig = {
      chartType: 'bar',
      category: { metadataKey: 'issue_type' },
      aggregation: { function: 'count' },
    };
    expect(validateVisualizationConfig(config)).toEqual([]);
  });

  test('error when no xAxis or category', () => {
    const config: VisualizationConfig = {
      chartType: 'bar',
      aggregation: { function: 'count' },
    };
    expect(validateVisualizationConfig(config)).toContain(
      'Visualization requires either an x-axis (with time bucket) or a category field.'
    );
  });

  test('error when time bucket used with non-date field', () => {
    const config: VisualizationConfig = {
      chartType: 'line',
      xAxis: { metadataKey: 'team', type: 'string', timeBucket: 'week' },
      aggregation: { function: 'count' },
    };
    expect(validateVisualizationConfig(config)).toContain(
      'Time bucket requires a date x-axis field.'
    );
  });

  test('error when avg aggregation has no y-axis', () => {
    const config: VisualizationConfig = {
      chartType: 'bar',
      category: { metadataKey: 'team' },
      aggregation: { function: 'avg' },
    };
    const errors = validateVisualizationConfig(config);
    expect(errors.some(e => e.includes('"avg"'))).toBe(true);
  });

  test('error when pie chart has no category', () => {
    const config: VisualizationConfig = {
      chartType: 'pie',
      xAxis: { metadataKey: 'done_at', type: 'date', timeBucket: 'week' },
      aggregation: { function: 'count' },
    };
    expect(validateVisualizationConfig(config)).toContain(
      'Pie and doughnut charts require a category field.'
    );
  });

  test('valid config with derived metric has no errors', () => {
    const config: VisualizationConfig = {
      chartType: 'line',
      xAxis: { metadataKey: 'done_at', type: 'date', timeBucket: 'week' },
      aggregation: { function: 'avg' },
      derivedMetric: {
        name: 'lead_time',
        type: 'duration',
        startMetadataKey: 'created_at',
        endMetadataKey: 'done_at',
        unit: 'seconds',
      },
    };
    expect(validateVisualizationConfig(config)).toEqual([]);
  });

  test('valid config with smoothing on a time-bucketed x-axis has no errors', () => {
    const config: VisualizationConfig = {
      chartType: 'line',
      xAxis: { metadataKey: 'done_at', type: 'date', timeBucket: 'week' },
      yAxis: { metadataKey: 'lead_time_seconds', type: 'number' },
      aggregation: { function: 'avg' },
      smoothing: { windowSize: 4 },
    };
    expect(validateVisualizationConfig(config)).toEqual([]);
  });

  test('error when smoothing used without a time-bucketed x-axis', () => {
    const config: VisualizationConfig = {
      chartType: 'bar',
      category: { metadataKey: 'team' },
      yAxis: { metadataKey: 'lead_time_seconds', type: 'number' },
      aggregation: { function: 'avg' },
      smoothing: { windowSize: 4 },
    };
    expect(validateVisualizationConfig(config)).toContain(
      'Rolling average smoothing requires a time-bucketed x-axis.'
    );
  });
});

// ── buildChartData tests ──────────────────────────────────────────────────────

describe('buildChartData — time-series (avg lead time by week)', () => {
  const config: VisualizationConfig = {
    chartType: 'line',
    xAxis: { metadataKey: 'done_at', type: 'date', timeBucket: 'week' },
    yAxis: {
      metadataKey: 'lead_time_seconds',
      type: 'number',
      unit: 'seconds',
      displayUnit: 'days',
    },
    aggregation: { function: 'avg' },
  };

  test('produces correct labels in chronological order', () => {
    const result = buildChartData(tickets, config);
    expect(result.labels).toEqual([
      'Week of 2026-04-27',
      'Week of 2026-05-04',
      'Week of 2026-05-11',
    ]);
  });

  test('applies unit conversion seconds→days', () => {
    const result = buildChartData(tickets, config);
    // Week of 2026-04-27: avg(7, 5) days = 6
    expect(result.datasets[0].data[0]).toBe(6);
    // Week of 2026-05-04: avg(7, 7) days = 7
    expect(result.datasets[0].data[1]).toBe(7);
    // Week of 2026-05-11: avg(6) days = 6
    expect(result.datasets[0].data[2]).toBe(6);
  });

  test('excludes entity missing done_at', () => {
    const result = buildChartData(tickets, config);
    expect(result.excludedEntityCount).toBe(1);
    expect(result.warnings.length).toBe(1);
    expect(result.warnings[0]).toContain('done_at');
  });

  test('main dataset label reflects y-axis key', () => {
    const result = buildChartData(tickets, config);
    expect(result.datasets[0].label).toBe('lead_time_seconds');
  });
});

describe('buildChartData — time-series with derived metric', () => {
  const config: VisualizationConfig = {
    chartType: 'line',
    xAxis: { metadataKey: 'done_at', type: 'date', timeBucket: 'week' },
    yAxis: { metadataKey: 'done_at', type: 'date', displayUnit: 'days' },
    aggregation: { function: 'avg' },
    derivedMetric: {
      name: 'lead_time',
      type: 'duration',
      startMetadataKey: 'created_at',
      endMetadataKey: 'done_at',
      unit: 'seconds',
    },
  };

  test('derives metric and applies display conversion', () => {
    const result = buildChartData(tickets, config);
    // entity 1: 7 days, entity 2: 7 days → avg = 7
    expect(result.datasets[0].data[0]).toBe(7);
    expect(result.datasets[0].label).toBe('lead_time');
  });
});

describe('buildChartData — categorical (count by issue_type)', () => {
  const config: VisualizationConfig = {
    chartType: 'bar',
    category: { metadataKey: 'issue_type', sortBy: 'value_desc' },
    aggregation: { function: 'count' },
  };

  test('groups and counts by category', () => {
    const result = buildChartData(tickets, config);
    const storyIdx = result.labels.indexOf('Story');
    const bugIdx = result.labels.indexOf('Bug');
    const taskIdx = result.labels.indexOf('Task');
    expect(storyIdx).toBeGreaterThanOrEqual(0);
    expect(result.datasets[0].data[storyIdx]).toBe(2);
    expect(result.datasets[0].data[bugIdx]).toBe(2);
    expect(result.datasets[0].data[taskIdx]).toBe(2);
  });

  test('sorts value_desc: highest count first', () => {
    const result = buildChartData(tickets, config);
    const data = result.datasets[0].data;
    for (let i = 0; i < data.length - 1; i++) {
      expect(data[i] as number).toBeGreaterThanOrEqual(data[i + 1] as number);
    }
  });
});

describe('buildChartData — categorical (avg lead time by team)', () => {
  const config: VisualizationConfig = {
    chartType: 'bar',
    category: { metadataKey: 'team', sortBy: 'label_asc' },
    yAxis: {
      metadataKey: 'lead_time_seconds',
      type: 'number',
      unit: 'seconds',
      displayUnit: 'days',
    },
    aggregation: { function: 'avg' },
  };

  test('groups by team and averages lead time in days', () => {
    const result = buildChartData(tickets, config);
    // Alpha: entities 1,3,5,6 → 7, 7, 6, 1 days → avg = 21/4 = 5.25
    // Beta:  entities 2,4     → 5, 7 days       → avg = 6
    const alphaIdx = result.labels.indexOf('Alpha');
    const betaIdx = result.labels.indexOf('Beta');
    expect(result.datasets[0].data[alphaIdx]).toBeCloseTo(5.25, 2);
    expect(result.datasets[0].data[betaIdx]).toBe(6);
  });

  test('label_asc sorts alphabetically', () => {
    const result = buildChartData(tickets, config);
    const sorted = [...result.labels].sort();
    expect(result.labels).toEqual(sorted);
  });
});

describe('buildChartData — missing metadata handling', () => {
  test('excludes entity missing category field', () => {
    const entitiesWithMissing = [
      ...tickets.slice(0, 3),
      makeEntity(99, { lead_time_seconds: { value: '86400', value_type: 'number' } }), // no team
    ];
    const config: VisualizationConfig = {
      chartType: 'bar',
      category: { metadataKey: 'team' },
      yAxis: { metadataKey: 'lead_time_seconds', type: 'number' },
      aggregation: { function: 'avg' },
    };
    const result = buildChartData(entitiesWithMissing, config);
    expect(result.excludedEntityCount).toBe(1);
    expect(result.warnings[0]).toContain('team');
  });

  test('empty dataset returns empty labels and no warnings', () => {
    const config: VisualizationConfig = {
      chartType: 'bar',
      category: { metadataKey: 'team' },
      aggregation: { function: 'count' },
    };
    const result = buildChartData([], config);
    expect(result.labels).toEqual([]);
    expect(result.warnings).toEqual([]);
    expect(result.excludedEntityCount).toBe(0);
  });

  test('warning lists each required key once even when x-axis equals derived metric end', () => {
    const config: VisualizationConfig = {
      chartType: 'line',
      xAxis: { metadataKey: 'done_at', type: 'date', timeBucket: 'week' },
      aggregation: { function: 'avg' },
      derivedMetric: {
        name: 'lead_time',
        type: 'duration',
        startMetadataKey: 'created_at',
        endMetadataKey: 'done_at',
        unit: 'days',
      },
    };
    const entities = [makeEntity(1, {})];
    const result = buildChartData(entities, config);
    expect(result.warnings.length).toBe(1);
    const occurrences = (result.warnings[0].match(/done_at/g) ?? []).length;
    expect(occurrences).toBe(1);
    expect(result.warnings[0]).toContain('created_at');
  });
});

describe('buildExcludedEntityFilters', () => {
  test('returns IS NULL leaves OR-grouped for each unique required key', () => {
    const config: VisualizationConfig = {
      chartType: 'line',
      xAxis: { metadataKey: 'done_at', type: 'date', timeBucket: 'week' },
      aggregation: { function: 'avg' },
      derivedMetric: {
        name: 'lead_time',
        type: 'duration',
        startMetadataKey: 'created_at',
        endMetadataKey: 'done_at',
        unit: 'days',
      },
    };
    const nodes = buildExcludedEntityFilters(config);
    expect(nodes.length).toBe(1);
    const group = nodes[0];
    expect(isGroup(group)).toBe(true);
    if (!isGroup(group)) return;
    expect(group.op).toBe('OR');
    const keys = group.children.filter(isLeaf).map(l => l.key);
    expect(keys.sort()).toEqual(['created_at', 'done_at']);
    for (const child of group.children) {
      if (!isLeaf(child)) continue;
      expect(child.op).toBe('gte');
      expect(child.value).toBe('');
    }
  });

  test('returns single IS NULL leaf without OR group when one required key', () => {
    const config: VisualizationConfig = {
      chartType: 'bar',
      category: { metadataKey: 'team' },
      aggregation: { function: 'count' },
    };
    const nodes = buildExcludedEntityFilters(config);
    expect(nodes.length).toBe(1);
    expect(isLeaf(nodes[0])).toBe(true);
    if (!isLeaf(nodes[0])) return;
    expect(nodes[0].key).toBe('team');
    expect(nodes[0].op).toBe('gte');
    expect(nodes[0].value).toBe('');
  });
});

describe('buildChartData — target config', () => {
  const baseConfig: VisualizationConfig = {
    chartType: 'line',
    xAxis: { metadataKey: 'done_at', type: 'date', timeBucket: 'week' },
    yAxis: {
      metadataKey: 'lead_time_seconds',
      type: 'number',
      unit: 'seconds',
      displayUnit: 'days',
    },
    aggregation: { function: 'avg' },
  };

  test('horizontal_line adds a target dataset with constant values', () => {
    const config: VisualizationConfig = {
      ...baseConfig,
      target: { type: 'horizontal_line', value: 5, label: 'Target: 5 days' },
    };
    const result = buildChartData(tickets, config);
    const targetDs = result.datasets.find(d => d.label === 'Target: 5 days');
    expect(targetDs).toBeDefined();
    expect(targetDs!.data.every(v => v === 5)).toBe(true);
    expect(targetDs!.data.length).toBe(result.labels.length);
  });

  test('band adds two reference datasets', () => {
    const config: VisualizationConfig = {
      ...baseConfig,
      target: { type: 'band', min: 3, max: 7, label: 'Healthy Range' },
    };
    const result = buildChartData(tickets, config);
    expect(result.datasets.length).toBe(3);
    expect(result.datasets[1].data.every(v => v === 3)).toBe(true);
    expect(result.datasets[2].data.every(v => v === 7)).toBe(true);
  });

  test('vertical_line produces no extra dataset', () => {
    const config: VisualizationConfig = {
      ...baseConfig,
      target: { type: 'vertical_line', value: '2026-05-04', label: 'Release' },
    };
    const result = buildChartData(tickets, config);
    expect(result.datasets.length).toBe(1);
  });
});

describe('buildChartData — smoothing config', () => {
  const baseConfig: VisualizationConfig = {
    chartType: 'line',
    xAxis: { metadataKey: 'done_at', type: 'date', timeBucket: 'week' },
    yAxis: {
      metadataKey: 'lead_time_seconds',
      type: 'number',
      unit: 'seconds',
      displayUnit: 'days',
    },
    aggregation: { function: 'avg' },
  };

  // Main series (avg lead time in days per week): [6, 7, 6]

  test('adds a second dataset tracing the trailing rolling average', () => {
    const config: VisualizationConfig = { ...baseConfig, smoothing: { windowSize: 2 } };
    const result = buildChartData(tickets, config);
    expect(result.datasets.length).toBe(2);
    const smoothed = result.datasets[1];
    expect(smoothed.data.length).toBe(result.labels.length);
    expect(smoothed.data[0]).toBeCloseTo(6); // only one point available
    expect(smoothed.data[1]).toBeCloseTo(6.5); // avg(6, 7)
    expect(smoothed.data[2]).toBeCloseTo(6.5); // avg(7, 6)
  });

  test('window larger than available points averages over what exists', () => {
    const config: VisualizationConfig = { ...baseConfig, smoothing: { windowSize: 10 } };
    const result = buildChartData(tickets, config);
    const smoothed = result.datasets[1];
    expect(smoothed.data[0]).toBeCloseTo(6);
    expect(smoothed.data[1]).toBeCloseTo(6.5);
    expect(smoothed.data[2]).toBeCloseTo(19 / 3);
  });

  test('no smoothing dataset when smoothing is absent', () => {
    const result = buildChartData(tickets, baseConfig);
    expect(result.datasets.length).toBe(1);
  });

  test('smoothing dataset is styled as a solid first-class line, not a dashed reference line', () => {
    const config: VisualizationConfig = { ...baseConfig, smoothing: { windowSize: 2 } };
    const result = buildChartData(tickets, config);
    const smoothed = result.datasets[1];
    expect(smoothed.borderDash).toBeUndefined();
    expect(smoothed.pointRadius).toBeGreaterThan(0);
    expect(smoothed.type).toBe('line');
  });

  test('smoothing dataset label reflects the configured window size', () => {
    const config: VisualizationConfig = { ...baseConfig, smoothing: { windowSize: 3 } };
    const result = buildChartData(tickets, config);
    expect(result.datasets[1].label).toBe('lead_time_seconds (3-point avg)');
  });

  test('smoothingDatasetIndex points at the smoothing dataset', () => {
    const config: VisualizationConfig = { ...baseConfig, smoothing: { windowSize: 2 } };
    const result = buildChartData(tickets, config);
    expect(result.smoothingDatasetIndex).toBe(1);
  });

  test('smoothingDatasetIndex accounts for a target dataset appearing first', () => {
    const config: VisualizationConfig = {
      ...baseConfig,
      target: { type: 'horizontal_line', value: 5 },
      smoothing: { windowSize: 2 },
    };
    const result = buildChartData(tickets, config);
    expect(result.datasets.length).toBe(3);
    expect(result.smoothingDatasetIndex).toBe(2);
  });

  test('smoothingDatasetIndex is null when smoothing is absent', () => {
    const result = buildChartData(tickets, baseConfig);
    expect(result.smoothingDatasetIndex).toBeNull();
  });
});

// ── buildLookbackSmoothingDataset ─────────────────────────────────────────────
//
// A bounded dashboard date range only fetches entities inside that range, so
// computing the rolling average from those entities alone clips the first few
// visible points to fewer than `windowSize` points. buildLookbackSmoothingDataset
// takes a wider ("lookback") entity set and narrows the result back down to
// just the visible labels, producing a TRUE rolling average instead.

describe('buildLookbackSmoothingDataset', () => {
  function weekEntity(id: number, mondayIso: string, storyPoints: number): EntityWithMetadata {
    return makeEntity(id, {
      done_at: { value: `${mondayIso}T10:00:00Z`, value_type: 'date' },
      story_points: { value: String(storyPoints), value_type: 'number' },
    });
  }

  // One entity per week, six consecutive weeks, values 2..12 so a rolling
  // average is easy to hand-verify.
  const allWeeksEntities = [
    weekEntity(101, '2026-01-05', 2),
    weekEntity(102, '2026-01-12', 4),
    weekEntity(103, '2026-01-19', 6),
    weekEntity(104, '2026-01-26', 8),
    weekEntity(105, '2026-02-02', 10),
    weekEntity(106, '2026-02-09', 12),
  ];

  const config: VisualizationConfig = {
    chartType: 'line',
    xAxis: { metadataKey: 'done_at', type: 'date', timeBucket: 'week' },
    yAxis: { metadataKey: 'story_points', type: 'number' },
    aggregation: { function: 'avg' },
    smoothing: { windowSize: 3 },
  };

  // Simulates a dashboard date range bounded to just the last 3 of the 6 weeks.
  const visibleEntities = allWeeksEntities.slice(3);

  test('produces a TRUE rolling average using lookback history beyond the visible range', () => {
    const visibleResult = buildChartData(visibleEntities, { ...config, smoothing: undefined });
    expect(visibleResult.labels.length).toBe(3);

    const lookback = buildLookbackSmoothingDataset(
      visibleResult.labels,
      allWeeksEntities,
      visibleResult.datasets[0].label,
      config
    );
    expect(lookback).not.toBeNull();
    // Trailing window of 3: [W2,W3,W4]=6, [W3,W4,W5]=8, [W4,W5,W6]=10.
    expect(lookback!.dataset.data).toEqual([6, 8, 10]);
  });

  test('without lookback, the same visible-only entities clip the first point (proves the bug)', () => {
    const clippedResult = buildChartData(visibleEntities, config);
    expect(clippedResult.smoothingDatasetIndex).not.toBeNull();
    // No history before the visible range, so the first point can only
    // average what's present: itself.
    expect(clippedResult.datasets[clippedResult.smoothingDatasetIndex!].data[0]).toBe(8);
  });

  test('extendedLabels spans the full lookback entity set', () => {
    const visibleResult = buildChartData(visibleEntities, { ...config, smoothing: undefined });
    const lookback = buildLookbackSmoothingDataset(
      visibleResult.labels,
      allWeeksEntities,
      visibleResult.datasets[0].label,
      config
    );
    expect(lookback!.extendedLabels.length).toBe(6);
  });

  test('dataset label and style match the plain smoothing dataset', () => {
    const visibleResult = buildChartData(visibleEntities, { ...config, smoothing: undefined });
    const lookback = buildLookbackSmoothingDataset(
      visibleResult.labels,
      allWeeksEntities,
      visibleResult.datasets[0].label,
      config
    );
    expect(lookback!.dataset.label).toBe('story_points (3-point avg)');
    expect(lookback!.dataset.borderDash).toBeUndefined();
    expect(lookback!.dataset.pointRadius).toBeGreaterThan(0);
  });

  test('returns null when smoothing is not configured', () => {
    const visibleResult = buildChartData(visibleEntities, { ...config, smoothing: undefined });
    const result = buildLookbackSmoothingDataset(
      visibleResult.labels,
      allWeeksEntities,
      'story_points',
      {
        ...config,
        smoothing: undefined,
      }
    );
    expect(result).toBeNull();
  });

  // A calendar-based lookback (e.g. "3 weeks earlier") would under-reach here:
  // W3 has no entity at all, so 3 calendar weeks back from W6 only reaches W4,
  // short of the 3 *populated* buckets (W2, W4, W5) the window actually needs.
  // Passing every entity as `lookbackEntities` (no calendar cutoff) sidesteps
  // that entirely — computeMainSeries naturally skips the empty bucket.
  test('skips empty buckets rather than under-reaching on a calendar-based lookback', () => {
    const sparseEntities = [
      weekEntity(201, '2026-01-05', 2), // W1
      weekEntity(202, '2026-01-12', 4), // W2
      // W3 (2026-01-19) deliberately has no entity.
      weekEntity(204, '2026-01-26', 8), // W4
      weekEntity(205, '2026-02-02', 10), // W5
      weekEntity(206, '2026-02-09', 12), // W6
    ];
    const visibleSparseEntities = sparseEntities.slice(3); // W5, W6 only
    const visibleResult = buildChartData(visibleSparseEntities, {
      ...config,
      smoothing: undefined,
    });
    expect(visibleResult.labels.length).toBe(2);

    const lookback = buildLookbackSmoothingDataset(
      visibleResult.labels,
      sparseEntities,
      visibleResult.datasets[0].label,
      config
    );
    // Trailing window of 3 populated points: [W2,W4,W5]=(4+8+10)/3, [W4,W5,W6]=(8+10+12)/3.
    expect(lookback!.dataset.data[0]).toBeCloseTo((4 + 8 + 10) / 3);
    expect(lookback!.dataset.data[1]).toBeCloseTo((8 + 10 + 12) / 3);
  });
});

describe('buildChartData — measureTransform', () => {
  const config: VisualizationConfig = {
    chartType: 'bar',
    category: { metadataKey: 'team' },
    yAxis: { metadataKey: 'lead_time_seconds', type: 'number' },
    aggregation: { function: 'max' },
    measureTransform: { divisor: 86400, unitLabel: 'days' },
  };

  test('divides raw measure values by the divisor', () => {
    const result = buildChartData(tickets, config);
    const alphaIndex = result.labels.indexOf('Alpha');
    // Alpha's max lead_time_seconds is 604800 (7 days) → 604800 / 86400 = 7.
    expect(result.datasets[0].data[alphaIndex]).toBe(7);
  });

  test('changing the divisor changes the displayed value', () => {
    const hours: VisualizationConfig = {
      ...config,
      measureTransform: { divisor: 3600, unitLabel: 'hours' },
    };
    const result = buildChartData(tickets, hours);
    const alphaIndex = result.labels.indexOf('Alpha');
    expect(result.datasets[0].data[alphaIndex]).toBe(168); // 604800 / 3600
  });

  test('horizontal_line target value is used as-authored, already in display units', () => {
    // The user types "2" meaning 2 days directly — not 2 days worth of seconds.
    const withTarget: VisualizationConfig = {
      ...config,
      target: { type: 'horizontal_line', value: 2, label: 'Goal' },
    };
    const result = buildChartData(tickets, withTarget);
    const targetDs = result.datasets.find(d => d.label === 'Goal');
    expect(targetDs!.data.every(v => v === 2)).toBe(true);
  });

  test('band target min/max are used as-authored, already in display units', () => {
    const withBand: VisualizationConfig = {
      ...config,
      target: { type: 'band', min: 3, max: 7, label: 'Healthy' },
    };
    const result = buildChartData(tickets, withBand);
    expect(result.datasets[1].data.every(v => v === 3)).toBe(true);
    expect(result.datasets[2].data.every(v => v === 7)).toBe(true);
  });

  test('no transform leaves raw values untouched', () => {
    const raw: VisualizationConfig = { ...config, measureTransform: undefined };
    const result = buildChartData(tickets, raw);
    const alphaIndex = result.labels.indexOf('Alpha');
    expect(result.datasets[0].data[alphaIndex]).toBe(604800);
  });
});

// ── buildChartJsConfig tests ──────────────────────────────────────────────────

describe('buildChartJsConfig', () => {
  test('returns correct chart type', () => {
    const config: VisualizationConfig = {
      chartType: 'line',
      xAxis: { metadataKey: 'done_at', type: 'date', timeBucket: 'week' },
      yAxis: {
        metadataKey: 'lead_time_seconds',
        type: 'number',
        unit: 'seconds',
        displayUnit: 'days',
      },
      aggregation: { function: 'avg' },
    };
    const result = buildChartData(tickets, config);
    const jsConfig = buildChartJsConfig(result, config);
    expect(jsConfig.type).toBe('line');
  });

  test('labels and data are passed through', () => {
    const config: VisualizationConfig = {
      chartType: 'bar',
      category: { metadataKey: 'issue_type' },
      aggregation: { function: 'count' },
    };
    const result = buildChartData(tickets, config);
    const jsConfig = buildChartJsConfig(result, config);
    expect(jsConfig.data.labels).toEqual(result.labels);
    expect(jsConfig.data.datasets[0].data).toEqual(result.datasets[0].data);
  });

  test('pie chart gets multiple background colors', () => {
    const config: VisualizationConfig = {
      chartType: 'pie',
      category: { metadataKey: 'issue_type' },
      aggregation: { function: 'count' },
    };
    const result = buildChartData(tickets, config);
    const jsConfig = buildChartJsConfig(result, config);
    const bg = jsConfig.data.datasets[0].backgroundColor;
    expect(Array.isArray(bg)).toBe(true);
    expect((bg as string[]).length).toBe(result.labels.length);
  });

  test('options include y-axis label with display unit', () => {
    const config: VisualizationConfig = {
      chartType: 'line',
      xAxis: { metadataKey: 'done_at', type: 'date', timeBucket: 'week' },
      yAxis: {
        metadataKey: 'lead_time_seconds',
        type: 'number',
        unit: 'seconds',
        displayUnit: 'days',
      },
      aggregation: { function: 'avg' },
    };
    const result = buildChartData(tickets, config);
    const jsConfig = buildChartJsConfig(result, config);
    const scales = jsConfig.options.scales as Record<string, unknown>;
    const yAxis = scales.y as Record<string, unknown>;
    const title = yAxis.title as Record<string, unknown>;
    expect(title.text).toContain('days');
  });

  test('bar chart y-axis begins at zero', () => {
    const config: VisualizationConfig = {
      chartType: 'bar',
      xAxis: { metadataKey: 'done_at', type: 'date', timeBucket: 'day' },
      aggregation: { function: 'count' },
    };
    const result = buildChartData(tickets, config);
    const jsConfig = buildChartJsConfig(result, config);
    const scales = jsConfig.options.scales as Record<string, unknown>;
    const yAxis = scales.y as Record<string, unknown>;
    expect(yAxis.beginAtZero).toBe(true);
  });

  test('line chart y-axis does not begin at zero', () => {
    const config: VisualizationConfig = {
      chartType: 'line',
      xAxis: { metadataKey: 'done_at', type: 'date', timeBucket: 'week' },
      yAxis: { metadataKey: 'lead_time_seconds', type: 'number' },
      aggregation: { function: 'avg' },
    };
    const result = buildChartData(tickets, config);
    const jsConfig = buildChartJsConfig(result, config);
    const scales = jsConfig.options.scales as Record<string, unknown>;
    const yAxis = scales.y as Record<string, unknown>;
    expect(yAxis.beginAtZero).toBe(false);
  });

  test('measureTransform unit label appears on the y-axis title', () => {
    const config: VisualizationConfig = {
      chartType: 'bar',
      category: { metadataKey: 'team' },
      yAxis: { metadataKey: 'lead_time_seconds', type: 'number' },
      aggregation: { function: 'avg' },
      measureTransform: { divisor: 86400, unitLabel: 'days' },
    };
    const result = buildChartData(tickets, config);
    const jsConfig = buildChartJsConfig(result, config);
    const scales = jsConfig.options.scales as Record<string, unknown>;
    const yAxis = scales.y as Record<string, unknown>;
    const title = yAxis.title as Record<string, unknown>;
    expect(title.text).toContain('days');
  });

  test('measureTransform unit label is carried as a tooltip hint for the client to consume', () => {
    const config: VisualizationConfig = {
      chartType: 'bar',
      category: { metadataKey: 'team' },
      yAxis: { metadataKey: 'lead_time_seconds', type: 'number' },
      aggregation: { function: 'avg' },
      measureTransform: { divisor: 86400, unitLabel: 'days' },
    };
    const result = buildChartData(tickets, config);
    const jsConfig = buildChartJsConfig(result, config);
    const plugins = jsConfig.options.plugins as Record<string, unknown>;
    const tooltip = plugins.tooltip as Record<string, unknown>;
    expect(tooltip.unitLabel).toBe('days');
  });

  test('no unit label present when there is no unit/displayUnit/measureTransform', () => {
    const config: VisualizationConfig = {
      chartType: 'bar',
      category: { metadataKey: 'team' },
      aggregation: { function: 'count' },
    };
    const result = buildChartData(tickets, config);
    const jsConfig = buildChartJsConfig(result, config);
    const plugins = jsConfig.options.plugins as Record<string, unknown>;
    const tooltip = plugins.tooltip as Record<string, unknown>;
    expect(tooltip.unitLabel).toBeUndefined();
  });

  test('pie chart with no entities in range gets a placeholder slice instead of going blank', () => {
    const config: VisualizationConfig = {
      chartType: 'pie',
      category: { metadataKey: 'issue_type' },
      aggregation: { function: 'count' },
    };
    const result = buildChartData([], config);
    const jsConfig = buildChartJsConfig(result, config);
    expect(jsConfig.data.labels.length).toBe(1);
    expect(jsConfig.data.datasets[0].data).toEqual([1]);
    expect(jsConfig.data.datasets[0].backgroundColor).toBeDefined();
  });

  test('doughnut chart where all values sum to zero also gets a placeholder slice', () => {
    const config: VisualizationConfig = {
      chartType: 'doughnut',
      category: { metadataKey: 'issue_type' },
      aggregation: { function: 'sum' },
    };
    const result: ChartDataResult = {
      labels: ['bug', 'feature'],
      datasets: [{ label: 'Count', data: [0, 0] }],
      warnings: [],
      excludedEntityCount: 0,
      smoothingDatasetIndex: null,
    };
    const jsConfig = buildChartJsConfig(result, config);
    expect(jsConfig.data.labels.length).toBe(1);
    expect(jsConfig.data.datasets[0].data).toEqual([1]);
  });

  test('pie chart with real data is left untouched', () => {
    const config: VisualizationConfig = {
      chartType: 'pie',
      category: { metadataKey: 'issue_type' },
      aggregation: { function: 'count' },
    };
    const result = buildChartData(tickets, config);
    const jsConfig = buildChartJsConfig(result, config);
    expect(jsConfig.data.labels).toEqual(result.labels);
    expect(jsConfig.data.labels.length).toBeGreaterThan(1);
  });
});

// ── syncComparisonYAxis ────────────────────────────────────────────────────────

describe('syncComparisonYAxis', () => {
  const barConfig: VisualizationConfig = {
    chartType: 'bar',
    category: { metadataKey: 'team' },
    aggregation: { function: 'count' },
  };

  test('sets the same suggestedMax on both charts, taken from whichever has the larger value', () => {
    const small = buildChartJsConfig(buildChartData(tickets.slice(0, 2), barConfig), barConfig);
    const large = buildChartJsConfig(buildChartData(tickets, barConfig), barConfig);

    syncComparisonYAxis(small, large);

    const scalesSmall = small.options.scales as Record<string, Record<string, unknown>>;
    const scalesLarge = large.options.scales as Record<string, Record<string, unknown>>;
    expect(scalesSmall.y.suggestedMax).toBe(scalesLarge.y.suggestedMax);
    expect(scalesSmall.y.suggestedMax).toBeGreaterThan(0);
  });

  test('no-ops for circular charts, which have no y-axis', () => {
    const pieConfig: VisualizationConfig = {
      chartType: 'pie',
      category: { metadataKey: 'issue_type' },
      aggregation: { function: 'count' },
    };
    const a = buildChartJsConfig(buildChartData(tickets, pieConfig), pieConfig);
    const b = buildChartJsConfig(buildChartData(tickets, pieConfig), pieConfig);
    expect(() => syncComparisonYAxis(a, b)).not.toThrow();
    expect(a.options.scales).toBeUndefined();
  });
});

// ── P95 lead time by week ─────────────────────────────────────────────────────

describe('buildChartData — P95 lead time by week', () => {
  const config: VisualizationConfig = {
    chartType: 'line',
    xAxis: { metadataKey: 'done_at', type: 'date', timeBucket: 'week' },
    yAxis: {
      metadataKey: 'lead_time_seconds',
      type: 'number',
      unit: 'seconds',
      displayUnit: 'days',
    },
    aggregation: { function: 'p95' },
  };

  test('produces valid p95 values per week', () => {
    const result = buildChartData(tickets, config);
    // Only 1 or 2 values per week, so p95 ≈ max
    expect(result.datasets[0].data.length).toBe(3);
    result.datasets[0].data.forEach(v => expect(v).toBeGreaterThan(0));
  });
});

// ── buildPointEntityFilters ───────────────────────────────────────────────────

describe('buildPointEntityFilters', () => {
  function timeConfig(
    timeBucket: 'day' | 'week' | 'month' | 'quarter' | 'year'
  ): VisualizationConfig {
    return {
      chartType: 'line',
      xAxis: { metadataKey: 'done_at', type: 'date', timeBucket },
      aggregation: { function: 'count' },
    };
  }

  // The returned leaves carry generated ids; assert only key/op/value.
  function summarize(nodes: ReturnType<typeof buildPointEntityFilters>) {
    return nodes.map(n => (n.type === 'filter' ? { key: n.key, op: n.op, value: n.value } : n));
  }

  test('day bucket → gte day-start, lte day-end-of-day', () => {
    expect(summarize(buildPointEntityFilters('2024-03-15', timeConfig('day')))).toEqual([
      { key: 'done_at', op: 'gte', value: '2024-03-15' },
      { key: 'done_at', op: 'lte', value: '2024-03-15T23:59:59.999Z' },
    ]);
  });

  test('week bucket → gte Monday, lte Sunday-end-of-day', () => {
    expect(summarize(buildPointEntityFilters('Week of 2024-03-04', timeConfig('week')))).toEqual([
      { key: 'done_at', op: 'gte', value: '2024-03-04' },
      { key: 'done_at', op: 'lte', value: '2024-03-10T23:59:59.999Z' },
    ]);
  });

  test('month bucket → gte month-prefix, lte last-day-of-month', () => {
    expect(summarize(buildPointEntityFilters('2024-03', timeConfig('month')))).toEqual([
      { key: 'done_at', op: 'gte', value: '2024-03' },
      { key: 'done_at', op: 'lte', value: '2024-03-31T23:59:59.999Z' },
    ]);
    // February in a leap year ends on the 29th
    expect(summarize(buildPointEntityFilters('2024-02', timeConfig('month')))).toEqual([
      { key: 'done_at', op: 'gte', value: '2024-02' },
      { key: 'done_at', op: 'lte', value: '2024-02-29T23:59:59.999Z' },
    ]);
  });

  test('quarter bucket → gte first-month, lte last-day-of-third-month', () => {
    expect(summarize(buildPointEntityFilters('2024-Q1', timeConfig('quarter')))).toEqual([
      { key: 'done_at', op: 'gte', value: '2024-01' },
      { key: 'done_at', op: 'lte', value: '2024-03-31T23:59:59.999Z' },
    ]);
    expect(summarize(buildPointEntityFilters('2024-Q4', timeConfig('quarter')))).toEqual([
      { key: 'done_at', op: 'gte', value: '2024-10' },
      { key: 'done_at', op: 'lte', value: '2024-12-31T23:59:59.999Z' },
    ]);
  });

  test('year bucket → gte year, lte Dec-31-end-of-day', () => {
    expect(summarize(buildPointEntityFilters('2024', timeConfig('year')))).toEqual([
      { key: 'done_at', op: 'gte', value: '2024' },
      { key: 'done_at', op: 'lte', value: '2024-12-31T23:59:59.999Z' },
    ]);
  });

  test('category chart → single eq filter on category key', () => {
    const config: VisualizationConfig = {
      chartType: 'bar',
      category: { metadataKey: 'team' },
      aggregation: { function: 'count' },
    };
    expect(summarize(buildPointEntityFilters('Alpha', config))).toEqual([
      { key: 'team', op: 'eq', value: 'Alpha' },
    ]);
  });

  test('returns empty array when label does not match bucket format', () => {
    expect(buildPointEntityFilters('not-a-date', timeConfig('day'))).toEqual([]);
    expect(buildPointEntityFilters('2024-13', timeConfig('quarter'))).toEqual([]);
  });
});

// ── buildSmoothingWindowEntityFilters ─────────────────────────────────────────

describe('buildSmoothingWindowEntityFilters', () => {
  const config: VisualizationConfig = {
    chartType: 'line',
    xAxis: { metadataKey: 'done_at', type: 'date', timeBucket: 'week' },
    aggregation: { function: 'avg' },
  };
  const labels = [
    'Week of 2024-01-01',
    'Week of 2024-01-08',
    'Week of 2024-01-15',
    'Week of 2024-01-22',
  ];

  function summarize(nodes: ReturnType<typeof buildSmoothingWindowEntityFilters>) {
    return nodes.map(n => (n.type === 'filter' ? { key: n.key, op: n.op, value: n.value } : n));
  }

  test('spans from the start of the earliest bucket in the window to the end of the point bucket', () => {
    // windowSize 3, pointIndex 2 → covers buckets at indices 0, 1, 2.
    expect(summarize(buildSmoothingWindowEntityFilters(labels, 2, 3, config))).toEqual([
      { key: 'done_at', op: 'gte', value: '2024-01-01' },
      { key: 'done_at', op: 'lte', value: '2024-01-21T23:59:59.999Z' },
    ]);
  });

  test('clamps the window start to the first available label', () => {
    // windowSize 10 at pointIndex 1 would reach index -8; clamps to index 0.
    expect(summarize(buildSmoothingWindowEntityFilters(labels, 1, 10, config))).toEqual([
      { key: 'done_at', op: 'gte', value: '2024-01-01' },
      { key: 'done_at', op: 'lte', value: '2024-01-14T23:59:59.999Z' },
    ]);
  });

  test('windowSize 1 covers just the point bucket, same as buildPointEntityFilters', () => {
    expect(summarize(buildSmoothingWindowEntityFilters(labels, 3, 1, config))).toEqual([
      { key: 'done_at', op: 'gte', value: '2024-01-22' },
      { key: 'done_at', op: 'lte', value: '2024-01-28T23:59:59.999Z' },
    ]);
  });

  test('returns empty array without a time-bucketed x-axis', () => {
    const categoryConfig: VisualizationConfig = {
      chartType: 'bar',
      category: { metadataKey: 'team' },
      aggregation: { function: 'count' },
    };
    expect(buildSmoothingWindowEntityFilters(labels, 0, 2, categoryConfig)).toEqual([]);
  });

  test('returns empty array when a bucket label does not match the expected format', () => {
    expect(buildSmoothingWindowEntityFilters(['not-a-date'], 0, 2, config)).toEqual([]);
  });
});

// ── Waymark fixtures ──────────────────────────────────────────────────────────

function makeWaymark(overrides: Partial<Waymark> = {}): Waymark {
  return {
    id: 1,
    visualizationId: 1,
    startDate: '2026-01-01',
    endDate: '2026-12-31',
    targetValue: 0,
    appliesTo: 'main',
    label: null,
    createdAt: '',
    updatedAt: '',
    ...overrides,
  };
}

// ── filterWaymarksInRange ─────────────────────────────────────────────────────

function makeRange(overrides: Partial<ComputedDateRange> = {}): ComputedDateRange {
  return { start: null, end: null, label: '', ...overrides };
}

describe('filterWaymarksInRange', () => {
  test('keeps a waymark fully inside the range', () => {
    const waymark = makeWaymark({ startDate: '2026-02-01', endDate: '2026-02-28' });
    const range = makeRange({
      start: new Date('2026-02-01T00:00:00Z'),
      end: new Date('2026-02-28T23:59:59Z'),
    });
    expect(filterWaymarksInRange([waymark], range)).toEqual([waymark]);
  });

  test('excludes a waymark entirely before the range', () => {
    const waymark = makeWaymark({ startDate: '2025-01-01', endDate: '2025-03-31' });
    const range = makeRange({
      start: new Date('2026-04-01T00:00:00Z'),
      end: new Date('2026-06-30T23:59:59Z'),
    });
    expect(filterWaymarksInRange([waymark], range)).toEqual([]);
  });

  test('excludes a waymark entirely after the range — the reported bug', () => {
    // A goal line stretching into the future (e.g. today through year-end) should
    // disappear once the user shifts the dashboard to view a past quarter.
    const waymark = makeWaymark({ startDate: '2026-07-01', endDate: '2026-12-31' });
    const range = makeRange({
      start: new Date('2026-01-01T00:00:00Z'),
      end: new Date('2026-03-31T23:59:59Z'),
    });
    expect(filterWaymarksInRange([waymark], range)).toEqual([]);
  });

  test('keeps a waymark that only partially overlaps the range', () => {
    const waymark = makeWaymark({ startDate: '2026-01-15', endDate: '2026-02-15' });
    const range = makeRange({
      start: new Date('2026-02-01T00:00:00Z'),
      end: new Date('2026-02-28T23:59:59Z'),
    });
    expect(filterWaymarksInRange([waymark], range)).toEqual([waymark]);
  });

  test('keeps every waymark when the range is unbounded (all time)', () => {
    const waymark = makeWaymark({ startDate: '2020-01-01', endDate: '2020-01-31' });
    expect(filterWaymarksInRange([waymark], makeRange())).toEqual([waymark]);
  });
});

// ── fillRangeGapLabels ────────────────────────────────────────────────────────

describe('fillRangeGapLabels', () => {
  test('returns null when the range is unbounded', () => {
    expect(fillRangeGapLabels('day', makeRange())).toBeNull();
  });

  test('returns null when only one side of the range is bounded', () => {
    expect(
      fillRangeGapLabels('day', makeRange({ start: new Date('2026-04-01T00:00:00Z') }))
    ).toBeNull();
  });

  test('fills every day bucket across the range, inclusive of both ends', () => {
    const range = makeRange({
      start: new Date('2026-04-27T00:00:00Z'),
      end: new Date('2026-05-01T23:59:59Z'),
    });
    expect(fillRangeGapLabels('day', range)).toEqual([
      '2026-04-27',
      '2026-04-28',
      '2026-04-29',
      '2026-04-30',
      '2026-05-01',
    ]);
  });

  test('fills a full month of week buckets', () => {
    const range = makeRange({
      start: new Date('2026-04-01T00:00:00Z'),
      end: new Date('2026-04-30T23:59:59Z'),
    });
    expect(fillRangeGapLabels('week', range)).toEqual([
      'Week of 2026-03-30',
      'Week of 2026-04-06',
      'Week of 2026-04-13',
      'Week of 2026-04-20',
      'Week of 2026-04-27',
    ]);
  });

  test('returns a single label when start and end fall in the same bucket', () => {
    const range = makeRange({
      start: new Date('2026-04-05T00:00:00Z'),
      end: new Date('2026-04-05T23:59:59Z'),
    });
    expect(fillRangeGapLabels('day', range)).toEqual(['2026-04-05']);
  });
});

// ── buildChartData — gap-filling to the full range ────────────────────────────

describe('buildChartData — gap-filling to the full range', () => {
  const config: VisualizationConfig = {
    chartType: 'bar',
    xAxis: { metadataKey: 'done_at', type: 'date', timeBucket: 'day' },
    aggregation: { function: 'count' },
  };
  const range = makeRange({
    start: new Date('2026-04-27T00:00:00Z'),
    end: new Date('2026-05-01T23:59:59Z'),
  });
  // buildChartData never filters entities by date range itself — that's done
  // upstream by the SQL query (see dashboardsHandler) — so these tests mimic
  // that by only passing entities that actually fall within `range`.
  const entitiesInRange = tickets.filter(e => e.id === 1 || e.id === 2);

  test('zero-fills count buckets across the whole range, not just where data exists', () => {
    const result = buildChartData(entitiesInRange, config, range);
    expect(result.labels).toEqual([
      '2026-04-27',
      '2026-04-28',
      '2026-04-29',
      '2026-04-30',
      '2026-05-01',
    ]);
    // entity 1 done 04-27, entity 2 done 04-29, nothing else in range.
    expect(result.datasets[0].data).toEqual([1, 0, 1, 0, 0]);
  });

  test('null-fills non-additive aggregations instead of showing a fake zero', () => {
    const avgConfig: VisualizationConfig = {
      ...config,
      yAxis: {
        metadataKey: 'lead_time_seconds',
        type: 'number',
        unit: 'seconds',
        displayUnit: 'days',
      },
      aggregation: { function: 'avg' },
    };
    const result = buildChartData(entitiesInRange, avgConfig, range);
    expect(result.datasets[0].data).toEqual([7, null, 5, null, null]);
  });

  test('leaves labels as data-driven when the range is unbounded (all time)', () => {
    const result = buildChartData(tickets, config, makeRange());
    expect(result.labels).toEqual([
      '2026-04-27',
      '2026-04-29',
      '2026-05-05',
      '2026-05-07',
      '2026-05-12',
    ]);
  });

  test('leaves labels as data-driven when no range is passed at all', () => {
    const result = buildChartData(tickets, config);
    expect(result.labels).toEqual([
      '2026-04-27',
      '2026-04-29',
      '2026-05-05',
      '2026-05-07',
      '2026-05-12',
    ]);
  });
});

// ── anchorBoundariesToAdjacentData ────────────────────────────────────────────

describe('anchorBoundariesToAdjacentData', () => {
  function dayEntity(id: number, isoDate: string, value: number): EntityWithMetadata {
    return makeEntity(id, {
      done_at: { value: isoDate, value_type: 'date' },
      value: { value: String(value), value_type: 'number' },
    });
  }

  const config: VisualizationConfig = {
    chartType: 'line',
    xAxis: { metadataKey: 'done_at', type: 'date', timeBucket: 'day' },
    yAxis: { metadataKey: 'value', type: 'number' },
    aggregation: { function: 'avg' },
  };

  // Visible window is 04-27..05-01. Real data sits just outside both edges
  // (04-25 before, 05-03 after), plus one real point in the middle (04-29).
  const beforeEntity = dayEntity(1, '2026-04-25T00:00:00Z', 100);
  const middleEntity = dayEntity(2, '2026-04-29T00:00:00Z', 50);
  const afterEntity = dayEntity(3, '2026-05-03T00:00:00Z', 200);
  const fullHistory = [beforeEntity, middleEntity, afterEntity];

  const range = makeRange({
    start: new Date('2026-04-27T00:00:00Z'),
    end: new Date('2026-05-01T23:59:59Z'),
  });

  test('anchors both edges, interpolated by true distance to the outside value', () => {
    // Only the visible entity would actually be queried in production.
    const chartResult = buildChartData([middleEntity], config, range);
    const info = anchorBoundariesToAdjacentData(chartResult, fullHistory, config, range);
    // Leading: a straight line from 04-25 (100) to 04-29 (50) evaluated at
    // 04-27 (halfway) is 75 — not 100, which would claim the outside point
    // sits right at the edge.
    // Trailing: a straight line from 04-29 (50) to 05-03 (200) evaluated at
    // 05-01 (halfway) is 125.
    expect(chartResult.datasets[0].data).toEqual([75, null, 50, null, 125]);
    expect(info).toEqual({ main: { leading: true, trailing: true }, smoothing: null });
  });

  test('does not overwrite an edge bucket that already has real data', () => {
    const edgeEntity = dayEntity(4, '2026-04-27T00:00:00Z', 5);
    const chartResult = buildChartData([edgeEntity, middleEntity], config, range);
    const info = anchorBoundariesToAdjacentData(
      chartResult,
      [edgeEntity, ...fullHistory],
      config,
      range
    );
    expect(chartResult.datasets[0].data[0]).toBe(5);
    expect(info.main.leading).toBe(false);
  });

  test('a farther-away outside value produces a gentler edge slope than a closer one', () => {
    // Same real in-view point (04-29, 50) and same edge (04-27), but the
    // outside value is 4 days before the edge in one case and 1 day before it
    // in the other — this is the exact bug being fixed: treating the outside
    // value as if it sat right at the edge exaggerates the slope the farther
    // away it actually is.
    const farBefore = dayEntity(5, '2026-04-23T00:00:00Z', 100); // 4 days before the edge
    const nearBefore = dayEntity(6, '2026-04-26T00:00:00Z', 100); // 1 day before the edge

    const farResult = buildChartData([middleEntity], config, range);
    anchorBoundariesToAdjacentData(farResult, [farBefore, middleEntity], config, range);

    const nearResult = buildChartData([middleEntity], config, range);
    anchorBoundariesToAdjacentData(nearResult, [nearBefore, middleEntity], config, range);

    // Far case: line from 04-23 (100) to 04-29 (50) evaluated at 04-27
    // (4/6 of the way along) sits much closer to 50 than to 100.
    expect(farResult.datasets[0].data[0]).toBeCloseTo(66.67, 1);
    // Near case: line from 04-26 (100) to 04-29 (50) evaluated at 04-27
    // (1/3 of the way along) is still mostly at the outside value, since
    // barely any of the transition has happened by the edge.
    expect(nearResult.datasets[0].data[0]).toBeCloseTo(83.33, 1);
    // The nearer outside value pulls the edge closer to its own value than
    // the farther one does.
    expect(nearResult.datasets[0].data[0]!).toBeGreaterThan(farResult.datasets[0].data[0]!);
  });

  test('leaves an edge null when there is no history on that side', () => {
    const chartResult = buildChartData([middleEntity], config, range);
    const info = anchorBoundariesToAdjacentData(chartResult, [middleEntity], config, range);
    expect(chartResult.datasets[0].data).toEqual([null, null, 50, null, null]);
    expect(info).toEqual({ main: { leading: false, trailing: false }, smoothing: null });
  });

  test('is a no-op when the range is unbounded (all time)', () => {
    const chartResult = buildChartData(fullHistory, config, makeRange());
    const before = [...chartResult.datasets[0].data];
    const info = anchorBoundariesToAdjacentData(chartResult, fullHistory, config, makeRange());
    expect(chartResult.datasets[0].data).toEqual(before);
    expect(info).toEqual({ main: { leading: false, trailing: false }, smoothing: null });
  });

  test('is a no-op for category (non-time-bucketed) configs', () => {
    const categoryConfig: VisualizationConfig = {
      chartType: 'bar',
      category: { metadataKey: 'team' },
      aggregation: { function: 'count' },
    };
    const chartResult = buildChartData([middleEntity], categoryConfig, range);
    const before = [...chartResult.datasets[0].data];
    const info = anchorBoundariesToAdjacentData(chartResult, fullHistory, categoryConfig, range);
    expect(chartResult.datasets[0].data).toEqual(before);
    expect(info).toEqual({ main: { leading: false, trailing: false }, smoothing: null });
  });

  test('anchors the smoothing series independently, to its own rolling-average history', () => {
    const smoothingConfig: VisualizationConfig = { ...config, smoothing: { windowSize: 2 } };
    const chartResult = buildChartData([middleEntity], smoothingConfig, range);
    const info = anchorBoundariesToAdjacentData(chartResult, fullHistory, smoothingConfig, range);

    // Main series interpolates between the raw values at 04-25 (100) and
    // 05-03 (200), by way of the real 04-29 (50) point in view.
    expect(chartResult.datasets[0].data).toEqual([75, null, 50, null, 125]);
    // Smoothing series interpolates between the 2-point rolling average AS OF
    // those same boundary buckets — a different pair of numbers than the raw
    // main-series anchors (avg(100) = 100 at 04-25, avg(50, 200) = 125 at
    // 05-03), so it produces a different interpolated edge value too.
    expect(chartResult.datasets[chartResult.smoothingDatasetIndex!].data).toEqual([
      75,
      null,
      50,
      50,
      75,
    ]);
    expect(info).toEqual({
      main: { leading: true, trailing: true },
      smoothing: { leading: true, trailing: true },
    });
  });
});

// ── suppressAnchoredPointMarkers ──────────────────────────────────────────────

describe('suppressAnchoredPointMarkers', () => {
  const config: VisualizationConfig = {
    chartType: 'line',
    xAxis: { metadataKey: 'done_at', type: 'date', timeBucket: 'day' },
    yAxis: { metadataKey: 'value', type: 'number' },
    aggregation: { function: 'avg' },
    smoothing: { windowSize: 2 },
  };

  test('hides the marker only at anchored edges, on both main and smoothing datasets', () => {
    const chartResult = buildChartData([], config);
    chartResult.labels = ['a', 'b', 'c'];
    chartResult.datasets[0].data = [1, 2, 3];
    chartResult.datasets[1].data = [1, 2, 3];
    const chartJsConfig = buildChartJsConfig(chartResult, config);

    suppressAnchoredPointMarkers(chartJsConfig, chartResult.smoothingDatasetIndex, {
      main: { leading: true, trailing: true },
      smoothing: { leading: true, trailing: false },
    });

    expect(chartJsConfig.data.datasets[0].pointRadius).toEqual([0, 3, 0]);
    expect(chartJsConfig.data.datasets[1].pointRadius).toEqual([0, 3, 3]);
  });

  test('leaves pointRadius untouched when neither edge was anchored', () => {
    const chartResult = buildChartData([], config);
    const chartJsConfig = buildChartJsConfig(chartResult, config);

    suppressAnchoredPointMarkers(chartJsConfig, chartResult.smoothingDatasetIndex, {
      main: { leading: false, trailing: false },
      smoothing: null,
    });

    expect(chartJsConfig.data.datasets[0].pointRadius).toBe(3);
  });
});

// ── extendLabelsForWaymarks ───────────────────────────────────────────────────

describe('extendLabelsForWaymarks', () => {
  // "All time" / an open-ended custom range — nothing to cap the tail at.
  const unboundedRange: ComputedDateRange = { start: null, end: null, label: 'All time' };

  test('returns labels unchanged when there are no waymarks', () => {
    const labels = ['2026-01', '2026-02'];
    const result = extendLabelsForWaymarks(labels, 'month', [], unboundedRange);
    expect(result.labels).toEqual(labels);
    expect(result.realLabelCount).toBe(2);
  });

  test('does not extend when the waymark end date is already covered by existing labels', () => {
    const labels = ['2026-01', '2026-02', '2026-03'];
    const waymark = makeWaymark({ endDate: '2026-02-10' });
    const result = extendLabelsForWaymarks(labels, 'month', [waymark], unboundedRange);
    expect(result.labels).toEqual(labels);
    expect(result.realLabelCount).toBe(3);
  });

  test('extends past the last label up to a waymark end date a few months out, when the range is unbounded', () => {
    const labels = ['2026-01', '2026-02', '2026-03'];
    const waymark = makeWaymark({ endDate: '2026-06-15' });
    const result = extendLabelsForWaymarks(labels, 'month', [waymark], unboundedRange);
    expect(result.labels).toEqual([
      '2026-01',
      '2026-02',
      '2026-03',
      '2026-04',
      '2026-05',
      '2026-06',
    ]);
    expect(result.realLabelCount).toBe(3);
  });

  test('extends only as far as the furthest of multiple waymarks, when the range is unbounded', () => {
    const labels = ['2026-01', '2026-02'];
    const nearer = makeWaymark({ id: 1, endDate: '2026-04-15' });
    const furthest = makeWaymark({ id: 2, endDate: '2026-07-20' });
    const result = extendLabelsForWaymarks(labels, 'month', [nearer, furthest], unboundedRange);
    expect(result.labels).toEqual([
      '2026-01',
      '2026-02',
      '2026-03',
      '2026-04',
      '2026-05',
      '2026-06',
      '2026-07',
    ]);
    expect(result.realLabelCount).toBe(2);
  });

  test('returns empty labels unchanged even when a waymark is present', () => {
    const waymark = makeWaymark({ endDate: '2026-06-15' });
    const result = extendLabelsForWaymarks([], 'month', [waymark], unboundedRange);
    expect(result.labels).toEqual([]);
    expect(result.realLabelCount).toBe(0);
  });

  test('does not mutate the original labels array when extending', () => {
    const labels = ['2026-01', '2026-02'];
    const waymark = makeWaymark({ endDate: '2026-04-15' });
    extendLabelsForWaymarks(labels, 'month', [waymark], unboundedRange);
    expect(labels).toEqual(['2026-01', '2026-02']);
  });

  test('never extends past a bounded computed range, even when the waymark ends much further out', () => {
    // Mirrors the normal case: labels are already gap-filled out to
    // computedRange.end (e.g. viewing "this week" with a quarter-long goal),
    // so the tail must not stretch the chart past the selected window.
    const labels = ['2026-01', '2026-02', '2026-03'];
    const waymark = makeWaymark({ endDate: '2026-06-15' });
    const boundedRange: ComputedDateRange = {
      start: new Date('2026-01-01T00:00:00Z'),
      end: new Date('2026-03-15T00:00:00Z'),
      label: 'Q1 2026',
    };
    const result = extendLabelsForWaymarks(labels, 'month', [waymark], boundedRange);
    expect(result.labels).toEqual(labels);
    expect(result.realLabelCount).toBe(3);
  });

  test('extends only up to the bounded range end, not the waymark end, when real labels fall short of it', () => {
    // A custom range with only an end date set skips gap-fill (fillRangeGapLabels
    // requires both bounds), so real labels can end before computedRange.end.
    const labels = ['2026-01', '2026-02'];
    const waymark = makeWaymark({ endDate: '2026-06-15' });
    const boundedRange: ComputedDateRange = {
      start: null,
      end: new Date('2026-04-10T00:00:00Z'),
      label: 'Until Apr 10, 2026',
    };
    const result = extendLabelsForWaymarks(labels, 'month', [waymark], boundedRange);
    expect(result.labels).toEqual(['2026-01', '2026-02', '2026-03', '2026-04']);
    expect(result.realLabelCount).toBe(2);
  });
});

// ── padDatasetsToLength ────────────────────────────────────────────────────────

describe('padDatasetsToLength', () => {
  test('pads a shorter dataset with nulls up to length', () => {
    const ds: ChartJsDataset = { label: 'a', data: [1, 2] };
    padDatasetsToLength([ds], 5);
    expect(ds.data).toEqual([1, 2, null, null, null]);
  });

  test('pads multiple datasets independently based on their own length', () => {
    const short: ChartJsDataset = { label: 'a', data: [1] };
    const long: ChartJsDataset = { label: 'b', data: [1, 2, 3] };
    padDatasetsToLength([short, long], 3);
    expect(short.data).toEqual([1, null, null]);
    expect(long.data).toEqual([1, 2, 3]);
  });

  test('leaves a dataset already at the target length untouched', () => {
    const ds: ChartJsDataset = { label: 'a', data: [1, 2, 3] };
    padDatasetsToLength([ds], 3);
    expect(ds.data).toEqual([1, 2, 3]);
  });

  test('leaves a dataset already longer than the target length untouched', () => {
    const ds: ChartJsDataset = { label: 'a', data: [1, 2, 3, 4, 5] };
    padDatasetsToLength([ds], 3);
    expect(ds.data).toEqual([1, 2, 3, 4, 5]);
  });
});

// ── resolveWaymarkAnchors ──────────────────────────────────────────────────────

describe('resolveWaymarkAnchors', () => {
  function monthEntity(id: number, isoDate: string, value: number): EntityWithMetadata {
    return makeEntity(id, {
      done_at: { value: isoDate, value_type: 'date' },
      value: { value: String(value), value_type: 'number' },
    });
  }

  const config: VisualizationConfig = {
    chartType: 'line',
    xAxis: { metadataKey: 'done_at', type: 'date', timeBucket: 'month' },
    yAxis: { metadataKey: 'value', type: 'number' },
    aggregation: { function: 'avg' },
  };

  // Sparse history: January and March each have one entity; February is empty.
  const sparseEntities = [
    monthEntity(1, '2026-01-15T00:00:00Z', 10),
    monthEntity(2, '2026-03-15T00:00:00Z', 20),
  ];

  test('anchors to the aggregated value at the waymark start-date bucket', () => {
    const waymark = makeWaymark({ id: 10, startDate: '2026-03-10' });
    const anchors = resolveWaymarkAnchors([waymark], sparseEntities, config);
    expect(anchors.get(10)).toBe(20);
  });

  test('falls back to the nearest earlier bucket when the start-date bucket is empty', () => {
    const waymark = makeWaymark({ id: 11, startDate: '2026-02-10' });
    const anchors = resolveWaymarkAnchors([waymark], sparseEntities, config);
    expect(anchors.get(11)).toBe(10);
  });

  test('returns null when the start date is before all history', () => {
    const waymark = makeWaymark({ id: 12, startDate: '2025-12-01' });
    const anchors = resolveWaymarkAnchors([waymark], sparseEntities, config);
    expect(anchors.get(12)).toBeNull();
  });

  test('returns null when the start date does not parse into a bucket label', () => {
    const waymark = makeWaymark({ id: 13, startDate: 'not-a-date' });
    const anchors = resolveWaymarkAnchors([waymark], sparseEntities, config);
    expect(anchors.get(13)).toBeNull();
  });

  test('every waymark anchors to null when the config has no time-bucketed x-axis', () => {
    const categoryConfig: VisualizationConfig = {
      chartType: 'bar',
      category: { metadataKey: 'team' },
      aggregation: { function: 'count' },
    };
    const waymarks = [makeWaymark({ id: 20 }), makeWaymark({ id: 21 })];
    const anchors = resolveWaymarkAnchors(waymarks, sparseEntities, categoryConfig);
    expect(anchors.get(20)).toBeNull();
    expect(anchors.get(21)).toBeNull();
  });

  describe('appliesTo smoothing', () => {
    // One entity per month, steadily increasing, so the rolling average at
    // the final bucket differs from the raw main-series value there.
    const monthlyEntities = [
      monthEntity(31, '2026-01-15T00:00:00Z', 10),
      monthEntity(32, '2026-02-15T00:00:00Z', 20),
      monthEntity(33, '2026-03-15T00:00:00Z', 30),
      monthEntity(34, '2026-04-15T00:00:00Z', 40),
    ];

    test('anchors to the rolling average rather than the raw main series when smoothing is configured', () => {
      const smoothingConfig: VisualizationConfig = { ...config, smoothing: { windowSize: 2 } };
      const waymark = makeWaymark({ id: 40, startDate: '2026-04-10', appliesTo: 'smoothing' });
      const anchors = resolveWaymarkAnchors([waymark], monthlyEntities, smoothingConfig);
      // Main series value at April is 40; rolling avg(2) of [30, 40] is 35.
      expect(anchors.get(40)).toBe(35);
      expect(anchors.get(40)).not.toBe(40);
    });

    test('falls back to the main series when the visualization has no smoothing configured', () => {
      const waymark = makeWaymark({ id: 41, startDate: '2026-04-10', appliesTo: 'smoothing' });
      const anchors = resolveWaymarkAnchors([waymark], monthlyEntities, config);
      expect(anchors.get(41)).toBe(40);
    });
  });
});

// ── buildWaymarkDataset ─────────────────────────────────────────────────────────

describe('buildWaymarkDataset', () => {
  test('interpolates linearly from startValue to targetValue and clips outside the visible range', () => {
    const waymark = makeWaymark({
      startDate: '2026-01-10',
      endDate: '2026-04-10',
      targetValue: 100,
    });
    const labels = ['2025-11', '2025-12', '2026-01', '2026-02', '2026-03', '2026-04', '2026-05'];
    const result = buildWaymarkDataset(waymark, 20, labels, 'month');

    expect(result).not.toBeNull();
    expect(result!.data[0]).toBeNull(); // before range
    expect(result!.data[1]).toBeNull(); // before range
    expect(result!.data[2]).toBe(20); // start of range
    expect(result!.data[3]).toBeCloseTo(20 + (1 / 3) * 80);
    expect(result!.data[4]).toBeCloseTo(20 + (2 / 3) * 80);
    expect(result!.data[5]).toBe(100); // end of range
    expect(result!.data[6]).toBeNull(); // after range
    expect(result!.label).toBe('Waymark');
  });

  test('computes the exact midpoint for a symmetric two-bucket span', () => {
    const waymark = makeWaymark({
      startDate: '2026-01-10',
      endDate: '2026-03-10',
      targetValue: 100,
    });
    const labels = ['2026-01', '2026-02', '2026-03'];
    const result = buildWaymarkDataset(waymark, 20, labels, 'month');
    expect(result).not.toBeNull();
    expect(result!.data).toEqual([20, 60, 100]);
  });

  test('returns null when endDate is before startDate', () => {
    const waymark = makeWaymark({
      startDate: '2026-04-01',
      endDate: '2026-01-01',
      targetValue: 100,
    });
    const labels = ['2026-01', '2026-02', '2026-03', '2026-04'];
    expect(buildWaymarkDataset(waymark, 20, labels, 'month')).toBeNull();
  });

  test('every in-range point equals targetValue when start and end fall in the same bucket', () => {
    const waymark = makeWaymark({
      startDate: '2026-02-05',
      endDate: '2026-02-25',
      targetValue: 50,
    });
    const labels = ['2026-01', '2026-02', '2026-03'];
    const result = buildWaymarkDataset(waymark, 10, labels, 'month');
    expect(result).not.toBeNull();
    expect(result!.data).toEqual([null, 50, null]);
  });

  test('uses the waymark label when set, falling back to "Waymark" only when null', () => {
    const waymark = makeWaymark({
      startDate: '2026-01-10',
      endDate: '2026-02-10',
      targetValue: 10,
      label: 'Ship goal',
    });
    const result = buildWaymarkDataset(waymark, 0, ['2026-01', '2026-02'], 'month');
    expect(result!.label).toBe('Ship goal');
  });
});
