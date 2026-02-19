import { z } from 'zod';

export const TrendDirectionSchema = z.enum(['up', 'down', 'stable']);

export const MaturityLevelSchema = z.object({
  level: z.number().min(1).max(4),
  title: z.string(),
  description: z.string(),
  dimension: z.string().optional(),
});

export const CapabilitySchema = z.object({
  id: z.string(),
  name: z.string(),
  currentScore: z.number().min(0).max(4).optional().default(0),
  trend: TrendDirectionSchema.optional().default('stable'),
  teamsTargeting: z.number().min(0).optional().default(0),
  description: z.string().optional(),
  maturityLevels: z.array(MaturityLevelSchema).optional(),
  dimensionScores: z.record(z.string(), z.number()).optional(), // Dimension-specific scores (e.g., { "new-code": 2, "previously-written-code": 3 })
  justification: z.string().optional(), // Justification for the overall score (when not using dimensions)
  dimensionJustifications: z.record(z.string(), z.string()).optional(), // Justifications for individual dimensions (e.g., { "new-code": "justification text" })
});

// Derive TypeScript types from schemas (single source of truth)
export type TrendDirection = z.infer<typeof TrendDirectionSchema>;
export type MaturityLevel = z.infer<typeof MaturityLevelSchema>;
export type Capability = z.infer<typeof CapabilitySchema>;
