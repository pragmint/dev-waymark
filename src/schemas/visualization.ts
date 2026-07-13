import { z } from 'zod';
import { NamedWindowSchema, TemplateConfigSchema } from './visualizationTemplate';

export type { NamedWindow } from './visualizationTemplate';

export const ChartTypeSchema = z.enum(['line', 'bar', 'pie', 'doughnut', 'scatter']);
export type ChartType = z.infer<typeof ChartTypeSchema>;

export const TimeBucketSchema = z.enum(['day', 'week', 'month', 'quarter', 'year']);
export type TimeBucket = z.infer<typeof TimeBucketSchema>;

export const AggregationFunctionSchema = z.enum([
  'count',
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
]);
export type AggregationFunction = z.infer<typeof AggregationFunctionSchema>;

export const DurationUnitSchema = z.enum(['seconds', 'minutes', 'hours', 'days', 'weeks']);
export type DurationUnit = z.infer<typeof DurationUnitSchema>;

export const AxisConfigSchema = z.object({
  metadataKey: z.string(),
  type: z.enum(['string', 'number', 'date', 'boolean']),
  timeBucket: TimeBucketSchema.optional(),
  unit: DurationUnitSchema.optional(),
  displayUnit: DurationUnitSchema.optional(),
});
export type AxisConfig = z.infer<typeof AxisConfigSchema>;

export const CategoryConfigSchema = z.object({
  metadataKey: z.string(),
  sortBy: z.enum(['label_asc', 'label_desc', 'value_asc', 'value_desc']).optional(),
});
export type CategoryConfig = z.infer<typeof CategoryConfigSchema>;

export const AggregationConfigSchema = z.object({
  function: AggregationFunctionSchema,
});
export type AggregationConfig = z.infer<typeof AggregationConfigSchema>;

// A metric computed per entity before aggregation. `duration` = end − start
// between two date fields; `sum` = the sum of several numeric fields (used to
// build composite measures like Cycle Time without a precomputed column).
export const DerivedMetricConfigSchema = z.discriminatedUnion('type', [
  z.object({
    name: z.string(),
    type: z.literal('duration'),
    startMetadataKey: z.string(),
    endMetadataKey: z.string(),
    unit: DurationUnitSchema,
  }),
  z.object({
    name: z.string(),
    type: z.literal('sum'),
    metadataKeys: z.array(z.string()).min(1),
  }),
]);
export type DerivedMetricConfig = z.infer<typeof DerivedMetricConfigSchema>;

// Several numeric fields plotted as separate stacked series over the x-axis.
// `percent` normalizes each bucket to 100% (share-of-total).
export const SeriesConfigSchema = z.object({
  metadataKeys: z.array(z.string()).min(1),
  mode: z.enum(['absolute', 'percent']).default('absolute'),
});
export type SeriesConfig = z.infer<typeof SeriesConfigSchema>;

// Individual entities plotted as points (value = sum of metadataKeys) plus a
// trailing rolling aggregate line over `windowDays`. Renders on a time x-axis.
export const RollingConfigSchema = z.object({
  metadataKeys: z.array(z.string()).min(1),
  windowDays: z.number().int().positive(),
  aggregation: AggregationFunctionSchema,
  // Hide the individual points to show just the trend line + targets.
  showPoints: z.boolean(),
  // Restrict the *displayed* range to the trailing N days (the rolling line is
  // still computed over full history, so the left edge isn't truncated).
  trailingDays: z.number().int().positive().optional(),
});
export type RollingConfig = z.infer<typeof RollingConfigSchema>;

// Compare one measure across several named windows. `combine` sums metadataKeys
// into one bar per window; otherwise each field is its own grouped bar series
// (e.g. phase-by-phase comparison across windows). Membership uses `dateField`.
export const PeriodsConfigSchema = z.object({
  dateField: z.string(),
  // Measure is EITHER a sum of these fields, OR a duration between two dates.
  metadataKeys: z.array(z.string()),
  duration: z.object({ startMetadataKey: z.string(), endMetadataKey: z.string() }).optional(),
  windows: z.array(NamedWindowSchema).min(1),
  combine: z.boolean(),
});
export type PeriodsConfig = z.infer<typeof PeriodsConfigSchema>;

export const TargetConfigSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('horizontal_line'),
    value: z.number(),
    label: z.string().optional(),
  }),
  z.object({
    type: z.literal('vertical_line'),
    value: z.string(),
    label: z.string().optional(),
  }),
  z.object({
    type: z.literal('band'),
    min: z.number(),
    max: z.number(),
    label: z.string().optional(),
  }),
]);
export type TargetConfig = z.infer<typeof TargetConfigSchema>;

export const VisualizationConfigSchema = z.object({
  chartType: ChartTypeSchema,
  xAxis: AxisConfigSchema.optional(),
  yAxis: AxisConfigSchema.optional(),
  category: CategoryConfigSchema.optional(),
  aggregation: AggregationConfigSchema,
  // Render second-valued measures in this unit (raw data stays seconds).
  displayUnit: DurationUnitSchema.optional(),
  derivedMetric: DerivedMetricConfigSchema.optional(),
  series: SeriesConfigSchema.optional(),
  rolling: RollingConfigSchema.optional(),
  periods: PeriodsConfigSchema.optional(),
  target: TargetConfigSchema.optional(),
  targets: z.array(TargetConfigSchema).optional(),
  chartOptions: z.record(z.string(), z.unknown()).optional(),
  _templateConfig: TemplateConfigSchema.optional(),
});
export type VisualizationConfig = z.infer<typeof VisualizationConfigSchema>;

export const VisualizationSchema = z.object({
  id: z.number(),
  name: z.string(),
  description: z.string().nullable(),
  presetId: z.number(),
  config: VisualizationConfigSchema,
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type Visualization = z.infer<typeof VisualizationSchema>;

export const VisualizationSummarySchema = z.object({
  id: z.number(),
  name: z.string(),
  description: z.string().nullable(),
  presetId: z.number(),
  chartType: ChartTypeSchema,
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type VisualizationSummary = z.infer<typeof VisualizationSummarySchema>;
