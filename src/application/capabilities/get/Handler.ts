import type { Capability } from '../../../schemas/capabilitySchemas';
import type { Team } from '../../../schemas/teamSchemas';
import {
  enrichCapabilitiesWithMetrics,
  enrichTeamsWithMetrics,
} from '../../../domain/metricAggregations';
import { getCapabilityScoreForTeam } from '../../../domain/capabilityQueries';
import { NotFoundError } from '../../../domain/errors';
import type { CapabilitiesRepository } from '../Repository';
import type { CapabilityMetricsRepository } from '../../capabilityMetrics/Repository';
import type { TeamsRepository } from '../../teams/Repository';
import type { Request } from './Request';

export interface Response {
  capability: Capability;
  teams: Team[];
  selectedTeam: string;
  markdownContent: string | null;
}

export function create(
  capabilitiesRepo: CapabilitiesRepository,
  capabilityMetricsRepo: CapabilityMetricsRepository,
  teamsRepo: TeamsRepository
) {
  return async function handle(req: Request): Promise<Response> {
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

    const found = enrichedCapabilities.find(c => c.id === req.capabilityId);
    if (!found) throw new NotFoundError('Capability', req.capabilityId);

    const markdownContent = await capabilitiesRepo.getMarkdown(req.capabilityId);
    const capability = getCapabilityScoreForTeam(found, capabilityMetrics, req.teamFilter);

    return { capability, teams, selectedTeam: req.teamFilter, markdownContent };
  };
}
