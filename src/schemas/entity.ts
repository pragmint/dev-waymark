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

export const EntityFiltersSchema = z.object({
  source: z.string().optional(),
  type: z.string().optional(),
  from: z.string().optional(),
  to: z.string().optional(),
});

export type EntityFilters = z.infer<typeof EntityFiltersSchema>;
