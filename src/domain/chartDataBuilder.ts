import type { EntityWithMetadata } from '../schemas/entity';
import { makeLeaf } from '../schemas/filterTree';
import type { FilterNode } from '../schemas/filterTree';
import { inWindow, resolveNamedWindow, WEEKDAY_WINDOWS } from './dateRange';
import type { ResolvedWindow } from './dateRange';
import type {
  VisualizationConfig,
  AggregationFunction,
  TimeBucket,
  DurationUnit,
  DerivedMetricConfig,
  TargetConfig,
  ChartType,
  NamedWindow,
} from '../schemas/visualization';

// ── Output types ──────────────────────────────────────────────────────────────

export type XYPoint = { x: string | number; y: number };

export type ChartJsDataset = {
  label: string;
  data: Array<number | XYPoint>;
  borderColor?: string;
  backgroundColor?: string | string[];
  fill?: boolean | string;
  tension?: number;
  borderDash?: number[];
  pointRadius?: number;
  showLine?: boolean;
  type?: string;
  order?: number;
};

export type ChartDataResult = {
  labels: string[];
  datasets: ChartJsDataset[];
  warnings: string[];
  excludedEntityCount: number;
};

export type ChartJsConfig = {
  type: string;
  data: {
    labels: string[];
    datasets: ChartJsDataset[];
  };
  options: Record<string, unknown>;
};

// ── Aggregation ───────────────────────────────────────────────────────────────

function percentile(values: number[], p: number): number {
  const sorted = [...values].sort((a, b) => a - b);
  if (sorted.length === 0) return 0;
  if (sorted.length === 1) return sorted[0];
  const idx = (p / 100) * (sorted.length - 1);
  const lower = Math.floor(idx);
  const upper = Math.ceil(idx);
  if (lower === upper) return sorted[lower];
  return sorted[lower] + (sorted[upper] - sorted[lower]) * (idx - lower);
}

export function aggregate(values: number[], fn: AggregationFunction): number {
  if (values.length === 0) return 0;
  switch (fn) {
    case 'count':
      return values.length;
    case 'sum':
      return values.reduce((a, b) => a + b, 0);
    case 'avg':
      return values.reduce((a, b) => a + b, 0) / values.length;
    case 'min':
      return Math.min(...values);
    case 'max':
      return Math.max(...values);
    case 'median':
      return percentile(values, 50);
    case 'p75':
      return percentile(values, 75);
    case 'p85':
      return percentile(values, 85);
    case 'p90':
      return percentile(values, 90);
    case 'p95':
      return percentile(values, 95);
    case 'p99':
      return percentile(values, 99);
  }
}

// ── Time bucketing ────────────────────────────────────────────────────────────

export function bucketDate(dateStr: string, bucket: TimeBucket): string | null {
  const date = new Date(dateStr);
  if (isNaN(date.getTime())) return null;
  switch (bucket) {
    case 'day':
      return date.toISOString().slice(0, 10);
    case 'week': {
      const d = new Date(date);
      const day = d.getUTCDay(); // 0=Sun … 6=Sat
      d.setUTCDate(d.getUTCDate() + (day === 0 ? -6 : 1 - day));
      return `Week of ${d.toISOString().slice(0, 10)}`;
    }
    case 'month':
      return date.toISOString().slice(0, 7);
    case 'quarter': {
      const q = Math.floor(date.getUTCMonth() / 3) + 1;
      return `${date.getUTCFullYear()}-Q${q}`;
    }
    case 'year':
      return `${date.getUTCFullYear()}`;
  }
}

// ── Bucket label → entity-filter range ────────────────────────────────────────

