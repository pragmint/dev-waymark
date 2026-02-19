import { Context } from 'hono';
import {
  ExperimentDetailPage,
  ExperimentDetailPageProps,
} from '../frontend/Pages/ExperimentDetailPage';
import { Team } from '../schemas/teamSchemas';
import { Experiment } from '../schemas/experimentSchemas';
import { NotFoundError } from '../domain/errors';
import { loadPracticeFromFilesystem } from '../loaders/loadPracticeFromFilesystem';
import { enrichTeamsWithMetrics } from '../domain/metricAggregations';
import { loadCapabilityMetricsFromFilesystem } from '../loaders/loadCapabilityMetricsFromFilesystem';
import { loadExperimentsFromFilesystem } from '../loaders/loadExperimentsFromFilesystem';
import { loadTeamsFromFilesystem } from '../loaders/loadTeamsFromFilesystem';

export async function handleExperimentDetail(c: Context) {
  const capabilityMetrics = await loadCapabilityMetricsFromFilesystem();
  const rawTeams = await loadTeamsFromFilesystem();
  const experiments = await loadExperimentsFromFilesystem();
  const teams = enrichTeamsWithMetrics(rawTeams, capabilityMetrics);

  const experimentId = c.req.param('experimentId');
  const data = await prepareExperimentDetailData(experimentId, teams, experiments);
  return c.html(<ExperimentDetailPage {...data} />);
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
