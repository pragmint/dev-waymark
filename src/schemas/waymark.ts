import { z } from 'zod';

export const WaymarkAppliesToSchema = z.enum(['main', 'smoothing']);
export type WaymarkAppliesTo = z.infer<typeof WaymarkAppliesToSchema>;

export const WaymarkSchema = z.object({
  id: z.number(),
  visualizationId: z.number(),
  startDate: z.string(),
  endDate: z.string(),
  targetValue: z.number(),
  appliesTo: WaymarkAppliesToSchema,
  label: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type Waymark = z.infer<typeof WaymarkSchema>;

export const WaymarkInputSchema = z
  .object({
    startDate: z.string().min(1),
    endDate: z.string().min(1),
    targetValue: z.number().finite(),
    appliesTo: WaymarkAppliesToSchema,
    label: z.string().nullable(),
  })
  .refine(input => input.endDate > input.startDate, {
    message: 'End date must be after start date',
    path: ['endDate'],
  });
export type WaymarkInput = z.infer<typeof WaymarkInputSchema>;
