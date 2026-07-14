import { z } from 'zod';

export const EntitySchema = z.object({
  id: z.number(),
  name: z.string(),
  type: z.string(),
  created_at: z.string(),
});

export type Entity = z.infer<typeof EntitySchema>;

export const MetadataValueTypeSchema = z.enum(['string', 'number', 'date', 'boolean']);
export type MetadataValueType = z.infer<typeof MetadataValueTypeSchema>;

export const MetadataSchema = z.object({
  entity_id: z.number(),
  key: z.string(),
  value: z.string().nullable(),
  value_type: MetadataValueTypeSchema,
  created_at: z.string(),
  updated_at: z.string(),
});

export type Metadata = z.infer<typeof MetadataSchema>;

export const EntityWithMetadataSchema = EntitySchema.extend({
  metadata: z.array(MetadataSchema),
});

export type EntityWithMetadata = z.infer<typeof EntityWithMetadataSchema>;

// ── Metadata filters ──────────────────────────────────────────────────────────

export const MetaFilterOpSchema = z.enum(['eq', 'contains', 'gte', 'lte', 'exact']);
export type MetaFilterOp = z.infer<typeof MetaFilterOpSchema>;

export const MetaFilterSchema = z.object({
  key: z.string(),
  op: MetaFilterOpSchema,
  value: z.string(),
});
export type MetaFilter = z.infer<typeof MetaFilterSchema>;

export const AvailableFilterSchema = z.object({
  key: z.string(),
  value_type: MetadataValueTypeSchema,
  entityType: z.string(),
  distinctValues: z.array(z.string()).optional(),
});
export type AvailableFilter = z.infer<typeof AvailableFilterSchema>;
