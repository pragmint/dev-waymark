import { z } from 'zod';

export const EntitySchema = z.object({
  id: z.string(),
  source_id: z.string(),
  created_at: z.string(),
  updated_at: z.string(),
});

export type Entity = z.infer<typeof EntitySchema>;

export const MetadataValueTypeSchema = z.enum(['string', 'number', 'date', 'boolean']);
export type MetadataValueType = z.infer<typeof MetadataValueTypeSchema>;

export const MetadataSchema = z.object({
  entity_id: z.string(),
  key: z.string(),
  value: z.string().nullable(),
  value_type: MetadataValueTypeSchema,
});

export type Metadata = z.infer<typeof MetadataSchema>;

export const EntityWithMetadataSchema = EntitySchema.extend({
  metadata: z.array(MetadataSchema),
});

export type EntityWithMetadata = z.infer<typeof EntityWithMetadataSchema>;

// ── Metadata filters ──────────────────────────────────────────────────────────

export const MetaFilterOpSchema = z.enum(['eq', 'contains', 'gte', 'lte', 're']);
export type MetaFilterOp = z.infer<typeof MetaFilterOpSchema>;

export const MetaFilterSchema = z.object({
  key: z.string(),
  op: MetaFilterOpSchema,
  value: z.string(),
});
export type MetaFilter = z.infer<typeof MetaFilterSchema>;

export const DateRangeFiltersSchema = z.object({
  from: z.string().optional(),
  to: z.string().optional(),
});
export type DateRangeFilters = z.infer<typeof DateRangeFiltersSchema>;

export const AvailableFilterSchema = z.object({
  key: z.string(),
  value_type: MetadataValueTypeSchema,
  distinctValues: z.array(z.string()).optional(),
});
export type AvailableFilter = z.infer<typeof AvailableFilterSchema>;