// Inverse of bucketDate: given a bucket label, return the [gte, lte] string
// bounds that match every entity falling into that bucket. Bounds are chosen
// to compare correctly under SQLite's lexicographic string comparison, which
// is how MetaFilter gte/lte operate on date values (see entityRepository).
//
// gte uses the bucket prefix (e.g. "2024-01" for month) so bare values like
// "2024-01" or "2024-01-15" both satisfy it. lte uses the last day of the
// bucket plus the maximum time-of-day, which dominates every timestamp on
// that day and falls short of the next day's prefix.
function bucketRange(label: string, bucket: TimeBucket): { gte: string; lte: string } | null {
  switch (bucket) {
    case 'day': {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(label)) return null;
      return { gte: label, lte: `${label}T23:59:59.999Z` };
    }
    case 'week': {
      const m = /^Week of (\d{4}-\d{2}-\d{2})$/.exec(label);
      if (!m) return null;
      const start = m[1];
      const startMs = Date.parse(`${start}T00:00:00Z`);
      if (isNaN(startMs)) return null;
      const endStr = new Date(startMs + 6 * 86_400_000).toISOString().slice(0, 10);
      return { gte: start, lte: `${endStr}T23:59:59.999Z` };
    }
    case 'month': {
      if (!/^\d{4}-\d{2}$/.test(label)) return null;
      const [y, m] = label.split('-').map(Number);
      // Day 0 of next month = last day of this month.
      const lastDay = new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
      return { gte: label, lte: `${lastDay}T23:59:59.999Z` };
    }
    case 'quarter': {
      const m = /^(\d{4})-Q([1-4])$/.exec(label);
      if (!m) return null;
      const year = parseInt(m[1], 10);
      const q = parseInt(m[2], 10);
      const startMonth = (q - 1) * 3 + 1;
      const startStr = `${year}-${String(startMonth).padStart(2, '0')}`;
      const lastDay = new Date(Date.UTC(year, startMonth + 2, 0)).toISOString().slice(0, 10);
      return { gte: startStr, lte: `${lastDay}T23:59:59.999Z` };
    }
    case 'year': {
      if (!/^\d{4}$/.test(label)) return null;
      return { gte: label, lte: `${label}-12-31T23:59:59.999Z` };
    }
  }
}

// Filter nodes that, combined with the preset's filter tree under an AND,
// isolate the entities aggregated into a single chart data point. Used to
// power click-through from chart points to the entities list.
export function buildPointEntityFilters(label: string, config: VisualizationConfig): FilterNode[] {
  if (config.xAxis?.timeBucket) {
    const range = bucketRange(label, config.xAxis.timeBucket);
    if (!range) return [];
    return [
      makeLeaf(config.xAxis.metadataKey, 'gte', range.gte),
      makeLeaf(config.xAxis.metadataKey, 'lte', range.lte),
    ];
  }
  if (config.category) {
    return [makeLeaf(config.category.metadataKey, 'eq', label)];
  }
  return [];
}

// Filter nodes that, combined with the preset's filter tree under an AND,
// isolate the entities that were excluded from the chart because they were
// missing one or more required fields. Each required field becomes an IS NULL
// leaf (range op with empty value — see filterTreeEval/entityRepository for
// the semantics), OR'd together so any single missing field qualifies.
export function buildExcludedEntityFilters(config: VisualizationConfig): FilterNode[] {
  const keys = requiredFieldKeys(config);
  if (keys.length === 0) return [];
  const nullLeaves: FilterNode[] = keys.map(k => makeLeaf(k, 'gte', ''));
  if (nullLeaves.length === 1) return nullLeaves;
  return [{ type: 'group', id: 'excluded', op: 'OR', children: nullLeaves }];
}

// ── Unit conversion ───────────────────────────────────────────────────────────

const DURATION_TO_SECONDS: Record<DurationUnit, number> = {
  seconds: 1,
  minutes: 60,
  hours: 3600,
  days: 86400,
  weeks: 604800,
};

export function convertUnit(value: number, from: DurationUnit, to: DurationUnit): number {
  if (from === to) return value;
  return (value * DURATION_TO_SECONDS[from]) / DURATION_TO_SECONDS[to];
}

// ── Derived metrics ───────────────────────────────────────────────────────────

export function computeDerivedMetric(
  entity: EntityWithMetadata,
  config: DerivedMetricConfig
): number | null {
  if (config.type === 'sum') {
    let sum = 0;
    let sawValue = false;
    for (const key of config.metadataKeys) {
      const raw = entity.metadata.find(m => m.key === key)?.value;
      if (raw == null) continue; // missing field contributes 0
      const n = Number(raw);
      if (isNaN(n)) continue;
      sum += n;
      sawValue = true;
    }
    return sawValue ? sum : null; // all fields missing → exclude the entity
  }
  const startVal = entity.metadata.find(m => m.key === config.startMetadataKey)?.value;
  const endVal = entity.metadata.find(m => m.key === config.endMetadataKey)?.value;
  if (!startVal || !endVal) return null;
  const start = new Date(startVal);
  const end = new Date(endVal);
  if (isNaN(start.getTime()) || isNaN(end.getTime())) return null;
  return convertUnit((end.getTime() - start.getTime()) / 1000, 'seconds', config.unit);
}

// ── Validation ────────────────────────────────────────────────────────────────

const NUMERIC_AGGS: AggregationFunction[] = [
  'sum',
  'avg',
  'min',
  'max',
  'median',
  'p75',
  'p85',
  'p90',
  'p95',
  'p99',
];

function validateDimensions(config: VisualizationConfig): string[] {
  const { chartType, xAxis, category } = config;
  const errors: string[] = [];
  if (!xAxis && !category && !config.periods) {
    errors.push(
      'Visualization requires an x-axis (with time bucket), a category field, or periods.'
    );
  }
  if ((chartType === 'pie' || chartType === 'doughnut') && !category) {
    errors.push('Pie and doughnut charts require a category field.');
  }
  return errors;
}

