import { z } from 'zod';
import { MetaFilterSchema } from './entity';

export const PresetSchema = z.object({
  id: z.number(),
  name: z.string(),
});

export type Preset = z.infer<typeof PresetSchema>;

export const PresetWithFiltersSchema = PresetSchema.extend({
  filters: z.array(MetaFilterSchema),
});

export type PresetWithFilters = z.infer<typeof PresetWithFiltersSchema>;
