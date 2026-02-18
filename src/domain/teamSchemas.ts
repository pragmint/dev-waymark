import { z } from 'zod';
import { TrendDirectionSchema } from './capabilitySchemas';

// Zod schemas for runtime validation
export const ActionItemSchema = z.object({
  task: z.string(),
  assignees: z.array(z.string()),
});

export const SupportingEvidenceSchema = z.object({
  metrics: z.array(z.string()),
  anecdotes: z.array(z.string()),
});

export const ExpectedImpactSchema = z.object({
  metrics: z.string(),
  anecdotes: z.string(),
});

export const DecisionRolesSchema = z.object({
  decisionMaker: z.array(z.string()),
  contributors: z.array(z.string()),
  consulted: z.array(z.string()),
  informed: z.array(z.string()),
});

export const ActiveExperimentSchema = z.object({
  id: z.string(),
  practiceId: z.string(),
  startDate: z.string(),
  hypothesis: z.string(),
  status: z.enum(['in-progress', 'blocked', 'paused']),
  supportingEvidence: SupportingEvidenceSchema.optional(),
  actionPlan: z.array(ActionItemSchema).optional(),
  decisionRoles: DecisionRolesSchema.optional(),
  expectedImpact: ExpectedImpactSchema.optional(),
  duration: z.string().optional(),
});

export const TeamCapabilitySchema = z.object({
  id: z.string(),
  currentScore: z.number().min(0).max(4).nullable().default(null),
  trend: TrendDirectionSchema.nullable().default(null),
});

// Support both old format (objects) and new format (strings) for capabilities
export const TeamCapabilityReferenceSchema = z.string();

export const TeamSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string().optional(),
  // Support both old and new formats during transition
  targetedCapabilities: z
    .union([
      z.array(TeamCapabilitySchema), // Old format: objects with id, currentScore, trend
      z.array(TeamCapabilityReferenceSchema), // New format: just capability IDs
    ])
    .optional()
    .default([])
    .transform((caps): z.infer<typeof TeamCapabilitySchema>[] =>
      caps.map(cap =>
        typeof cap === 'string' ? { id: cap, currentScore: null, trend: null } : cap
      )
    ),
  nonTargetedCapabilities: z.array(TeamCapabilitySchema).optional().default([]),
  activeExperiments: z.array(ActiveExperimentSchema).optional().default([]),
});

// Derive TypeScript types from schemas (single source of truth)
export type ActionItem = z.infer<typeof ActionItemSchema>;
export type SupportingEvidence = z.infer<typeof SupportingEvidenceSchema>;
export type ExpectedImpact = z.infer<typeof ExpectedImpactSchema>;
export type DecisionRoles = z.infer<typeof DecisionRolesSchema>;
export type ActiveExperiment = z.infer<typeof ActiveExperimentSchema>;
export type TeamCapability = z.infer<typeof TeamCapabilitySchema>;
export type Team = z.infer<typeof TeamSchema>;
