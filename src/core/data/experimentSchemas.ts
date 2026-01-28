import { z } from 'zod';

// Action plan schema for experiments
export const ExperimentActionItemSchema = z.object({
  title: z.string(),
  'assigned-to': z.string(),
  link: z.string().nullable().optional(),
  status: z.enum(['active', 'backlog', 'blocked', 'complete']),
});

// Supporting evidence schema - array of objects with metric references
// Each metric reference can have multiple detail objects
// Format: [{team_id/metric-name: [{"expected-impact": "..."}, {"expected-duration": "..."}]}]
export const ExperimentEvidenceDetailSchema = z.object({
  'expected-impact': z.string().optional(),
  'expected-duration': z.string().optional(),
});

export const ExperimentEvidenceMetricSchema = z.record(
  z.string(), // Key: team_id/metric-name
  z.array(ExperimentEvidenceDetailSchema)
);

export const ExperimentSupportingEvidenceSchema = z.array(ExperimentEvidenceMetricSchema);

// Decision roles schema (RACI-based)
export const ExperimentDecisionRolesItemSchema = z.object({
  responsible: z.array(z.string()).nullable().optional(),
  accountable: z.array(z.string()).nullable().optional(),
  consulted: z.array(z.string()).nullable().optional(),
  informed: z.array(z.string()).nullable().optional(),
});

export const ExperimentDecisionRolesSchema = z.array(ExperimentDecisionRolesItemSchema);

// Main experiment file schema (for standalone YAML files)
export const ExperimentFileSchema = z.object({
  practice: z.string(),
  hypothesis: z.string(),
  status: z.enum(['active', 'backlog', 'blocked', 'pitch', 'polish']),
  'supporting-evidence': ExperimentSupportingEvidenceSchema.optional(),
  'action-plan': z.array(ExperimentActionItemSchema).optional(),
  'start-date': z.string(),
  'expected-duration-in-weeks': z.number().optional(),
  'decision-roles': ExperimentDecisionRolesSchema.optional(),
});

// Runtime type for experiments with context
export interface Experiment {
  id: string; // Derived from filename
  teamId: string; // Derived from directory
  title: string;
  practice: string;
  hypothesis: string;
  status: 'active' | 'backlog' | 'blocked' | 'pitch' | 'polish';
  supportingEvidence?: z.infer<typeof ExperimentEvidenceMetricSchema>[];
  actionPlan?: ExperimentActionItem[];
  startDate: string;
  expectedDurationInWeeks?: number;
  decisionRoles?: ExperimentDecisionRolesItem[];
}

// Derive TypeScript types from schemas
export type ExperimentActionItem = z.infer<typeof ExperimentActionItemSchema>;
export type ExperimentDecisionRolesItem = z.infer<typeof ExperimentDecisionRolesItemSchema>;
export type ExperimentFile = z.infer<typeof ExperimentFileSchema>;