function validateMeasure(config: VisualizationConfig): string[] {
  const { xAxis, aggregation } = config;
  const hasMeasure =
    !!config.yAxis ||
    !!config.derivedMetric ||
    !!config.series ||
    !!config.rolling ||
    !!config.periods;
  const timeBucket = !!xAxis && !!xAxis.timeBucket;
  const errors: string[] = [];
  if (timeBucket && xAxis!.type !== 'date') {
    errors.push('Time bucket requires a date x-axis field.');
  }
  if (NUMERIC_AGGS.includes(aggregation.function) && !hasMeasure) {
    errors.push(
      `Aggregation "${aggregation.function}" requires a numeric y-axis field, derived metric, or series.`
    );
  }
  if (timeBucket && aggregation.function !== 'count' && !hasMeasure) {
    errors.push(
      'Time-series chart with non-count aggregation requires a y-axis field, derived metric, or series.'
    );
  }
  return errors;
}

function validateDerivedMetric(dm: DerivedMetricConfig | undefined): string[] {
  if (!dm) return [];
  if (dm.type === 'duration' && (!dm.startMetadataKey || !dm.endMetadataKey)) {
    return ['Derived duration metric requires start and end metadata keys.'];
  }
  if (dm.type === 'sum' && dm.metadataKeys.length === 0) {
    return ['Combined (sum) metric requires at least one numeric field.'];
  }
  return [];
}

function validateSeries(config: VisualizationConfig): string[] {
  const { series, xAxis, aggregation } = config;
  if (!series) return [];
  const errors: string[] = [];
  if (!xAxis || !xAxis.timeBucket) {
    errors.push('Composition (series) requires a date x-axis with a time bucket.');
  }
  if (series.metadataKeys.length < 2) {
    errors.push('Composition (series) requires at least two numeric fields to stack.');
  }
  if (aggregation.function !== 'avg' && aggregation.function !== 'sum') {
    errors.push(
      'Composition (series) supports only avg or sum aggregation (medians do not stack).'
    );
  }
  return errors;
}

function validateTargets(config: VisualizationConfig): string[] {
  const { target, targets, yAxis, derivedMetric, series, rolling, periods, xAxis } = config;
  const all: TargetConfig[] = [...(target ? [target] : []), ...(targets ?? [])];
  const hasNumericMeasure = !!yAxis || !!derivedMetric || !!series || !!rolling || !!periods;
  const errors: string[] = [];
  for (const t of all) {
    if (t.type === 'horizontal_line' && !hasNumericMeasure) {
      errors.push('Horizontal target line requires a numeric measure.');
    }
    if (t.type === 'vertical_line' && !xAxis) {
      errors.push('Vertical target line requires an x-axis.');
    }
  }
  return errors;
}

function validateRolling(config: VisualizationConfig): string[] {
  const { rolling, xAxis } = config;
  if (!rolling) return [];
  const errors: string[] = [];
  if (!xAxis || xAxis.type !== 'date') {
    errors.push('Rolling trend requires a date x-axis field.');
  }
  if (rolling.metadataKeys.length === 0) {
    errors.push('Rolling trend requires at least one numeric field.');
  }
  return errors;
}

function validatePeriods(config: VisualizationConfig): string[] {
  const { periods } = config;
  if (!periods) return [];
  const errors: string[] = [];
  if (periods.windows.length === 0) errors.push('Compare periods requires at least one window.');
  if (periods.metadataKeys.length === 0) {
    errors.push('Compare periods requires at least one numeric field.');
  }
  if (!periods.dateField)
    errors.push('Compare periods requires a date field for window membership.');
  return errors;
}

export function validateVisualizationConfig(config: VisualizationConfig): string[] {
  return [
    ...validateDimensions(config),
    ...validateMeasure(config),
    ...validateDerivedMetric(config.derivedMetric),
    ...validateSeries(config),
    ...validateRolling(config),
    ...validatePeriods(config),
    ...validateTargets(config),
  ];
}

// ── Chart data builder helpers ────────────────────────────────────────────────

function extractGroupLabel(entity: EntityWithMetadata, config: VisualizationConfig): string | null {
  if (config.xAxis?.timeBucket) {
    const val = entity.metadata.find(m => m.key === config.xAxis!.metadataKey)?.value;
    return val ? bucketDate(val, config.xAxis.timeBucket) : null;
  }
  if (config.category) {
    return entity.metadata.find(m => m.key === config.category!.metadataKey)?.value ?? null;
  }
  return null;
}

