import { z } from 'zod';

// Context schema - problem statement and desired outcome
export const ExperimentContextSchema = z.object({
  problem_statement: z.string(),
  desired_outcome: z.string(),
});

// Hypothesis schema - statement with assumptions, risks, and mitigations
export const ExperimentHypothesisSchema = z.object({
  statement: z.string(),
  assumptions: z.array(z.string()).optional(),
  risks: z.array(z.string()).optional(),
  risk_mitigations: z.array(z.string()).optional(),
});

// Action plan schema for experiments
export const ExperimentActionItemSchema = z.object({
  title: z.string(),
  'assigned-to': z.array(z.string()).optional(),
  link: z.string().nullable().optional(),
  status: z.enum(['active', 'backlog', 'blocked', 'complete']),
});

// Success criteria schema - metrics with targets
export const ExperimentSuccessCriteriaItemSchema = z.object({
  metric: z.string(),
  target: z.string(),
  measurement_window: z.enum(['during_experiment', 'after_experiment', 'continuous']),
  notes: z.string().optional(),
});

// Intervention schema - practice under test, description, and execution details
export const ExperimentInterventionSchema = z.object({
  practice_under_test: z.string(),
  related_capabilities: z.array(z.string()).optional(),
  description: z.string(),
  success_criteria: z.array(ExperimentSuccessCriteriaItemSchema).optional(),
  status: z.enum(['active', 'backlog', 'blocked', 'pitch', 'polish']),
  'start-date': z.string().nullable().optional(),
  'expected-duration-in-weeks': z.number().optional(),
  'action-plan': z.array(ExperimentActionItemSchema).optional(),
});

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
  context: ExperimentContextSchema,
  hypothesis: ExperimentHypothesisSchema,
  intervention: ExperimentInterventionSchema,
  'decision-roles': ExperimentDecisionRolesSchema.optional(),
});

// Runtime type for experiments with context
export interface Experiment {
  id: string; // Derived from filename
  teamId: string; // Derived from directory
  title: string;
  context: {
    problemStatement: string;
    desiredOutcome: string;
  };
  hypothesis: {
    statement: string;
    assumptions?: string[];
    risks?: string[];
    riskMitigations?: string[];
  };
  intervention: {
    practiceUnderTest: string;
    relatedCapabilities?: string[];
    description: string;
  };
  successCriteria?: ExperimentSuccessCriteriaItem[];
  status: 'active' | 'backlog' | 'blocked' | 'pitch' | 'polish';
  actionPlan?: ExperimentActionItem[];
  startDate?: string | null;
  expectedDurationInWeeks?: number;
  decisionRoles?: ExperimentDecisionRolesItem[];
}

// Derive TypeScript types from schemas
export type ExperimentActionItem = z.infer<typeof ExperimentActionItemSchema>;
export type ExperimentDecisionRolesItem = z.infer<typeof ExperimentDecisionRolesItemSchema>;
export type ExperimentSuccessCriteriaItem = z.infer<typeof ExperimentSuccessCriteriaItemSchema>;
export type ExperimentFile = z.infer<typeof ExperimentFileSchema>;
