import { z } from 'zod';

export const TemplateIdSchema = z.enum([
  'duration_trend',
  'category_breakdown',
  'phase_snapshot',
  'throughput_over_time',
  'field_trend',
  'category_comparison',
  'combined_metric_trend',
  'composition_over_time',
]);
export type TemplateId = z.infer<typeof TemplateIdSchema>;

// Shared enums so slot schemas stay in sync.
const TimeBucketEnum = z.enum(['day', 'week', 'month', 'quarter', 'year']);
const AggregationEnum = z.enum([
  'avg',
  'sum',
  'min',
  'max',
  'median',
  'p75',
  'p85',
  'p90',
  'p95',
  'p99',
]);

// An optional constant line (goal, baseline, …) drawn across a time-trend chart.
// Exposed as a repeatable slot on the numeric over-time templates.
export const ReferenceLineSchema = z.object({
  value: z.number(),
  label: z.string().optional(),
});
export type ReferenceLine = z.infer<typeof ReferenceLineSchema>;

// ── Slot schemas — each template defines which fields the user must fill ─────

export const DurationTrendSlotsSchema = z.object({
  startDateField: z.string().min(1),
  endDateField: z.string().min(1),
  timeBucket: z.enum(['day', 'week', 'month', 'quarter', 'year']),
  unit: z.enum(['seconds', 'minutes', 'hours', 'days', 'weeks']),
  referenceLines: z.array(ReferenceLineSchema).optional(),
});
export type DurationTrendSlots = z.infer<typeof DurationTrendSlotsSchema>;

export const CategoryBreakdownSlotsSchema = z.object({
  categoryField: z.string().min(1),
});
export type CategoryBreakdownSlots = z.infer<typeof CategoryBreakdownSlotsSchema>;

export const PhaseSnapshotSlotsSchema = z.object({
  categoryField: z.string().min(1),
  dateField: z.string().min(1),
});
export type PhaseSnapshotSlots = z.infer<typeof PhaseSnapshotSlotsSchema>;

export const ThroughputOverTimeSlotsSchema = z.object({
  dateField: z.string().min(1),
  timeBucket: z.enum(['day', 'week', 'month', 'quarter', 'year']),
});
export type ThroughputOverTimeSlots = z.infer<typeof ThroughputOverTimeSlotsSchema>;

export const FieldTrendSlotsSchema = z.object({
  dateField: z.string().min(1),
  numericField: z.string().min(1),
  timeBucket: z.enum(['day', 'week', 'month', 'quarter', 'year']),
  aggregation: z.enum(['avg', 'sum', 'min', 'max', 'median', 'p75', 'p85', 'p90', 'p95', 'p99']),
  referenceLines: z.array(ReferenceLineSchema).optional(),
});
export type FieldTrendSlots = z.infer<typeof FieldTrendSlotsSchema>;

export const CategoryComparisonSlotsSchema = z.object({
  categoryField: z.string().min(1),
  numericField: z.string().min(1),
  aggregation: z.enum(['avg', 'sum', 'min', 'max', 'median', 'p75', 'p85', 'p90', 'p95', 'p99']),
  referenceLines: z.array(ReferenceLineSchema).optional(),
});
export type CategoryComparisonSlots = z.infer<typeof CategoryComparisonSlotsSchema>;

// Combined metric = SUM a set of numeric fields per entity, then aggregate the
// per-entity sums into a single line over time. This is how a measure like Cycle
// Time (sum of the active phase durations) is charted without a precomputed field.
export const CombinedMetricTrendSlotsSchema = z.object({
  dateField: z.string().min(1),
  numericFields: z.array(z.string().min(1)).min(1),
  timeBucket: TimeBucketEnum,
  aggregation: AggregationEnum,
  referenceLines: z.array(ReferenceLineSchema).optional(),
});
export type CombinedMetricTrendSlots = z.infer<typeof CombinedMetricTrendSlotsSchema>;

// Composition = STACK several numeric fields as separate series over time, so the
// stack height is the total and each band its contribution (e.g. lead-time phases).
// Aggregation is restricted to avg/sum because medians don't stack additively.
export const CompositionOverTimeSlotsSchema = z.object({
  dateField: z.string().min(1),
  numericFields: z.array(z.string().min(1)).min(2),
  timeBucket: TimeBucketEnum,
  aggregation: z.enum(['avg', 'sum']),
  mode: z.enum(['absolute', 'percent']).default('absolute'),
});
export type CompositionOverTimeSlots = z.infer<typeof CompositionOverTimeSlotsSchema>;

// ── Union of all template configs ────────────────────────────────────────────

export const TemplateConfigSchema = z.discriminatedUnion('templateId', [
  z.object({ templateId: z.literal('duration_trend'), slots: DurationTrendSlotsSchema }),
  z.object({ templateId: z.literal('category_breakdown'), slots: CategoryBreakdownSlotsSchema }),
  z.object({ templateId: z.literal('phase_snapshot'), slots: PhaseSnapshotSlotsSchema }),
  z.object({ templateId: z.literal('throughput_over_time'), slots: ThroughputOverTimeSlotsSchema }),
  z.object({ templateId: z.literal('field_trend'), slots: FieldTrendSlotsSchema }),
  z.object({ templateId: z.literal('category_comparison'), slots: CategoryComparisonSlotsSchema }),
  z.object({
    templateId: z.literal('combined_metric_trend'),
    slots: CombinedMetricTrendSlotsSchema,
  }),
  z.object({
    templateId: z.literal('composition_over_time'),
    slots: CompositionOverTimeSlotsSchema,
  }),
]);
export type TemplateConfig = z.infer<typeof TemplateConfigSchema>;

// ── Template metadata (for display) ─────────────────────────────────────────

export type TemplateDefinition = {
  id: TemplateId;
  name: string;
  description: string;
  chartType: string;
};

export const TEMPLATES: TemplateDefinition[] = [
  {
    id: 'duration_trend',
    name: 'Duration trend',
    description:
      'How long does a phase take, and is it improving? Rolling average of time between two date fields, plotted over time.',
    chartType: 'line',
  },
  {
    id: 'category_breakdown',
    name: 'Category breakdown',
    description:
      'What is the split of a field across your data? Count of entities grouped by a category field.',
    chartType: 'pie',
  },
  {
    id: 'phase_snapshot',
    name: 'Phase snapshot',
    description:
      'How many items are in each stage right now vs. recently? Count per category compared across time windows.',
    chartType: 'bar',
  },
  {
    id: 'throughput_over_time',
    name: 'Throughput over time',
    description: 'How many items completed per period? Count of entities per time bucket.',
    chartType: 'bar',
  },
  {
    id: 'field_trend',
    name: 'Field trend',
    description:
      'How is a numeric value changing over time? Aggregated numeric field per time bucket.',
    chartType: 'line',
  },
  {
    id: 'category_comparison',
    name: 'Category comparison',
    description:
      'How does a metric differ across categories? Aggregated numeric value broken out by a field.',
    chartType: 'bar',
  },
  {
    id: 'combined_metric_trend',
    name: 'Combined metric over time',
    description:
      'How is a measure made of several fields trending? Sums the chosen numeric fields per item, then plots the aggregate (e.g. median) over time. Optional goal/baseline lines.',
    chartType: 'line',
  },
  {
    id: 'composition_over_time',
    name: 'Composition over time',
    description:
      'Where does the time (or value) go, and how does the mix change? Stacks several numeric fields as bands per period — stack height is the total, each band its share.',
    chartType: 'bar',
  },
];