function extractMetricValue(
  entity: EntityWithMetadata,
  config: VisualizationConfig
): number | null {
  if (config.aggregation.function === 'count') return 1;
  if (config.derivedMetric) return computeDerivedMetric(entity, config.derivedMetric);
  if (config.yAxis) {
    const raw = entity.metadata.find(m => m.key === config.yAxis!.metadataKey)?.value;
    if (raw == null) return null;
    const n = Number(raw);
    return isNaN(n) ? null : n;
  }
  return null;
}

// Second-valued measures are stored raw but rendered in config.displayUnit.
function toDisplay(value: number, config: VisualizationConfig): number {
  return config.displayUnit ? convertUnit(value, 'seconds', config.displayUnit) : value;
}

function applyDisplayConversion(value: number, config: VisualizationConfig): number {
  if (config.displayUnit) return convertUnit(value, 'seconds', config.displayUnit);
  if (config.derivedMetric?.type === 'duration' && config.yAxis?.displayUnit) {
    return convertUnit(value, config.derivedMetric.unit, config.yAxis.displayUnit);
  }
  if (config.yAxis?.unit && config.yAxis.displayUnit) {
    return convertUnit(value, config.yAxis.unit, config.yAxis.displayUnit);
  }
  return value;
}

function sortGroupLabels(groups: Map<string, number[]>, config: VisualizationConfig): string[] {
  if (config.xAxis?.timeBucket) {
    return Array.from(groups.keys()).sort((a, b) => a.localeCompare(b));
  }
  return sortCategoricalLabels(groups, config);
}

function sortCategoricalLabels(
  groups: Map<string, number[]>,
  config: VisualizationConfig
): string[] {
  const sortBy = config.category?.sortBy ?? 'value_desc';
  const fn = config.aggregation.function;
  const aggMap = new Map<string, number>();
  for (const [k, vals] of groups) aggMap.set(k, aggregate(vals, fn));
  const labels = Array.from(groups.keys());
  return labels.sort((a, b) => {
    switch (sortBy) {
      case 'label_asc':
        return a.localeCompare(b);
      case 'label_desc':
        return b.localeCompare(a);
      case 'value_asc':
        return (aggMap.get(a) ?? 0) - (aggMap.get(b) ?? 0);
      case 'value_desc':
        return (aggMap.get(b) ?? 0) - (aggMap.get(a) ?? 0);
    }
  });
}

function requiredFieldKeys(config: VisualizationConfig): string[] {
  const keys: string[] = [];
  if (config.xAxis?.timeBucket) keys.push(config.xAxis.metadataKey);
  if (config.category) keys.push(config.category.metadataKey);
  if (config.periods) {
    keys.push(config.periods.dateField);
  } else if (config.rolling && config.xAxis) {
    keys.push(config.xAxis.metadataKey);
  } else if (config.series) {
    // Series (composition) fields are 0-filled when missing, so only the
    // date-bucket field is genuinely required.
  } else if (config.derivedMetric) {
    if (config.derivedMetric.type === 'duration') {
      keys.push(config.derivedMetric.startMetadataKey, config.derivedMetric.endMetadataKey);
    } else {
      keys.push(...config.derivedMetric.metadataKeys);
    }
  } else if (config.yAxis && config.aggregation.function !== 'count') {
    keys.push(config.yAxis.metadataKey);
  }
  return Array.from(new Set(keys));
}

function buildExclusionWarning(count: number, config: VisualizationConfig): string {
  const keys = requiredFieldKeys(config);
  const noun = count === 1 ? 'entity was' : 'entities were';
  return `${count} ${noun} excluded because they were missing required fields: ${keys.join(', ')}.`;
}

// ── Chart data builder ────────────────────────────────────────────────────────

function collectMetricRows(
  entities: EntityWithMetadata[],
  config: VisualizationConfig
): { rows: Array<{ label: string; value: number }>; excludedCount: number } {
  const rows: Array<{ label: string; value: number }> = [];
  let excludedCount = 0;
  for (const entity of entities) {
    const label = extractGroupLabel(entity, config);
    const metricValue = extractMetricValue(entity, config);
    const missingMetric = config.aggregation.function !== 'count' && metricValue == null;
    if (label == null || missingMetric) {
      excludedCount++;
      continue;
    }
    rows.push({ label, value: applyDisplayConversion(metricValue!, config) });
  }
  return { rows, excludedCount };
}

function resolveMainLabel(config: VisualizationConfig): string {
  if (config.derivedMetric) return config.derivedMetric.name;
  if (config.yAxis) return config.yAxis.metadataKey;
  return config.aggregation.function === 'count' ? 'Count' : 'Value';
}

