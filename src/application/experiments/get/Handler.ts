import type { ExperimentDetailPageProps } from '../../../frontend/Pages/ExperimentDetailPage';
import type { MiniChartData } from '../../../frontend/components/MiniChart';
import { enrichTeamsWithMetrics } from '../../../domain/metricAggregations';
import { resolveMetricChartData } from '../../../domain/experimentMetricsData';
import { NotFoundError } from '../../../domain/errors';
import type { ExperimentsRepository } from '../Repository';
import type { TeamsRepository } from '../../teams/Repository';
import type { CapabilityMetricsRepository } from '../../capabilityMetrics/Repository';
import type { TeamMetricsRepository } from '../../teamMetrics/Repository';
import type { PracticesRepository } from '../../practices/Repository';
import type { Request } from './Request';

export function create(
  experimentsRepo: ExperimentsRepository,
  teamsRepo: TeamsRepository,
  capabilityMetricsRepo: CapabilityMetricsRepository,
  teamMetricsRepo: TeamMetricsRepository,
  practicesRepo: PracticesRepository
) {
  return async function handle(req: Request): Promise<ExperimentDetailPageProps> {
    const [experiments, rawTeams, capabilityMetrics, teamMetrics] = await Promise.all([
      experimentsRepo.listAll(),
      teamsRepo.listAll(),
      capabilityMetricsRepo.listAll(),
      teamMetricsRepo.listAll(),
    ]);

    const teams = enrichTeamsWithMetrics(rawTeams, capabilityMetrics);

    const experiment = experiments.find(e => e.id === req.experimentId);
    if (!experiment) throw new NotFoundError('Experiment', req.experimentId);

    const team = teams.find(t => t.id === experiment.teamId);
    if (!team) throw new NotFoundError('Team', experiment.teamId);

    const practice = await practicesRepo.getById(experiment.intervention.practiceUnderTest);
    const practiceName = practice ? practice.title : experiment.intervention.practiceUnderTest;

    const criteriaCharts: Record<string, MiniChartData | null> = {};
    if (experiment.successCriteria) {
      for (const criteria of experiment.successCriteria) {
        criteriaCharts[criteria.metric] = resolveMetricChartData(
          criteria.metric,
          experiment.teamId,
          team.name,
          capabilityMetrics,
          teamMetrics
        );
      }
    }

    return {
      team,
      experiment,
      practiceName,
      criteriaChartsJson: JSON.stringify(criteriaCharts),
    };
  };
}
