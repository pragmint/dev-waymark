import {
  enrichCapabilitiesWithMetrics,
  enrichTeamsWithMetrics,
} from '../../../domain/metricAggregations';
import { prepareOverviewData } from '../../../domain/prepareOverviewData';
import type { OverviewPageProps } from '../../../frontend/Pages/OverviewPage';
import type { CapabilitiesRepository } from '../../capabilities/Repository';
import type { CapabilityMetricsRepository } from '../../capabilityMetrics/Repository';
import type { TeamsRepository } from '../../teams/Repository';
import type { SummariesRepository } from '../../summaries/Repository';
import type { Request } from './Request';

export function create(
  capabilitiesRepo: CapabilitiesRepository,
  capabilityMetricsRepo: CapabilityMetricsRepository,
  teamsRepo: TeamsRepository,
  summariesRepo: SummariesRepository
) {
  return async function handle(req: Request): Promise<OverviewPageProps> {
    const [capabilities, capabilityMetrics, rawTeams, summaries] = await Promise.all([
      capabilitiesRepo.listAll(),
      capabilityMetricsRepo.listAll(),
      teamsRepo.listAll(),
      summariesRepo.listAll(),
    ]);
    const teams = enrichTeamsWithMetrics(rawTeams, capabilityMetrics);
    const enrichedCapabilities = enrichCapabilitiesWithMetrics(
      capabilities,
      capabilityMetrics,
      teams
    );
    return prepareOverviewData(enrichedCapabilities, summaries, req.date);
  };
}