function collectTargetDatasets(config: VisualizationConfig, labels: string[]): ChartJsDataset[] {
  const all: TargetConfig[] = [
    ...(config.target ? [config.target] : []),
    ...(config.targets ?? []),
  ];
  return all.flatMap(t => buildTargetDatasets(t, labels));
}

export function buildChartData(
  entities: EntityWithMetadata[],
  config: VisualizationConfig,
  now: Date = new Date()
): ChartDataResult {
  if (config.series) return buildCompositionData(entities, config);
  if (config.rolling) return buildRollingTrendData(entities, config, now);
  if (config.periods) return buildPeriodComparisonData(entities, config, now);

  const { rows, excludedCount } = collectMetricRows(entities, config);
  const groups = new Map<string, number[]>();
  for (const { label, value } of rows) {
    if (!groups.has(label)) groups.set(label, []);
    groups.get(label)!.push(value);
  }

  const labels = sortGroupLabels(groups, config);
  const data = labels.map(l => aggregate(groups.get(l)!, config.aggregation.function));

  const datasets: ChartJsDataset[] = [{ label: resolveMainLabel(config), data }];
  datasets.push(...collectTargetDatasets(config, labels));

  const warnings: string[] = [];
  if (excludedCount > 0) warnings.push(buildExclusionWarning(excludedCount, config));

  return { labels, datasets, warnings, excludedEntityCount: excludedCount };
}

// Composition: one dataset per series field, each aggregated per time bucket, so
// the datasets stack. Missing field values are treated as 0 (a phase the item
// never entered contributes nothing). `percent` mode normalizes each bucket to
// 100% so the chart shows share-of-total rather than absolute magnitude.
function numOrZero(entity: EntityWithMetadata, key: string): number {
  const raw = entity.metadata.find(m => m.key === key)?.value;
  if (raw == null) return 0; // missing field contributes nothing to the stack
  const n = Number(raw);
  return isNaN(n) ? 0 : n;
}

function groupSeriesValues(
  entities: EntityWithMetadata[],
  keys: string[],
  dateKey: string,
  bucket: TimeBucket
): { groups: Map<string, Map<string, number[]>>; excludedCount: number } {
  const groups = new Map<string, Map<string, number[]>>();
  let excludedCount = 0;
  for (const entity of entities) {
    const dateVal = entity.metadata.find(m => m.key === dateKey)?.value;
    const label = dateVal ? bucketDate(dateVal, bucket) : null;
    if (label == null) {
      excludedCount++;
      continue;
    }
    if (!groups.has(label)) groups.set(label, new Map());
    const byKey = groups.get(label)!;
    for (const key of keys) {
      if (!byKey.has(key)) byKey.set(key, []);
      byKey.get(key)!.push(numOrZero(entity, key));
    }
  }
  return { groups, excludedCount };
}

function normalizePercent(perKeyData: number[][], labelCount: number): void {
  for (let li = 0; li < labelCount; li++) {
    let total = 0;
    for (let s = 0; s < perKeyData.length; s++) total += perKeyData[s][li];
    if (total <= 0) continue;
    for (let s = 0; s < perKeyData.length; s++)
      perKeyData[s][li] = (perKeyData[s][li] / total) * 100;
  }
}

function buildCompositionData(
  entities: EntityWithMetadata[],
  config: VisualizationConfig
): ChartDataResult {
  const series = config.series!;
  const xAxis = config.xAxis!;
  const fn = config.aggregation.function;
  const { groups, excludedCount } = groupSeriesValues(
    entities,
    series.metadataKeys,
    xAxis.metadataKey,
    xAxis.timeBucket!
  );

  const labels = Array.from(groups.keys()).sort((a, b) => a.localeCompare(b));
  const perKeyData = series.metadataKeys.map(key =>
    labels.map(l => aggregate(groups.get(l)!.get(key) ?? [], fn))
  );
  if (series.mode === 'percent') normalizePercent(perKeyData, labels.length);

  const datasets: ChartJsDataset[] = series.metadataKeys.map((key, i) => ({
    label: key,
    data: perKeyData[i],
  }));

  const warnings: string[] = [];
  if (excludedCount > 0) {
    const noun = excludedCount === 1 ? 'entity was' : 'entities were';
    warnings.push(
      `${excludedCount} ${noun} excluded because they were missing ${xAxis.metadataKey}.`
    );
  }

  return { labels, datasets, warnings, excludedEntityCount: excludedCount };
}

