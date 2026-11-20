// Parser for the filter bar's `filter-config` embed. The preset id ends up in
// URLs and the entity type in the filter tree sent to the server, so each field
// is checked here rather than cast. A malformed field falls back to its default.
import { z } from 'zod';

const FilterConfigSchema = z
  .object({
    selectedPresetId: z.number().int().positive().nullable().catch(null),
    selectedEntityType: z.string().nullable().catch(null),
    isDraft: z.boolean().catch(false),
  })
  .catch({ selectedPresetId: null, selectedEntityType: null, isDraft: false });

export type FilterConfig = z.infer<typeof FilterConfigSchema>;

export function parseFilterConfig(raw: unknown): FilterConfig {
  return FilterConfigSchema.parse(raw);
}
