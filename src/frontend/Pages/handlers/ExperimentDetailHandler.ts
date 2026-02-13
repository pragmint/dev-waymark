import type { Team } from '../../../core/data/teamTypes';
import type { Experiment } from '../../../core/data/experimentTypes';
import { loadPracticeFromFilesystem } from '../../../loaders/practiceLoader';
import { NotFoundError } from '../../../core/errors';
import type { ExperimentDetailPageProps } from '../ExperimentDetailPage';

/**
 * Prepares all data needed for the Experiment Detail page
 * Pure, testable function that orchestrates data loading
 * @throws {NotFoundError} if experiment is not found
 */
export async function prepareExperimentDetailData(
  experimentId: string,
  teams: Team[],
  experiments: Experiment[]
): Promise<ExperimentDetailPageProps> {
  const experiment = experiments.find(exp => exp.id === experimentId);
  if (experiment === undefined) throw new NotFoundError('Experiment', experimentId);

  const team = teams.find(t => t.id === experiment.teamId);
  if (team === undefined) throw new NotFoundError('Team', experiment.teamId);

  const practice = await loadPracticeFromFilesystem(experiment.intervention.practiceUnderTest);
  const practiceName = practice ? practice.title : experiment.intervention.practiceUnderTest;

  return {
    teams,
    team,
    experiment,
    practiceName,
  };
}