// Rolling trend: individual points (value = sum of the chosen fields) plus a
// trailing rolling aggregate line, both on a time x-axis.
function collectRollingPoints(
  entities: EntityWithMetadata[],
  dateKey: string,
  keys: string[]
): { points: Array<{ t: number; y: number }>; excludedCount: number } {
  const sumConfig: DerivedMetricConfig = { name: '', type: 'sum', metadataKeys: keys };
  const points: Array<{ t: number; y: number }> = [];
  let excludedCount = 0;
  for (const entity of entities) {
    const dateVal = entity.metadata.find(m => m.key === dateKey)?.value;
    const value = computeDerivedMetric(entity, sumConfig);
    const t = dateVal ? Date.parse(dateVal) : NaN;
    if (isNaN(t) || value == null) {
      excludedCount++;
      continue;
    }
    points.push({ t, y: value });
  }
  points.sort((a, b) => a.t - b.t);
  return { points, excludedCount };
}

// Trailing rolling aggregate. Points are pre-sorted by time, so a single
// forward-moving left pointer keeps the window in O(n) sweeps.
function rollingAggregateLine(
  points: Array<{ t: number; y: number }>,
  windowMs: number,
  agg: AggregationFunction
): XYPoint[] {
  let left = 0;
  return points.map((p, i) => {
    const lo = p.t - windowMs;
    while (points[left].t <= lo) left++;
    const vals: number[] = [];
    for (let j = left; j <= i; j++) vals.push(points[j].y);
    return { x: new Date(p.t).toISOString(), y: aggregate(vals, agg) };
  });
}

// Horizontal reference lines drawn as 2-point line datasets spanning the visible
// time extent (buildTargetDatasets is label-indexed, which doesn't fit a time axis).
function rollingTargetLines(config: VisualizationConfig, x0: string, x1: string): ChartJsDataset[] {
  const out: ChartJsDataset[] = [];
  for (const t of config.targets ?? []) {
    if (t.type !== 'horizontal_line') continue;
    out.push({
      label: t.label ?? 'Target',
      data: [
        { x: x0, y: t.value },
        { x: x1, y: t.value },
      ],
      type: 'line',
      showLine: true,
      pointRadius: 0,
      fill: false,
      tension: 0,
      borderColor: 'rgba(239, 68, 68, 0.85)',
      backgroundColor: 'transparent',
      borderDash: [6, 4],
    });
  }
  return out;
}

function buildRollingTrendData(
  entities: EntityWithMetadata[],
  config: VisualizationConfig,
  now: Date
): ChartDataResult {
  const rolling = config.rolling!;
  const dateKey = config.xAxis!.metadataKey;
  const raw = collectRollingPoints(entities, dateKey, rolling.metadataKeys);
  // Convert seconds → display unit once; median/etc. are linear so order is moot.
  const points = raw.points.map(p => ({ t: p.t, y: toDisplay(p.y, config) }));
  const fullLine = rollingAggregateLine(
    points,
    rolling.windowDays * 86_400_000,
    rolling.aggregation
  );

  // Focus on a trailing window if requested — slice AFTER computing the rolling
  // line so its left edge still reflects the full history.
  let startIdx = 0;
  if (rolling.trailingDays) {
    const cutoff = now.getTime() - rolling.trailingDays * 86_400_000;
    const found = points.findIndex(p => p.t >= cutoff);
    startIdx = found < 0 ? points.length : found;
  }
  const visPoints = points.slice(startIdx);
  const visLine = fullLine.slice(startIdx);

  const datasets: ChartJsDataset[] = [];
  if (rolling.showPoints) {
    datasets.push({
      label: 'Items',
      data: visPoints.map(p => ({ x: new Date(p.t).toISOString(), y: p.y })),
      type: 'scatter',
      showLine: false,
      pointRadius: 3,
      backgroundColor: 'rgba(59, 130, 246, 0.35)',
      borderColor: 'rgba(59, 130, 246, 0.5)',
    });
  }
  datasets.push({
    label: `${rolling.windowDays}-day ${rolling.aggregation}`,
    data: visLine,
    type: 'line',
    showLine: true,
    pointRadius: 0,
    fill: false,
    tension: 0.2,
    borderColor: 'rgba(37, 99, 235, 1)',
    backgroundColor: 'transparent',
  });
  if (visPoints.length > 0) {
    const x0 = new Date(visPoints[0].t).toISOString();
    const x1 = new Date(visPoints[visPoints.length - 1].t).toISOString();
    datasets.push(...rollingTargetLines(config, x0, x1));
  }

  const warnings: string[] = [];
  if (raw.excludedCount > 0) {
    const noun = raw.excludedCount === 1 ? 'entity was' : 'entities were';
    warnings.push(
      `${raw.excludedCount} ${noun} excluded because they were missing a date or value.`
    );
  }
  return { labels: [], datasets, warnings, excludedEntityCount: raw.excludedCount };
}

