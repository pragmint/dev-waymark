import type { EntityWithMetadata } from '../schemas/entity';
import { makeLeaf } from '../schemas/filterTree';
import type { FilterNode } from '../schemas/filterTree';
import type {
  VisualizationConfig,
  AggregationFunction,
  TimeBucket,
  DurationUnit,
  DerivedMetricConfig,
  TargetConfig,
  SmoothingConfig,
  ChartType,
} from '../schemas/visualization';
import type { Waymark } from '../schemas/waymark';
import { computedRangeOverlaps } from './dateRange';
import type { ComputedDateRange } from './dateRange';

// ── Output types ──────────────────────────────────────────────────────────────

export type ChartJsDataset = {
  label: string;
  data: (number | null)[];
  borderColor?: string;
  backgroundColor?: string | string[];
  fill?: boolean | string;
  tension?: number;
  borderDash?: number[];
  pointRadius?: number | number[];
  type?: string;
  order?: number;
  spanGaps?: boolean;
};

export type ChartDataResult = {
  labels: string[];
  datasets: ChartJsDataset[];
  warnings: string[];
  excludedEntityCount: number;
  // Index into `datasets` of the smoothing line, or null when smoothing is off.
  smoothingDatasetIndex: number | null;
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

// ── Waymark bucket math ───────────────────────────────────────────────────────

// Integer "bucket-steps since epoch" for a bucket label — adjacent buckets are
// always exactly 1 apart. Lets a waymark's start/end date be placed and
// interpolated by bucket position even when its own bucket has no entry in
// the current `labels` array (sparse data, or a future bucket with no
// entities yet) — something plain array-index interpolation can't do.
function bucketOrdinal(label: string, bucket: TimeBucket): number | null {
  switch (bucket) {
    case 'year': {
      const m = /^(\d{4})$/.exec(label);
      return m ? parseInt(m[1], 10) : null;
    }
    case 'quarter': {
      const m = /^(\d{4})-Q([1-4])$/.exec(label);
      return m ? parseInt(m[1], 10) * 4 + (parseInt(m[2], 10) - 1) : null;
    }
    case 'month': {
      const m = /^(\d{4})-(\d{2})$/.exec(label);
      return m ? parseInt(m[1], 10) * 12 + (parseInt(m[2], 10) - 1) : null;
    }
    case 'week': {
      const m = /^Week of (\d{4}-\d{2}-\d{2})$/.exec(label);
      const ms = m ? Date.parse(`${m[1]}T00:00:00Z`) : NaN;
      return isNaN(ms) ? null : Math.round(ms / (7 * 86_400_000));
    }
    case 'day': {
      const ms = Date.parse(`${label}T00:00:00Z`);
      return isNaN(ms) ? null : Math.round(ms / 86_400_000);
    }
  }
}

// The label immediately following `label`, one bucket-step later.
function nextBucketLabel(label: string, bucket: TimeBucket): string | null {
  const range = bucketRange(label, bucket);
  if (!range) return null;
  const rollover = new Date(new Date(range.lte).getTime() + 1);
  return bucketDate(rollover.toISOString(), bucket);
}

const MAX_SYNTHETIC_LABELS = 1000;

// Given a bounded computed date range (week/month/quarter/year/custom — never
// 'all', which has no fixed start/end), returns every bucket label from the
// range's start through its end, inclusive — so a chart's x-axis reflects the
// full period even when real data only covers part of it (e.g. a month view
// with entities only through the 7th still shows the whole month). Returns
// null when the range is unbounded on either side, since there is no fixed
// span to fill.
export function fillRangeGapLabels(
  bucket: TimeBucket,
  computedRange: ComputedDateRange
): string[] | null {
  if (!computedRange.start || !computedRange.end) return null;
  const startLabel = bucketDate(computedRange.start.toISOString(), bucket);
  const endLabel = bucketDate(computedRange.end.toISOString(), bucket);
  if (!startLabel || !endLabel || endLabel < startLabel) return null;

  const labels: string[] = [startLabel];
  let cursor = startLabel;
  while (cursor < endLabel && labels.length < MAX_SYNTHETIC_LABELS) {
    const next = nextBucketLabel(cursor, bucket);
    if (!next) break;
    labels.push(next);
    cursor = next;
  }
  return labels;
}

// Aggregations where an empty bucket genuinely means zero (no entities to
// count/sum) rather than an undefined value — used to decide whether a
// gap-filled bucket gets 0 or null (a rendered gap) in the main series.
const ZERO_FILLABLE_AGGREGATIONS: AggregationFunction[] = ['count', 'sum'];

// Waymarks are stored per-visualization with no inherent tie to the currently
// viewed date range, so a goal line whose [startDate, endDate] doesn't
// intersect the dashboard's current window must be excluded entirely — the
// caller should not fetch, extend labels for, or render it on this render.
export function filterWaymarksInRange(
  waymarks: Waymark[],
  computedRange: ComputedDateRange
): Waymark[] {
  return waymarks.filter(w => computedRangeOverlaps(w.startDate, w.endDate, computedRange));
}

// Appends synthetic future bucket labels after the last real label, up to the
// furthest waymark end date, so a goal line can extend past the last bucket
// that actually has entities — but never past the currently selected date
// range. A waymark's [startDate, endDate] has no inherent tie to the
// dashboard's current window (e.g. a goal set for the whole quarter while
// viewing a single week within it), so without a cap the chart would grow
// wider than the range the user actually picked. When `computedRange.end` is
// set (every bounded period — week/month/quarter/year/custom), `labels` is
// already gap-filled out to that boundary (see `fillRangeGapLabels`), so
// capping at it is normally a no-op; it only does real work for a custom
// range with an end but no start, where gap-fill doesn't run and real labels
// can fall short of the boundary. Only unbounded ranges (`computedRange.end`
// null — "all time", or custom with no end) let the tail extend all the way
// to the waymark's own end date. Only ever extends the tail — never inserts
// mid-array — so existing index-based logic elsewhere (click-through
// filters, smoothing window filters) keeps working unmodified against the
// labels it already knows about. `realLabelCount` tells the caller where the
// synthetic tail starts, so it can skip click-through URLs for those
// indices.
export function extendLabelsForWaymarks(
  labels: string[],
  bucket: TimeBucket,
  waymarks: Waymark[],
  computedRange: ComputedDateRange
): { labels: string[]; realLabelCount: number } {
  const realLabelCount = labels.length;
  if (labels.length === 0 || waymarks.length === 0) return { labels, realLabelCount };

  const rangeEndLabel = computedRange.end
    ? bucketDate(computedRange.end.toISOString(), bucket)
    : null;

  let maxEndLabel = waymarks
    .map(w => bucketDate(w.endDate, bucket))
    .filter((l): l is string => l != null)
    .sort((a, b) => a.localeCompare(b))
    .pop();
  if (rangeEndLabel && (!maxEndLabel || rangeEndLabel < maxEndLabel)) maxEndLabel = rangeEndLabel;

  const lastReal = labels[labels.length - 1];
  if (!maxEndLabel || maxEndLabel <= lastReal) return { labels, realLabelCount };

  const extended = [...labels];
  let cursor = lastReal;
  while (
    extended[extended.length - 1] < maxEndLabel &&
    extended.length - realLabelCount < MAX_SYNTHETIC_LABELS
  ) {
    const next = nextBucketLabel(cursor, bucket);
    if (!next) break;
    extended.push(next);
    cursor = next;
  }
  return { labels: extended, realLabelCount };
}

// Pads every dataset's `data` with `null` up to `length`, in place, after the
// label axis has been extended with a synthetic future tail. Chart.js treats
// `null` as a gap on a category-scale line dataset (default `spanGaps: false`).
export function padDatasetsToLength(datasets: ChartJsDataset[], length: number): void {
  for (const ds of datasets) {
    if (ds.data.length >= length) continue;
    ds.data = [...ds.data, ...Array(length - ds.data.length).fill(null)];
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

// Filter nodes isolating every entity across the trailing window of buckets
// that feeds a single smoothing-line point (labels[startIdx..pointIndex]
// inclusive). Powers click-through from a rolling-average point to the
// entities behind it, mirroring buildPointEntityFilters but spanning
// multiple buckets instead of just one.
export function buildSmoothingWindowEntityFilters(
  labels: string[],
  pointIndex: number,
  windowSize: number,
  config: VisualizationConfig
): FilterNode[] {
  if (!config.xAxis?.timeBucket) return [];
  const startIdx = Math.max(0, pointIndex - windowSize + 1);
  const startRange = bucketRange(labels[startIdx], config.xAxis.timeBucket);
  const endRange = bucketRange(labels[pointIndex], config.xAxis.timeBucket);
  if (!startRange || !endRange) return [];
  return [
    makeLeaf(config.xAxis.metadataKey, 'gte', startRange.gte),
    makeLeaf(config.xAxis.metadataKey, 'lte', endRange.lte),
  ];
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
  if (config.type === 'duration') {
    const startVal = entity.metadata.find(m => m.key === config.startMetadataKey)?.value;
    const endVal = entity.metadata.find(m => m.key === config.endMetadataKey)?.value;
    if (!startVal || !endVal) return null;
    const start = new Date(startVal);
    const end = new Date(endVal);
    if (isNaN(start.getTime()) || isNaN(end.getTime())) return null;
    return convertUnit((end.getTime() - start.getTime()) / 1000, 'seconds', config.unit);
  }

  const values: number[] = [];
  for (const key of config.metadataKeys) {
    const raw = entity.metadata.find(m => m.key === key)?.value;
    if (raw == null) return null;
    const n = Number(raw);
    if (isNaN(n)) return null;
    values.push(n);
  }
  return values.reduce((a, b) => a + b, 0);
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

function validateTargetAndSmoothing(config: VisualizationConfig): string[] {
  const { xAxis, yAxis, derivedMetric, target, smoothing } = config;
  const errors: string[] = [];
  if (target?.type === 'horizontal_line' && !yAxis && !derivedMetric) {
    errors.push('Horizontal target line requires a numeric y-axis or derived metric.');
  }
  if (target?.type === 'vertical_line' && !xAxis) {
    errors.push('Vertical target line requires an x-axis.');
  }
  if (smoothing && !xAxis?.timeBucket) {
    errors.push('Rolling average smoothing requires a time-bucketed x-axis.');
  }
  return errors;
}

export function validateVisualizationConfig(config: VisualizationConfig): string[] {
  const errors: string[] = [];
  const { chartType, xAxis, yAxis, category, aggregation, derivedMetric } = config;

  if (!xAxis && !category) {
    errors.push('Visualization requires either an x-axis (with time bucket) or a category field.');
  }
  if (xAxis?.timeBucket && xAxis.type !== 'date') {
    errors.push('Time bucket requires a date x-axis field.');
  }
  if (NUMERIC_AGGS.includes(aggregation.function) && !yAxis && !derivedMetric) {
    errors.push(
      `Aggregation "${aggregation.function}" requires a numeric y-axis field or derived metric.`
    );
  }
  if (xAxis?.timeBucket && aggregation.function !== 'count' && !yAxis && !derivedMetric) {
    errors.push(
      'Time-series chart with non-count aggregation requires a y-axis field or derived metric.'
    );
  }
  if ((chartType === 'pie' || chartType === 'doughnut') && !category) {
    errors.push('Pie and doughnut charts require a category field.');
  }
  if (
    derivedMetric?.type === 'duration' &&
    (!derivedMetric.startMetadataKey || !derivedMetric.endMetadataKey)
  ) {
    errors.push('Derived duration metric requires start and end metadata keys.');
  }
  if (derivedMetric?.type === 'sum' && derivedMetric.metadataKeys.length === 0) {
    errors.push('Derived sum metric requires at least one metadata key.');
  }
  errors.push(...validateTargetAndSmoothing(config));
  return errors;
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

function applyDisplayConversion(value: number, config: VisualizationConfig): number {
  if (config.derivedMetric?.type === 'duration' && config.yAxis?.displayUnit) {
    return convertUnit(value, config.derivedMetric.unit, config.yAxis.displayUnit);
  }
  if (config.yAxis?.unit && config.yAxis.displayUnit) {
    return convertUnit(value, config.yAxis.unit, config.yAxis.displayUnit);
  }
  return value;
}

// General-purpose per-measure transform (see MeasureTransformSchema) — applied on
// top of any duration/display-unit conversion above, so it composes with both a
// derived duration metric and a plain numeric field.
function applyMeasureTransform(value: number, config: VisualizationConfig): number {
  return config.measureTransform ? value / config.measureTransform.divisor : value;
}

function transformMeasureValue(value: number, config: VisualizationConfig): number {
  return applyMeasureTransform(applyDisplayConversion(value, config), config);
}

// The unit text shown on the y-axis title and in tooltips. An explicit
// measureTransform label takes priority over the duration-only unit/displayUnit
// mechanism, since it's the more general, user-authored mechanism.
function resolveUnitLabel(config: VisualizationConfig): string | undefined {
  if (config.measureTransform) return config.measureTransform.unitLabel;
  if (config.yAxis?.displayUnit) return config.yAxis.displayUnit;
  if (config.derivedMetric?.type === 'duration') return config.derivedMetric.unit;
  return undefined;
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
  if (config.derivedMetric?.type === 'duration') {
    keys.push(config.derivedMetric.startMetadataKey, config.derivedMetric.endMetadataKey);
  } else if (config.derivedMetric?.type === 'sum') {
    keys.push(...config.derivedMetric.metadataKeys);
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

function computeMainSeries(
  entities: EntityWithMetadata[],
  config: VisualizationConfig,
  computedRange?: ComputedDateRange
): { labels: string[]; data: (number | null)[]; excludedCount: number } {
  let excludedCount = 0;
  const rows: Array<{ label: string; value: number }> = [];

  for (const entity of entities) {
    const label = extractGroupLabel(entity, config);
    const metricValue = extractMetricValue(entity, config);

    const missingMetric = config.aggregation.function !== 'count' && metricValue == null;
    if (label == null || missingMetric) {
      excludedCount++;
      continue;
    }

    rows.push({ label, value: transformMeasureValue(metricValue!, config) });
  }

  const groups = new Map<string, number[]>();
  for (const { label, value } of rows) {
    if (!groups.has(label)) groups.set(label, []);
    groups.get(label)!.push(value);
  }

  if (config.xAxis?.timeBucket && computedRange) {
    const rangeLabels = fillRangeGapLabels(config.xAxis.timeBucket, computedRange);
    if (rangeLabels) {
      for (const l of rangeLabels) if (!groups.has(l)) groups.set(l, []);
    }
  }

  const labels = sortGroupLabels(groups, config);
  const data = labels.map(l => {
    const values = groups.get(l)!;
    if (values.length === 0 && !ZERO_FILLABLE_AGGREGATIONS.includes(config.aggregation.function)) {
      return null;
    }
    return aggregate(values, config.aggregation.function);
  });
  return { labels, data, excludedCount };
}

function resolveMainLabel(config: VisualizationConfig): string {
  return (
    config.derivedMetric?.name ??
    config.yAxis?.metadataKey ??
    (config.aggregation.function === 'count' ? 'Count' : 'Value')
  );
}

export function buildChartData(
  entities: EntityWithMetadata[],
  config: VisualizationConfig,
  computedRange?: ComputedDateRange
): ChartDataResult {
  const warnings: string[] = [];
  const { labels, data, excludedCount } = computeMainSeries(entities, config, computedRange);
  const mainLabel = resolveMainLabel(config);

  const datasets = buildDatasets(mainLabel, data, labels, config);
  const smoothingDatasetIndex = config.smoothing ? datasets.length - 1 : null;
  if (excludedCount > 0) warnings.push(buildExclusionWarning(excludedCount, config));

  return { labels, datasets, warnings, excludedEntityCount: excludedCount, smoothingDatasetIndex };
}

// Computes the smoothing line using entities from a lookback-widened window
// (e.g. extending before the dashboard's active date-range filter), then
// narrows the result to just `visibleLabels`. This makes the rolling average
// a TRUE rolling average — the first few visible points still average over a
// full window of history — instead of one clipped to fewer than `windowSize`
// points because history before the visible range was filtered out.
export function buildLookbackSmoothingDataset(
  visibleLabels: string[],
  lookbackEntities: EntityWithMetadata[],
  mainLabel: string,
  config: VisualizationConfig
): { dataset: ChartJsDataset; extendedLabels: string[] } | null {
  if (!config.smoothing) return null;
  const { labels: extendedLabels, data: extendedData } = computeMainSeries(
    lookbackEntities,
    config
  );
  const smoothed = computeRollingAverage(extendedData, config.smoothing.windowSize);
  const valueByLabel = new Map(extendedLabels.map((label, i) => [label, smoothed[i]]));
  return {
    dataset: {
      ...smoothingDatasetStyle(mainLabel, config.smoothing.windowSize),
      data: visibleLabels.map(label => valueByLabel.get(label) ?? null),
    },
    extendedLabels,
  };
}

function buildDatasets(
  mainLabel: string,
  data: (number | null)[],
  labels: string[],
  config: VisualizationConfig
): ChartJsDataset[] {
  const datasets: ChartJsDataset[] = [{ label: mainLabel, data }];
  if (config.target) datasets.push(...buildTargetDatasets(config.target, labels));
  if (config.smoothing) datasets.push(buildSmoothingDataset(config.smoothing, mainLabel, data));
  return datasets;
}

// Target/goal values are authored directly by the user in the chart's displayed
// unit (e.g. "5" meaning 5 days once a measureTransform/displayUnit is showing
// days) — unlike entity-derived measure values, they never carry a raw storage
// unit, so no conversion is applied here.
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

// Trailing rolling average over `data`. Early points average over however
// many prior points exist rather than being dropped, so the smoothing line
// always spans the full input — callers that need a TRUE average for the
// first few visible points (see buildLookbackSmoothingDataset) pass in data
// extended with history from before the visible range instead of relying on
// this clamping. Gap-filled buckets (null) are excluded from the window
// rather than treated as zero, so a period with no data doesn't drag the
// average down; a window with no real values yields null.
function computeRollingAverage(data: (number | null)[], windowSize: number): (number | null)[] {
  return data.map((_, i) => {
    const window = data
      .slice(Math.max(0, i - windowSize + 1), i + 1)
      .filter((v): v is number => v != null);
    if (window.length === 0) return null;
    return window.reduce((a, b) => a + b, 0) / window.length;
  });
}

function smoothingDatasetStyle(
  mainLabel: string,
  windowSize: number
): Omit<ChartJsDataset, 'data'> {
  return {
    label: `${mainLabel} (${windowSize}-point avg)`,
    borderColor: 'rgba(245, 158, 11, 0.9)',
    backgroundColor: 'transparent',
    pointRadius: 3,
    fill: false,
    tension: 0.2,
    type: 'line',
    // A gap-filled bucket with no data is null, not a real value — draw the
    // line straight through it to the next real point instead of breaking,
    // so a sparse time series still reads as one continuous trend line.
    spanGaps: true,
  };
}

function buildSmoothingDataset(
  smoothing: SmoothingConfig,
  mainLabel: string,
  data: (number | null)[]
): ChartJsDataset {
  return {
    ...smoothingDatasetStyle(mainLabel, smoothing.windowSize),
    data: computeRollingAverage(data, smoothing.windowSize),
  };
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

// ── Waymarks ──────────────────────────────────────────────────────────────────

// Resolves each waymark's start-anchor value — the actual value of the line it
// tracks (main or smoothing) at its start date — from full, unfiltered
// history. Computed once and shared across every waymark on the card,
// regardless of how many there are. A waymark's own start-date bucket may
// have zero entities (sparse data), so this binary-searches for the nearest
// real bucket at-or-before the start date rather than requiring an exact
// match. Returns null for a waymark with no history at or before its start —
// callers should drop that waymark rather than fabricate a value.
export function resolveWaymarkAnchors(
  waymarks: Waymark[],
  fullHistoryEntities: EntityWithMetadata[],
  config: VisualizationConfig
): Map<number, number | null> {
  const bucket = config.xAxis?.timeBucket;
  const result = new Map<number, number | null>();
  if (!bucket) {
    for (const w of waymarks) result.set(w.id, null);
    return result;
  }

  const { labels: fullLabels, data: fullData } = computeMainSeries(fullHistoryEntities, config);
  const needsSmoothing = !!config.smoothing && waymarks.some(w => w.appliesTo === 'smoothing');
  const smoothedData = needsSmoothing
    ? computeRollingAverage(fullData, config.smoothing!.windowSize)
    : null;

  const valueAtOrBefore = (series: (number | null)[], targetLabel: string): number | null => {
    let lo = 0;
    let hi = fullLabels.length - 1;
    let ans = -1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (fullLabels[mid] <= targetLabel) {
        ans = mid;
        lo = mid + 1;
      } else {
        hi = mid - 1;
      }
    }
    return ans === -1 ? null : series[ans];
  };

  for (const w of waymarks) {
    const startLabel = bucketDate(w.startDate, bucket);
    if (!startLabel) {
      result.set(w.id, null);
      continue;
    }
    // Falls back to the main series if this waymark tracks smoothing but the
    // viz has no smoothing configured (e.g. it was removed after the waymark
    // was created).
    const series = w.appliesTo === 'smoothing' && smoothedData ? smoothedData : fullData;
    result.set(w.id, valueAtOrBefore(series, startLabel));
  }
  return result;
}

// ── Boundary anchoring ────────────────────────────────────────────────────────

export type BoundaryAnchorEdges = { leading: boolean; trailing: boolean };

export type BoundaryAnchorInfo = {
  main: BoundaryAnchorEdges;
  smoothing: BoundaryAnchorEdges | null;
};

type LabeledValue = { label: string; value: number };

function nearestBefore(
  labels: string[],
  data: (number | null)[],
  targetLabel: string
): LabeledValue | null {
  for (let i = labels.length - 1; i >= 0; i--) {
    if (labels[i] < targetLabel && data[i] != null) return { label: labels[i], value: data[i]! };
  }
  return null;
}

function nearestAfter(
  labels: string[],
  data: (number | null)[],
  targetLabel: string
): LabeledValue | null {
  for (let i = 0; i < labels.length; i++) {
    if (labels[i] > targetLabel && data[i] != null) return { label: labels[i], value: data[i]! };
  }
  return null;
}

// The value a straight line from (a.label, a.value) to (b.label, b.value)
// would have at `atLabel`, positioned by true bucket-ordinal distance (not
// array index) — so a value that's actually several buckets away from the
// edge produces a gentle partial slope at the edge, rather than the full
// swing between the two values landing entirely within one visible bucket
// (which would misrepresent a multi-day transition as happening overnight).
function interpolateAtLabel(
  a: LabeledValue,
  b: LabeledValue,
  atLabel: string,
  bucket: TimeBucket
): number | null {
  const aOrd = bucketOrdinal(a.label, bucket);
  const bOrd = bucketOrdinal(b.label, bucket);
  const atOrd = bucketOrdinal(atLabel, bucket);
  if (aOrd == null || bOrd == null || atOrd == null || bOrd === aOrd) return null;
  const t = (atOrd - aOrd) / (bOrd - aOrd);
  return a.value + t * (b.value - a.value);
}

// Fills a series' leading/trailing edge (if it has no data of its own) with
// the value a straight line to the nearest real point outside the window
// would have there — so the line reaches all the way to the edge of the
// chart, sloped at the true pace of the transition, instead of dangling or
// assuming the outside data point sits right at the edge. Only ever touches
// index 0 and the last index — gaps in between are left alone, since
// spanGaps already draws one straight line across them.
function anchorSeriesEdges(
  labels: string[],
  data: (number | null)[],
  fullLabels: string[],
  fullData: (number | null)[],
  computedRange: ComputedDateRange,
  bucket: TimeBucket
): BoundaryAnchorEdges {
  const edges: BoundaryAnchorEdges = { leading: false, trailing: false };
  if (labels.length === 0) return edges;

  const firstRealIdx = data.findIndex(v => v != null);
  let lastRealIdx = -1;
  for (let i = data.length - 1; i >= 0; i--) {
    if (data[i] != null) {
      lastRealIdx = i;
      break;
    }
  }

  if (computedRange.start && data[0] == null && firstRealIdx !== -1) {
    const anchor = nearestBefore(fullLabels, fullData, labels[0]);
    const nextReal = { label: labels[firstRealIdx], value: data[firstRealIdx]! };
    const interpolated = anchor && interpolateAtLabel(anchor, nextReal, labels[0], bucket);
    if (interpolated != null) {
      data[0] = interpolated;
      edges.leading = true;
    }
  }

  const lastIdx = labels.length - 1;
  if (computedRange.end && data[lastIdx] == null && lastRealIdx !== -1) {
    const anchor = nearestAfter(fullLabels, fullData, labels[lastIdx]);
    const prevReal = { label: labels[lastRealIdx], value: data[lastRealIdx]! };
    const interpolated = anchor && interpolateAtLabel(prevReal, anchor, labels[lastIdx], bucket);
    if (interpolated != null) {
      data[lastIdx] = interpolated;
      edges.trailing = true;
    }
  }
  return edges;
}

// When the visible window's leading or trailing bucket has no data of its own
// but real data exists in the adjacent period just outside the range (e.g.
// viewing May while the nearest completed item was in late April), sets that
// edge bucket's value — on both the main series and, if configured, the
// smoothing series — to the nearest real value from outside the window. This
// makes the line slope in from the edge toward the elided point instead of
// starting from nowhere, so the chart reads as a window onto a continuous
// series rather than a series that only exists within the visible range.
// Mutates chartResult's datasets in place. Must run after any lookback
// smoothing has already been applied (so it patches the final smoothing
// values, not a version about to be replaced) and before waymark label
// extension (so "last index" still means the true end of the visible range,
// not a synthetic future tail). Returns which edges were anchored per series,
// so the caller can suppress the point marker there — an anchored edge is a
// carried-forward value, not a real data point, and shouldn't render as one.
export function anchorBoundariesToAdjacentData(
  chartResult: ChartDataResult,
  fullHistoryEntities: EntityWithMetadata[],
  config: VisualizationConfig,
  computedRange: ComputedDateRange
): BoundaryAnchorInfo {
  const bucket = config.xAxis?.timeBucket;
  const mainDataset = chartResult.datasets[0];
  const none: BoundaryAnchorInfo = { main: { leading: false, trailing: false }, smoothing: null };
  if (!bucket || !mainDataset) return none;

  const { labels: fullLabels, data: fullMainData } = computeMainSeries(fullHistoryEntities, config);
  const main = anchorSeriesEdges(
    chartResult.labels,
    mainDataset.data,
    fullLabels,
    fullMainData,
    computedRange,
    bucket
  );

  let smoothing: BoundaryAnchorEdges | null = null;
  if (config.smoothing && chartResult.smoothingDatasetIndex != null) {
    const smoothingDataset = chartResult.datasets[chartResult.smoothingDatasetIndex];
    const fullSmoothedData = computeRollingAverage(fullMainData, config.smoothing.windowSize);
    smoothing = anchorSeriesEdges(
      chartResult.labels,
      smoothingDataset.data,
      fullLabels,
      fullSmoothedData,
      computedRange,
      bucket
    );
  }

  return { main, smoothing };
}

function applyEdgeRadiusMask(
  dataset: ChartJsDataset | undefined,
  edges: BoundaryAnchorEdges
): void {
  if (!dataset || (!edges.leading && !edges.trailing)) return;
  const length = dataset.data.length;
  const base = typeof dataset.pointRadius === 'number' ? dataset.pointRadius : 3;
  dataset.pointRadius = Array.from({ length }, (_, i) => {
    if (edges.leading && i === 0) return 0;
    if (edges.trailing && i === length - 1) return 0;
    return base;
  });
}

// Hides the point marker at any edge anchored by anchorBoundariesToAdjacentData
// — a carried-forward value, not a real data point, shouldn't render a dot.
// Must run after buildChartJsConfig, since that's what sets the base
// pointRadius this overrides.
export function suppressAnchoredPointMarkers(
  chartJsConfig: ChartJsConfig,
  smoothingDatasetIndex: number | null,
  anchorInfo: BoundaryAnchorInfo
): void {
  const datasets = chartJsConfig.data.datasets;
  applyEdgeRadiusMask(datasets[0], anchorInfo.main);
  if (smoothingDatasetIndex != null && anchorInfo.smoothing) {
    applyEdgeRadiusMask(datasets[smoothingDatasetIndex], anchorInfo.smoothing);
  }
}

const WAYMARK_COLOR = 'rgba(168, 85, 247, 0.85)';

// Builds a single waymark's overlay dataset: a straight line from
// (startDate, startValue) to (endDate, waymark.targetValue), interpolated by
// bucket-ordinal position (not raw array index, not raw calendar time) so it
// still resolves correctly when a bucket in between is missing from `labels`
// (sparse data, or the synthetic future tail from extendLabelsForWaymarks).
// Labels outside [startDate, endDate] get null, which gives "clip to visible
// range" for free — this only ever maps over whatever labels the current
// zoom level already produced.
export function buildWaymarkDataset(
  waymark: Waymark,
  startValue: number,
  labels: string[],
  bucket: TimeBucket
): ChartJsDataset | null {
  const startLabel = bucketDate(waymark.startDate, bucket);
  const endLabel = bucketDate(waymark.endDate, bucket);
  const startOrd = startLabel ? bucketOrdinal(startLabel, bucket) : null;
  const endOrd = endLabel ? bucketOrdinal(endLabel, bucket) : null;
  if (startOrd == null || endOrd == null || endOrd < startOrd) return null;

  const span = endOrd - startOrd;
  const data: (number | null)[] = labels.map(label => {
    const ord = bucketOrdinal(label, bucket);
    if (ord == null || ord < startOrd || ord > endOrd) return null;
    if (span === 0) return waymark.targetValue;
    const t = (ord - startOrd) / span;
    return startValue + t * (waymark.targetValue - startValue);
  });

  return {
    label: waymark.label ?? 'Waymark',
    data,
    borderColor: WAYMARK_COLOR,
    backgroundColor: 'transparent',
    borderDash: [2, 3],
    pointRadius: 0,
    fill: false,
    tension: 0,
    type: 'line',
    order: 0,
  };
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
      // Same reasoning as smoothingDatasetStyle — gap-filled nulls shouldn't
      // break the line into disconnected segments.
      spanGaps: true,
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
  isCircular: boolean,
  unitLabel: string | undefined
): Record<string, unknown> {
  // `unitLabel` is carried as inert data on the tooltip options rather than a
  // `callbacks.label` function, since this config is serialized to JSON and sent
  // to the browser (see buildChartJsConfig call sites) — functions don't survive
  // that trip. The client wires the actual callback from this hint at render time.
  const tooltip: Record<string, unknown> = { enabled: true };
  if (unitLabel) tooltip.unitLabel = unitLabel;
  const plugins: Record<string, unknown> = {
    legend: { display: datasetCount > 1 || isCircular },
    tooltip,
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

function buildChartOptions(
  result: ChartDataResult,
  config: VisualizationConfig,
  isCircular: boolean
): Record<string, unknown> {
  const unitLabel = resolveUnitLabel(config);
  const mainLabel = result.datasets[0]?.label ?? '';
  const yAxisLabel = unitLabel ? `${mainLabel} (${unitLabel})` : mainLabel;
  const xAxisLabel = config.xAxis?.metadataKey ?? config.category?.metadataKey ?? '';
  const plugins = buildChartPlugins(config, result.datasets.length, isCircular, unitLabel);
  const scalesConfig = isCircular
    ? undefined
    : {
        x: {
          title: { display: !!xAxisLabel, text: xAxisLabel },
          // Angle labels diagonally and thin them out with autoSkip, so a dense
          // time axis (e.g. a full month of daily buckets) stays legible instead
          // of overlapping into an unreadable smear.
          ticks: { autoSkip: true, maxRotation: 60, minRotation: 60 },
        },
        y: { title: { display: !!yAxisLabel, text: yAxisLabel }, beginAtZero: false },
      };
  return {
    responsive: true,
    // Circular charts keep their aspect ratio so pies/doughnuts stay round.
    // Cartesian charts fill the CSS-defined container height instead — with
    // maintainAspectRatio left on, narrow cards would derive height from
    // width via Chart.js's default 2:1 ratio and end up shorter than the
    // container, squishing the plot area.
    maintainAspectRatio: isCircular,
    plugins,
    ...(scalesConfig ? { scales: scalesConfig } : {}),
    ...(config.chartOptions ?? {}),
  };
}

// Chart.js draws nothing for a pie/doughnut with zero slices (or slices that
// all sum to zero) — the card just goes blank, which reads as broken rather
// than "no data in range." Swap in a single greyed-out placeholder slice so
// the shape stays visible.
const EMPTY_SLICE_LABEL = 'No data';
const EMPTY_SLICE_COLOR = 'rgba(148, 163, 184, 0.35)';
const EMPTY_SLICE_BORDER = 'rgba(148, 163, 184, 0.6)';

function isEmptyCircularSeries(result: ChartDataResult): boolean {
  const data = result.datasets[0]?.data ?? [];
  return data.every(value => value == null || value === 0);
}

function buildEmptyCircularConfig(
  chartType: ChartType,
  result: ChartDataResult,
  config: VisualizationConfig
): ChartJsConfig {
  const mainLabel = result.datasets[0]?.label ?? resolveMainLabel(config);
  const dataset: ChartJsDataset = {
    label: mainLabel,
    data: [1],
    backgroundColor: [EMPTY_SLICE_COLOR],
    borderColor: EMPTY_SLICE_BORDER,
  };
  return {
    type: chartType,
    data: { labels: [EMPTY_SLICE_LABEL], datasets: [dataset] },
    options: {
      responsive: true,
      maintainAspectRatio: true,
      plugins: {
        legend: { display: true },
        tooltip: { enabled: false },
      },
    },
  };
}

export function buildChartJsConfig(
  result: ChartDataResult,
  config: VisualizationConfig
): ChartJsConfig {
  const { chartType } = config;
  const isCircular = chartType === 'pie' || chartType === 'doughnut';
  if (isCircular && isEmptyCircularSeries(result)) {
    return buildEmptyCircularConfig(chartType, result, config);
  }
  const styledDatasets = result.datasets.map((ds, i) =>
    i === 0 ? styleMainDataset(ds, chartType, result.labels.length) : ds
  );
  const options = buildChartOptions(result, config, isCircular);
  return { type: chartType, data: { labels: result.labels, datasets: styledDatasets }, options };
}
