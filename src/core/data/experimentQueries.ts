import type { Experiment } from './experimentTypes';
import type { Team } from './teamTypes';

/**
 * Find all experiments for a specific team
 */
export function findExperimentsByTeamId(experiments: Experiment[], teamId: string): Experiment[] {
  return experiments.filter(exp => exp.teamId === teamId);
}

/**
 * Find experiment by ID and return with team context
 * This is for backward compatibility with existing code that expects
 * the experiment alongside its team
 */
export function findExperimentByIdWithTeam(
  experiments: Experiment[],
  teams: Team[],
  experimentId: string
): { team: Team; experiment: Experiment } | undefined {
  const experiment = experiments.find(exp => exp.id === experimentId)
  if (!experiment) return undefined;

  const team = teams.find(t => t.id === experiment.teamId);
  if (!team) return undefined;

  return { team, experiment };
}

/**
 * Group experiments by team ID for efficient lookup
 */
export function groupExperimentsByTeam(experiments: Experiment[]): Map<string, Experiment[]> {
  const grouped = new Map<string, Experiment[]>();

  for (const experiment of experiments) {
    if (!grouped.has(experiment.teamId)) {
      grouped.set(experiment.teamId, []);
    }
    grouped.get(experiment.teamId)!.push(experiment);
  }

  return grouped;
}
