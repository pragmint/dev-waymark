import { z } from 'zod';

export const DashboardSchema = z.object({
  id: z.number(),
  name: z.string(),
});

export type Dashboard = z.infer<typeof DashboardSchema>;

export const DashboardWithVizSchema = DashboardSchema.extend({
  visualizationIds: z.array(z.number()),
});

export type DashboardWithViz = z.infer<typeof DashboardWithVizSchema>;
