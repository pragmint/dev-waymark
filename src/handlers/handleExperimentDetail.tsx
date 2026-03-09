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
import { loadTeamMetricsFromFilesystem } from '../loaders/loadTeamMetricsFromFilesystem';
import { resolveMetricChartData } from '../domain/experimentMetricsData';
import type { CapabilityMetric } from '../schemas/metricSchemas';
import type { TeamMetric } from '../schemas/metricSchemas';
import type { MiniChartData } from '../frontend/components/MiniChart';

const capabilityMetrics = await loadCapabilityMetricsFromFilesystem();
const rawTeams = await loadTeamsFromFilesystem();
const experiments = await loadExperimentsFromFilesystem();
const teams = enrichTeamsWithMetrics(rawTeams, capabilityMetrics);
const teamMetrics = await loadTeamMetricsFromFilesystem();

export async function handleExperimentDetail(c: Context) {
  const experimentId = c.req.param('experimentId');

  const data = await prepareExperimentDetailData(
    experimentId,
    teams,
    experiments,
    capabilityMetrics,
    teamMetrics
  );

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
  experiments: Experiment[],
  capMetrics: CapabilityMetric[],
  tmMetrics: TeamMetric[]
): Promise<ExperimentDetailPageProps> {
  const experiment = experiments.find(exp => exp.id === experimentId);
  if (experiment === undefined) throw new NotFoundError('Experiment', experimentId);

  const team = teams.find(t => t.id === experiment.teamId);
  if (team === undefined) throw new NotFoundError('Team', experiment.teamId);

  const practice = await loadPracticeFromFilesystem(experiment.intervention.practiceUnderTest);
  const practiceName = practice ? practice.title : experiment.intervention.practiceUnderTest;

  const criteriaCharts: Record<string, MiniChartData | null> = {};
  if (experiment.successCriteria) {
    for (const criteria of experiment.successCriteria) {
      criteriaCharts[criteria.metric] = resolveMetricChartData(
        criteria.metric,
        experiment.teamId,
        team.name,
        capMetrics,
        tmMetrics
      );
    }
  }

  return {
    team,
    experiment,
    practiceName,
    criteriaChartsJson: JSON.stringify(criteriaCharts),
  };
}