// Compare periods: aggregate a measure across named relative windows. Each
// window becomes an x-axis category. `combine` sums the fields per entity into
// one bar per window; otherwise each field is its own grouped-bar series.
function entitiesInWindow(
  entities: EntityWithMetadata[],
  dateField: string,
  win: { start: Date | null; end: Date | null }
): EntityWithMetadata[] {
  return entities.filter(e => {
    const d = e.metadata.find(m => m.key === dateField)?.value;
    return d != null && inWindow(d, win);
  });
}

// Resolve each window and bucket its entities. If every weekday window (Mon–Fri)
// is empty this week, step the whole weekday group back one week so the daily
// bars show the most recent week that has data.
function resolveWindowsWithEntities(
  windows: NamedWindow[],
  entities: EntityWithMetadata[],
  dateField: string,
  now: Date
): { resolved: ResolvedWindow[]; perWindow: EntityWithMetadata[][] } {
  const resolved = windows.map(w => resolveNamedWindow(w, now));
  const perWindow = resolved.map(r => entitiesInWindow(entities, dateField, r));
  const weekdayIdx = windows.map((w, i) => (WEEKDAY_WINDOWS.has(w) ? i : -1)).filter(i => i >= 0);
  const allWeekdaysEmpty =
    weekdayIdx.length > 0 && weekdayIdx.every(i => perWindow[i].length === 0);
  if (allWeekdaysEmpty) {
    const priorWeek = new Date(now.getTime() - 7 * 86_400_000);
    for (const i of weekdayIdx) {
      resolved[i] = resolveNamedWindow(windows[i], priorWeek);
      perWindow[i] = entitiesInWindow(entities, dateField, resolved[i]);
    }
  }
  return { resolved, perWindow };
}

function buildPeriodComparisonData(
  entities: EntityWithMetadata[],
  config: VisualizationConfig,
  now: Date
): ChartDataResult {
  const periods = config.periods!;
  const fn = config.aggregation.function;
  const { resolved, perWindow } = resolveWindowsWithEntities(
    periods.windows,
    entities,
    periods.dateField,
    now
  );
  const labels = resolved.map(r => r.label);

  let datasets: ChartJsDataset[];
  if (periods.combine) {
    const sumConfig: DerivedMetricConfig = {
      name: 'Combined metric',
      type: 'sum',
      metadataKeys: periods.metadataKeys,
    };
    const data = perWindow.map(list => {
      const vals = list
        .map(e => computeDerivedMetric(e, sumConfig))
        .filter((v): v is number => v != null);
      return toDisplay(aggregate(vals, fn), config);
    });
    datasets = [{ label: 'Combined metric', data }];
  } else {
    datasets = periods.metadataKeys.map(key => ({
      label: key,
      data: perWindow.map(list =>
        toDisplay(
          aggregate(
            list.map(e => numOrZero(e, key)),
            fn
          ),
          config
        )
      ),
    }));
  }

  return { labels, datasets, warnings: [], excludedEntityCount: 0 };
}

function buildTargetDatasets(target: TargetConfig, labels: string[]): ChartJsDataset[] {
  if (target.type === 'horizontal_line') {
    return [
      {
        label: target.label ?? 'Target',
        data: labels.map(() => target.value),
        borderColor: 'rgba(239, 68, 68, 0.8)',
        backgroundColor: 'transparent',
        borderDash: [6, 4],
        pointRadius: 0,
        fill: false,
        tension: 0,
        type: 'line',
        order: 0,
      },
    ];
  }
  if (target.type === 'band') {
    return buildBandDatasets(target.min, target.max, target.label ?? 'Band', labels);
  }
  return [];
}

function buildBandDatasets(
  min: number,
  max: number,
  label: string,
  labels: string[]
): ChartJsDataset[] {
  const common = {
    borderColor: 'rgba(34, 197, 94, 0.5)',
    backgroundColor: 'rgba(34, 197, 94, 0.1)',
    borderDash: [4, 4] as number[],
    pointRadius: 0,
    type: 'line',
    order: 0,
  };
  return [
    { ...common, label: `${label} (min)`, data: labels.map(() => min), fill: '+1' },
    { ...common, label: `${label} (max)`, data: labels.map(() => max), fill: false },
  ];
}

// ── Chart.js config builder ───────────────────────────────────────────────────

const CHART_COLORS = [
  'rgba(59, 130, 246, 0.8)',
  'rgba(16, 185, 129, 0.8)',
  'rgba(245, 158, 11, 0.8)',
  'rgba(239, 68, 68, 0.8)',
  'rgba(139, 92, 246, 0.8)',
  'rgba(236, 72, 153, 0.8)',
  'rgba(14, 165, 233, 0.8)',
  'rgba(234, 179, 8, 0.8)',
];

