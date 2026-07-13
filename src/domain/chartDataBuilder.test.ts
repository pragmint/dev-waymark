import { describe, test, expect } from 'bun:test';
import type { EntityWithMetadata } from '../schemas/entity';
import type { VisualizationConfig } from '../schemas/visualization';
import {
  aggregate,
  bucketDate,
  convertUnit,
  computeDerivedMetric,
  buildChartData,
  buildChartJsConfig,
  buildExcludedEntityFilters,
  buildPointEntityFilters,
  validateVisualizationConfig,
} from './chartDataBuilder';
import { isGroup, isLeaf } from '../schemas/filterTree';

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
    const data = result.datasets[0].data as number[];
    for (let i = 0; i < data.length - 1; i++) {
      expect(data[i]).toBeGreaterThanOrEqual(data[i + 1]);
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

// ── Combined (sum) derived metric ───────────────────────────────────────────────

describe('computeDerivedMetric (sum)', () => {
  const sumConfig = {
    name: 'Cycle',
    type: 'sum' as const,
    metadataKeys: ['dev_seconds', 'review_seconds', 'qi_seconds'],
  };

  test('sums the listed numeric fields', () => {
    const e = makeEntity(1, {
      dev_seconds: { value: '100', value_type: 'number' },
      review_seconds: { value: '50', value_type: 'number' },
      qi_seconds: { value: '25', value_type: 'number' },
    });
    expect(computeDerivedMetric(e, sumConfig)).toBe(175);
  });

  test('treats missing fields as zero when at least one is present', () => {
    const e = makeEntity(2, { dev_seconds: { value: '100', value_type: 'number' } });
    expect(computeDerivedMetric(e, sumConfig)).toBe(100);
  });

  test('returns null when every field is missing (entity excluded)', () => {
    const e = makeEntity(3, { other: { value: '9', value_type: 'number' } });
    expect(computeDerivedMetric(e, sumConfig)).toBeNull();
  });
});

// ── Composition (stacked series) ────────────────────────────────────────────────

describe('buildChartData composition', () => {
  const phaseEntities: EntityWithMetadata[] = [
    makeEntity(1, {
      done_at: { value: '2026-04-27T10:00:00Z', value_type: 'date' }, // Week of 2026-04-27
      dev: { value: '60', value_type: 'number' },
      review: { value: '40', value_type: 'number' },
    }),
    makeEntity(2, {
      done_at: { value: '2026-04-28T10:00:00Z', value_type: 'date' }, // same week
      dev: { value: '20', value_type: 'number' },
      review: { value: '80', value_type: 'number' },
    }),
  ];

  const baseSeriesConfig: VisualizationConfig = {
    chartType: 'bar',
    xAxis: { metadataKey: 'done_at', type: 'date', timeBucket: 'week' },
    aggregation: { function: 'avg' },
    series: { metadataKeys: ['dev', 'review'], mode: 'absolute' },
  };

  test('absolute mode emits one dataset per field, aggregated per bucket', () => {
    const result = buildChartData(phaseEntities, baseSeriesConfig);
    expect(result.labels).toEqual(['Week of 2026-04-27']);
    expect(result.datasets.map(d => d.label)).toEqual(['dev', 'review']);
    expect(result.datasets[0].data).toEqual([40]); // avg(60,20)
    expect(result.datasets[1].data).toEqual([60]); // avg(40,80)
  });

  test('percent mode normalizes each bucket to 100', () => {
    const result = buildChartData(phaseEntities, {
      ...baseSeriesConfig,
      series: { metadataKeys: ['dev', 'review'], mode: 'percent' },
    });
    expect(result.datasets[0].data[0]).toBeCloseTo(40); // 40 / (40+60) * 100
    expect(result.datasets[1].data[0]).toBeCloseTo(60);
  });

  test('missing series field counts as zero', () => {
    const withGap = [
      ...phaseEntities,
      makeEntity(3, {
        done_at: { value: '2026-04-29T10:00:00Z', value_type: 'date' },
        dev: { value: '30', value_type: 'number' },
      }),
    ];
    const result = buildChartData(withGap, baseSeriesConfig);
    // review for entity 3 is absent → 0; avg(40,80,0) = 40
    expect(result.datasets[1].data).toEqual([40]);
  });

  test('stacked scales are set on the chart config', () => {
    const cfg = buildChartJsConfig(
      buildChartData(phaseEntities, baseSeriesConfig),
      baseSeriesConfig
    );
    const scales = (cfg.options as { scales: { x: { stacked: boolean }; y: { stacked: boolean } } })
      .scales;
    expect(scales.x.stacked).toBe(true);
    expect(scales.y.stacked).toBe(true);
  });
});

// ── Multiple reference lines ────────────────────────────────────────────────────

describe('buildChartData multiple targets', () => {
  test('renders one dashed dataset per target line', () => {
    const config: VisualizationConfig = {
      chartType: 'line',
      xAxis: { metadataKey: 'done_at', type: 'date', timeBucket: 'week' },
      aggregation: { function: 'median' },
      derivedMetric: { name: 'Cycle', type: 'sum', metadataKeys: ['dev'] },
      targets: [
        { type: 'horizontal_line', value: 30, label: 'Goal' },
        { type: 'horizontal_line', value: 45, label: 'Baseline' },
      ],
    };
    const e = makeEntity(1, {
      done_at: { value: '2026-04-27T10:00:00Z', value_type: 'date' },
      dev: { value: '50', value_type: 'number' },
    });
    const result = buildChartData([e], config);
    const labels = result.datasets.map(d => d.label);
    expect(labels).toContain('Goal');
    expect(labels).toContain('Baseline');
    const goal = result.datasets.find(d => d.label === 'Goal')!;
    expect(goal.data).toEqual([30]);
    expect(goal.borderDash).toBeDefined();
  });
});

// ── Validation for new shapes ────────────────────────────────────────────────────

describe('validateVisualizationConfig new shapes', () => {
  test('composition requires >= 2 fields and avg/sum aggregation', () => {
    const bad: VisualizationConfig = {
      chartType: 'bar',
      xAxis: { metadataKey: 'done_at', type: 'date', timeBucket: 'week' },
      aggregation: { function: 'median' },
      series: { metadataKeys: ['dev'], mode: 'absolute' },
    };
    const errors = validateVisualizationConfig(bad);
    expect(errors.some(e => /at least two/.test(e))).toBe(true);
    expect(errors.some(e => /avg or sum/.test(e))).toBe(true);
  });

  test('combined sum metric with a date bucket validates clean', () => {
    const ok: VisualizationConfig = {
      chartType: 'line',
      xAxis: { metadataKey: 'done_at', type: 'date', timeBucket: 'week' },
      aggregation: { function: 'median' },
      derivedMetric: { name: 'Cycle', type: 'sum', metadataKeys: ['dev', 'review'] },
    };
    expect(validateVisualizationConfig(ok)).toEqual([]);
  });
});

// ── Rolling trend (points + trailing median) ─────────────────────────────────────

describe('buildChartData rolling trend', () => {
  const rollingCfg: VisualizationConfig = {
    chartType: 'scatter',
    xAxis: { metadataKey: 'done_at', type: 'date' },
    aggregation: { function: 'median' },
    rolling: { metadataKeys: ['cycle'], windowDays: 28, aggregation: 'median' },
  };
  const ents: EntityWithMetadata[] = [
    makeEntity(1, {
      done_at: { value: '2026-01-01T00:00:00Z', value_type: 'date' },
      cycle: { value: '10', value_type: 'number' },
    }),
    makeEntity(2, {
      done_at: { value: '2026-01-10T00:00:00Z', value_type: 'date' },
      cycle: { value: '20', value_type: 'number' },
    }),
    makeEntity(3, {
      done_at: { value: '2026-01-20T00:00:00Z', value_type: 'date' },
      cycle: { value: '30', value_type: 'number' },
    }),
  ];

  test('emits a scatter points dataset and a rolling-median line', () => {
    const result = buildChartData(ents, rollingCfg);
    expect(result.datasets.length).toBe(2);
    const [points, line] = result.datasets;
    expect(points.type).toBe('scatter');
    expect(points.showLine).toBe(false);
    expect(points.data.length).toBe(3);
    expect(line.type).toBe('line');
    // trailing 28-day medians: [median(10), median(10,20), median(10,20,30)]
    expect((line.data as Array<{ y: number }>).map(p => p.y)).toEqual([10, 15, 20]);
  });

  test('points carry x/y with ISO dates in sorted order', () => {
    const shuffled = [ents[2], ents[0], ents[1]];
    const result = buildChartData(shuffled, rollingCfg);
    const xs = (result.datasets[0].data as Array<{ x: string }>).map(p => p.x);
    expect(xs).toEqual([...xs].sort());
    expect(xs[0]).toContain('2026-01-01');
  });

  test('excludes entities missing a date or value', () => {
    const withGaps = [
      ...ents,
      makeEntity(4, { cycle: { value: '99', value_type: 'number' } }), // no date
      makeEntity(5, { done_at: { value: '2026-02-01T00:00:00Z', value_type: 'date' } }), // no value
    ];
    const result = buildChartData(withGaps, rollingCfg);
    expect(result.datasets[0].data.length).toBe(3);
    expect(result.excludedEntityCount).toBe(2);
  });

  test('config builder marks x-axis as a time scale', () => {
    const cfg = buildChartJsConfig(buildChartData(ents, rollingCfg), rollingCfg);
    const scales = (cfg.options as { scales: { x: { type?: string } } }).scales;
    expect(scales.x.type).toBe('time');
  });
});
