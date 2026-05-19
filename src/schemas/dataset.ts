import { z } from 'zod';
import { MetaFilterSchema } from './entity';

export const DatasetSchema = z.object({
  id: z.number(),
  name: z.string(),
});

export type Dataset = z.infer<typeof DatasetSchema>;

export const DatasetWithFiltersSchema = DatasetSchema.extend({
  filters: z.array(MetaFilterSchema),
});

export type DatasetWithFilters = z.infer<typeof DatasetWithFiltersSchema>;