function styleMainDataset(
  ds: ChartJsDataset,
  chartType: ChartType,
  labelCount: number
): ChartJsDataset {
  if (chartType === 'line') {
    return {
      ...ds,
      borderColor: 'rgba(59, 130, 246, 0.9)',
      backgroundColor: 'rgba(59, 130, 246, 0.1)',
      tension: 0.2,
      fill: false,
      pointRadius: 3,
    };
  }
  if (chartType === 'bar') {
    return {
      ...ds,
      backgroundColor: 'rgba(59, 130, 246, 0.7)',
      borderColor: 'rgba(59, 130, 246, 1)',
    };
  }
  if (chartType === 'pie' || chartType === 'doughnut') {
    const colors = Array.from(
      { length: labelCount },
      (_, i) => CHART_COLORS[i % CHART_COLORS.length]
    );
    return { ...ds, backgroundColor: colors };
  }
  return ds;
}

function buildChartPlugins(
  config: VisualizationConfig,
  datasetCount: number,
  isCircular: boolean
): Record<string, unknown> {
  const plugins: Record<string, unknown> = {
    legend: { display: datasetCount > 1 || isCircular },
    tooltip: { enabled: true },
  };
  if (config.target?.type === 'vertical_line') {
    plugins.title = {
      display: true,
      text: `${config.target.label ?? 'Event'}: ${config.target.value}`,
      position: 'bottom',
      font: { size: 11 },
      color: '#6b7280',
    };
  }
  return plugins;
}

function resolveDisplayUnit(config: VisualizationConfig): DurationUnit | undefined {
  const derivedUnit =
    config.derivedMetric?.type === 'duration' ? config.derivedMetric.unit : undefined;
  return config.displayUnit ?? config.yAxis?.displayUnit ?? derivedUnit;
}

function resolveYAxisLabel(config: VisualizationConfig, mainLabel: string): string {
  if (config.series?.mode === 'percent') return 'Share (%)';
  if (config.series) return '';
  const unit = resolveDisplayUnit(config);
  if (config.rolling) return unit ?? mainLabel; // point cloud: unit alone reads cleaner
  return unit ? `${mainLabel} (${unit})` : mainLabel;
}

function buildScales(
  config: VisualizationConfig,
  xAxisLabel: string,
  yAxisLabel: string
): Record<string, unknown> {
  const stacked = !!config.series;
  const isPercent = config.series?.mode === 'percent';
  const x = config.rolling
    ? { type: 'time', title: { display: !!xAxisLabel, text: xAxisLabel } }
    : { title: { display: !!xAxisLabel, text: xAxisLabel }, stacked };
  return {
    x,
    y: {
      title: { display: !!yAxisLabel, text: yAxisLabel },
      beginAtZero: stacked,
      stacked,
      ...(isPercent ? { max: 100 } : {}),
    },
  };
}

function buildChartOptions(
  result: ChartDataResult,
  config: VisualizationConfig,
  isCircular: boolean
): Record<string, unknown> {
  const mainLabel = result.datasets[0]?.label ?? '';
  const yAxisLabel = resolveYAxisLabel(config, mainLabel);
  const xAxisLabel = config.xAxis?.metadataKey ?? config.category?.metadataKey ?? '';
  const plugins = buildChartPlugins(config, result.datasets.length, isCircular);
  const scalesConfig = isCircular ? undefined : buildScales(config, xAxisLabel, yAxisLabel);
  return {
    responsive: true,
    maintainAspectRatio: true,
    plugins,
    ...(scalesConfig ? { scales: scalesConfig } : {}),
    ...(config.chartOptions ?? {}),
  };
}

function styleSeriesDataset(ds: ChartJsDataset, chartType: ChartType, i: number): ChartJsDataset {
  const color = CHART_COLORS[i % CHART_COLORS.length];
  if (chartType === 'line') {
    return {
      ...ds,
      borderColor: color,
      backgroundColor: color,
      fill: true,
      tension: 0.2,
      pointRadius: 2,
    };
  }
  return { ...ds, backgroundColor: color, borderColor: color };
}

export function buildChartJsConfig(
  result: ChartDataResult,
  config: VisualizationConfig
): ChartJsConfig {
  const { chartType } = config;
  const isCircular = chartType === 'pie' || chartType === 'doughnut';
  let styledDatasets: ChartJsDataset[];
  if (config.rolling) {
    styledDatasets = result.datasets; // already styled by the rolling builder
  } else if (config.series || config.periods) {
    styledDatasets = result.datasets.map((ds, i) => styleSeriesDataset(ds, chartType, i));
  } else {
    styledDatasets = result.datasets.map((ds, i) =>
      i === 0 ? styleMainDataset(ds, chartType, result.labels.length) : ds
    );
  }
  const options = buildChartOptions(result, config, isCircular);
  return { type: chartType, data: { labels: result.labels, datasets: styledDatasets }, options };
}
