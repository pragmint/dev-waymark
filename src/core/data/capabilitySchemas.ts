import { z } from 'zod';

// Zod schemas for runtime validation
export const TrendDirectionSchema = z.enum(['up', 'down', 'stable']);

export const CapabilitySchema = z.object({
  id: z.string(),
  name: z.string(),
  currentScore: z.number().min(0).max(4).optional().default(0),
  trend: TrendDirectionSchema.optional().default('stable'),
  teamsTargeting: z.number().min(0).optional().default(0),
  description: z.string().optional(),
});

// Derive TypeScript types from schemas (single source of truth)
export type TrendDirection = z.infer<typeof TrendDirectionSchema>;
export type Capability = z.infer<typeof CapabilitySchema>;
