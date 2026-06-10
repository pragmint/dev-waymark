import { z } from 'zod';
import { TemplateConfigSchema } from './visualizationTemplate';

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

export const DerivedMetricConfigSchema = z.object({
  name: z.string(),
  type: z.literal('duration'),
  startMetadataKey: z.string(),
  endMetadataKey: z.string(),
  unit: DurationUnitSchema,
});
export type DerivedMetricConfig = z.infer<typeof DerivedMetricConfigSchema>;

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
  derivedMetric: DerivedMetricConfigSchema.optional(),
  target: TargetConfigSchema.optional(),
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
