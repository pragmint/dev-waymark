import type { Capability } from '../../../schemas/capabilitySchemas';
import {
  enrichCapabilitiesWithMetrics,
  enrichTeamsWithMetrics,
} from '../../../domain/metricAggregations';
import type { CapabilitiesRepository } from '../Repository';
import type { CapabilityMetricsRepository } from '../../capabilityMetrics/Repository';
import type { TeamsRepository } from '../../teams/Repository';
import type { Request } from './Request';

export interface Response {
  capabilities: Capability[];
}

export function create(
  capabilitiesRepo: CapabilitiesRepository,
  capabilityMetricsRepo: CapabilityMetricsRepository,
  teamsRepo: TeamsRepository
) {
  return async function handle(_req: Request): Promise<Response> {
    const [capabilities, capabilityMetrics, rawTeams] = await Promise.all([
      capabilitiesRepo.listAll(),
      capabilityMetricsRepo.listAll(),
      teamsRepo.listAll(),
    ]);
    const teams = enrichTeamsWithMetrics(rawTeams, capabilityMetrics);
    const enrichedCapabilities = enrichCapabilitiesWithMetrics(
      capabilities,
      capabilityMetrics,
      teams
    );
    return { capabilities: enrichedCapabilities };
  };
}
