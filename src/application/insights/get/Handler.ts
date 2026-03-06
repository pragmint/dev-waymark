import {
  enrichCapabilitiesWithMetrics,
  enrichTeamsWithMetrics,
} from '../../../domain/metricAggregations';
import { prepareInsightsData } from '../../../domain/prepareInsightsData';
import type { InsightsPageData } from '../../../domain/prepareInsightsData';
import type { CapabilitiesRepository } from '../../capabilities/Repository';
import type { CapabilityMetricsRepository } from '../../capabilityMetrics/Repository';
import type { TeamsRepository } from '../../teams/Repository';
import type { TeamMetricsRepository } from '../../teamMetrics/Repository';
import type { Request } from './Request';

export function create(
  capabilitiesRepo: CapabilitiesRepository,
  capabilityMetricsRepo: CapabilityMetricsRepository,
  teamsRepo: TeamsRepository,
  teamMetricsRepo: TeamMetricsRepository
) {
  return async function handle(_req: Request): Promise<InsightsPageData> {
    const [capabilities, capabilityMetrics, rawTeams, teamMetrics] = await Promise.all([
      capabilitiesRepo.listAll(),
      capabilityMetricsRepo.listAll(),
      teamsRepo.listAll(),
      teamMetricsRepo.listAll(),
    ]);
    const teams = enrichTeamsWithMetrics(rawTeams, capabilityMetrics);
    const enrichedCapabilities = enrichCapabilitiesWithMetrics(
      capabilities,
      capabilityMetrics,
      teams
    );
    return prepareInsightsData(teams, enrichedCapabilities, capabilityMetrics, teamMetrics);
  };
}
