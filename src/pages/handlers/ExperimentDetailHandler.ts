import type { Team } from '../../core/data/teamTypes';
import { findExperimentById } from '../../core/data/teamQueries';
import { loadPracticeFromFilesystem } from '../../shell/loaders/practiceLoader';
import { NotFoundError } from '../../core/errors';

export interface ExperimentDetailPageData {
  teams: Team[];
  team: Team;
  experiment: NonNullable<ReturnType<typeof findExperimentById>>['experiment'];
  practiceName: string;
}

/**
 * Prepares all data needed for the Experiment Detail page
 * Pure, testable function that orchestrates data loading
 * @throws {NotFoundError} if experiment is not found
 */
export async function prepareExperimentDetailData(
  experimentId: string,
  teams: Team[]
): Promise<ExperimentDetailPageData> {
  // Find the experiment and its parent team
  const result = findExperimentById(teams, experimentId);
  if (!result) {
    throw new NotFoundError('Experiment', experimentId);
  }

  const { team, experiment } = result;

  // Load the practice to get its display name
  const practice = await loadPracticeFromFilesystem(experiment.practiceId);
  const practiceName = practice ? practice.title : experiment.practiceId;

  return {
    teams,
    team,
    experiment,
    practiceName,
  };
}
