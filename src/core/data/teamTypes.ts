import type { TrendDirection } from './capabilityTypes';

export interface ActionItem {
  task: string;
  assignees: string[];
}

export interface SupportingEvidence {
  metrics: string[];
  anecdotes: string[];
}

export interface ExpectedImpact {
  metrics: string;
  anecdotes: string;
}

export interface DecisionRoles {
  decisionMaker: string[];
  contributors: string[];
  consulted: string[];
  informed: string[];
}

export interface ActiveExperiment {
  id: string;
  practiceId: string;
  startDate: string;
  hypothesis: string;
  status: 'in-progress' | 'blocked' | 'paused';
  supportingEvidence?: SupportingEvidence;
  actionPlan?: ActionItem[];
  decisionRoles?: DecisionRoles;
  expectedImpact?: ExpectedImpact;
  duration?: string;
}

export interface TeamCapability {
  id: string;
  currentScore: number;
  trend: TrendDirection;
}

export interface Team {
  id: string;
  name: string;
  description?: string;
  targetedCapabilities: TeamCapability[];
  nonTargetedCapabilities: TeamCapability[];
  activeExperiments: ActiveExperiment[];
}
