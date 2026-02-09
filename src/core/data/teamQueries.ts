import type { Team, ActiveExperiment } from './teamTypes';

// Pure query functions - no I/O, no mutation

export function findTeamById(teams: Team[], id: string): Team | undefined {
    return teams.find(t => t.id === id);
}

/**
 * @deprecated Use experimentQueries.findExperimentByIdWithTeam instead
 * This function searches for experiments embedded in team.activeExperiments (old format)
 * For new standalone experiment files, use the experimentQueries module
 */
export function findExperimentById(
  teams: Team[],
  experimentId: string
): { team: Team; experiment: ActiveExperiment } | undefined {
  for (const team of teams) {
    const experiment = team.activeExperiments?.find(exp => exp.id === experimentId);
    if (experiment) {
      return { team, experiment };
    }
  }
  return undefined;
}
