import { z } from 'zod';
import { FilterTreeSchema } from './filterTree';

export const PresetSchema = z.object({
  id: z.number(),
  name: z.string(),
});

export type Preset = z.infer<typeof PresetSchema>;

export const PresetWithTreeSchema = PresetSchema.extend({
  tree: FilterTreeSchema,
});

export type PresetWithTree = z.infer<typeof PresetWithTreeSchema>;
