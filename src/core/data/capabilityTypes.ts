export type TrendDirection = 'up' | 'down' | 'stable';

export type CapabilityCategory = 'Climate for Learning' | 'Fast Flow' | 'Fast Feedback';

export interface Capability {
  id: string;
  name: string;
  category: CapabilityCategory;
  currentScore: number; // 0-4
  trend: TrendDirection;
  teamsTargeting: number;
  description?: string;
}
