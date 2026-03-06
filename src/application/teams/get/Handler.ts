import {
  enrichCapabilitiesWithMetrics,
  enrichTeamsWithMetrics,
} from '../../../domain/metricAggregations';
import { prepareTeamDetailData } from '../../../domain/prepareTeamDetailData';
import type { TeamDetailPageProps } from '../../../frontend/Pages/TeamDetailPage';
import type { Practice } from '../../practices/Repository';
import type { CapabilitiesRepository } from '../../capabilities/Repository';
import type { CapabilityMetricsRepository } from '../../capabilityMetrics/Repository';
import type { TeamsRepository } from '../Repository';
import type { TeamMetricsRepository } from '../../teamMetrics/Repository';
import type { ExperimentsRepository } from '../../experiments/Repository';
import type { PracticesRepository } from '../../practices/Repository';
import type { Request } from './Request';

export function create(
  capabilitiesRepo: CapabilitiesRepository,
  capabilityMetricsRepo: CapabilityMetricsRepository,
  teamsRepo: TeamsRepository,
  teamMetricsRepo: TeamMetricsRepository,
  experimentsRepo: ExperimentsRepository,
  practicesRepo: PracticesRepository
) {
  return async function handle(req: Request): Promise<TeamDetailPageProps> {
    const [capabilities, capabilityMetrics, rawTeams, allExperiments, allTeamMetrics] =
      await Promise.all([
        capabilitiesRepo.listAll(),
        capabilityMetricsRepo.listAll(),
        teamsRepo.listAll(),
        experimentsRepo.listAll(),
        teamMetricsRepo.listAll(),
      ]);

    const teams = enrichTeamsWithMetrics(rawTeams, capabilityMetrics);
    const enrichedCapabilities = enrichCapabilitiesWithMetrics(
      capabilities,
      capabilityMetrics,
      teams
    );

    const team = teams.find(t => t.id === req.teamId);
    const teamExperiments = allExperiments.filter(e => e.teamId === req.teamId);

    const practiceIds = new Set<string>();
    for (const exp of teamExperiments) {
      practiceIds.add(exp.intervention.practiceUnderTest);
    }
    if (team?.activeExperiments) {
      for (const exp of team.activeExperiments) {
        practiceIds.add(exp.practiceId);
      }
    }

    const practiceMap = new Map<string, Practice>();
    for (const practiceId of practiceIds) {
      const practice = await practicesRepo.getById(practiceId);
      if (practice) {
        practiceMap.set(practiceId, practice);
      }
    }

    return prepareTeamDetailData(
      req.teamId,
      teams,
      enrichedCapabilities,
      capabilityMetrics,
      allExperiments,
      allTeamMetrics,
      practiceMap
    );
  };
}
