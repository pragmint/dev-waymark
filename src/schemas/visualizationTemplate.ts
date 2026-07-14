import { z } from 'zod';

export const TemplateIdSchema = z.enum([
  'duration_trend',
  'category_breakdown',
  'phase_snapshot',
  'throughput_over_time',
  'field_trend',
  'category_comparison',
]);
export type TemplateId = z.infer<typeof TemplateIdSchema>;

// ── Slot schemas — each template defines which fields the user must fill ─────

export const DurationTrendSlotsSchema = z.object({
  startDateField: z.string().min(1),
  endDateField: z.string().min(1),
  timeBucket: z.enum(['day', 'week', 'month', 'quarter', 'year']),
  unit: z.enum(['seconds', 'minutes', 'hours', 'days', 'weeks']),
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
  numericFields: z.array(z.string().min(1)).min(1),
  timeBucket: z.enum(['day', 'week', 'month', 'quarter', 'year']),
  aggregation: z.enum(['avg', 'sum', 'min', 'max', 'median', 'p75', 'p85', 'p90', 'p95', 'p99']),
});
export type FieldTrendSlots = z.infer<typeof FieldTrendSlotsSchema>;

export const CategoryComparisonSlotsSchema = z.object({
  categoryField: z.string().min(1),
  numericField: z.string().min(1),
  aggregation: z.enum(['avg', 'sum', 'min', 'max', 'median', 'p75', 'p85', 'p90', 'p95', 'p99']),
});
export type CategoryComparisonSlots = z.infer<typeof CategoryComparisonSlotsSchema>;

// ── Union of all template configs ────────────────────────────────────────────

export const TemplateConfigSchema = z.discriminatedUnion('templateId', [
  z.object({ templateId: z.literal('duration_trend'), slots: DurationTrendSlotsSchema }),
  z.object({ templateId: z.literal('category_breakdown'), slots: CategoryBreakdownSlotsSchema }),
  z.object({ templateId: z.literal('phase_snapshot'), slots: PhaseSnapshotSlotsSchema }),
  z.object({ templateId: z.literal('throughput_over_time'), slots: ThroughputOverTimeSlotsSchema }),
  z.object({ templateId: z.literal('field_trend'), slots: FieldTrendSlotsSchema }),
  z.object({ templateId: z.literal('category_comparison'), slots: CategoryComparisonSlotsSchema }),
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
];
