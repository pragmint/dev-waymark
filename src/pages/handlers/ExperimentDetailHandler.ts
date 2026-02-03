import type { Team } from '../../core/data/teamTypes';
import type { Experiment } from '../../core/data/experimentTypes';
import { findExperimentByIdWithTeam } from '../../core/data/experimentQueries';
import { loadPracticeFromFilesystem } from '../../shell/loaders/practiceLoader';
import { NotFoundError } from '../../core/errors';

export interface ExperimentDetailPageData {
  teams: Team[];
  team: Team;
  experiment: Experiment;
  practiceName: string;
}

/**
 * Prepares all data needed for the Experiment Detail page
 * Pure, testable function that orchestrates data loading
 * @throws {NotFoundError} if experiment is not found
 */
export async function prepareExperimentDetailData(
  experimentId: string,
  teams: Team[],
  experiments: Experiment[]
): Promise<ExperimentDetailPageData> {
  // Find the experiment and its parent team
  const result = findExperimentByIdWithTeam(experiments, teams, experimentId);
  if (!result) {
    throw new NotFoundError('Experiment', experimentId);
  }

  const { team, experiment } = result;

  // Load the practice to get its display name
  const practice = await loadPracticeFromFilesystem(experiment.intervention.practiceUnderTest);
  const practiceName = practice ? practice.title : experiment.intervention.practiceUnderTest;

  return {
    teams,
    team,
    experiment,
    practiceName,
  };
}
