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

// ── Output types ──────────────────────────────────────────────────────────────

export type ChartJsDataset = {
  label: string;
  data: (number | null)[];
  borderColor?: string;
  backgroundColor?: string | string[];
  fill?: boolean | string;
  tension?: number;
  borderDash?: number[];
  pointRadius?: number;
  type?: string;
  order?: number;
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

// Appends synthetic future bucket labels after the last real label, up to the
// furthest waymark end date, so a goal line can extend past the last bucket
// that actually has entities. Only ever extends the tail — never inserts
// mid-array — so existing index-based logic elsewhere (click-through filters,
// smoothing window filters) keeps working unmodified against the labels it
// already knows about. `realLabelCount` tells the caller where the synthetic
// tail starts, so it can skip click-through URLs for those indices.
export function extendLabelsForWaymarks(
  labels: string[],
  bucket: TimeBucket,
  waymarks: Waymark[]
): { labels: string[]; realLabelCount: number } {
  const realLabelCount = labels.length;
  if (labels.length === 0 || waymarks.length === 0) return { labels, realLabelCount };

  const maxEndLabel = waymarks
    .map(w => bucketDate(w.endDate, bucket))
    .filter((l): l is string => l != null)
    .sort((a, b) => a.localeCompare(b))
    .pop();
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
  config: VisualizationConfig
): { labels: string[]; data: number[]; excludedCount: number } {
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

  const labels = sortGroupLabels(groups, config);
  const data = labels.map(l => aggregate(groups.get(l)!, config.aggregation.function));
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
  config: VisualizationConfig
): ChartDataResult {
  const warnings: string[] = [];
  const { labels, data, excludedCount } = computeMainSeries(entities, config);
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
      data: visibleLabels.map(label => valueByLabel.get(label)!),
    },
    extendedLabels,
  };
}

function buildDatasets(
  mainLabel: string,
  data: number[],
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
// this clamping.
function computeRollingAverage(data: number[], windowSize: number): number[] {
  return data.map((_, i) => {
    const window = data.slice(Math.max(0, i - windowSize + 1), i + 1);
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
  };
}

function buildSmoothingDataset(
  smoothing: SmoothingConfig,
  mainLabel: string,
  data: number[]
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

  const valueAtOrBefore = (series: number[], targetLabel: string): number | null => {
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
        x: { title: { display: !!xAxisLabel, text: xAxisLabel } },
        y: { title: { display: !!yAxisLabel, text: yAxisLabel }, beginAtZero: false },
      };
  return {
    responsive: true,
    maintainAspectRatio: true,
    plugins,
    ...(scalesConfig ? { scales: scalesConfig } : {}),
    ...(config.chartOptions ?? {}),
  };
}

export function buildChartJsConfig(
  result: ChartDataResult,
  config: VisualizationConfig
): ChartJsConfig {
  const { chartType } = config;
  const isCircular = chartType === 'pie' || chartType === 'doughnut';
  const styledDatasets = result.datasets.map((ds, i) =>
    i === 0 ? styleMainDataset(ds, chartType, result.labels.length) : ds
  );
  const options = buildChartOptions(result, config, isCircular);
  return { type: chartType, data: { labels: result.labels, datasets: styledDatasets }, options };
}
