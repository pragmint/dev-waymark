import { Context } from 'hono';
import { getCapabilityScoreForTeam } from '../domain/capabilityQueries';
import { CapabilityDetailPage } from '../frontend/Pages/CapabilityDetailPage';
import { loadCapabilityMarkdown } from '../loaders/loadCapabilityMarkdown';
import { NotFoundError } from '../domain/errors';
import {
  enrichTeamsWithMetrics,
  enrichCapabilitiesWithMetrics,
} from '../domain/metricAggregations';
import { loadAndParseCapabilities } from '../loaders/loadAndParseCapabilities';
import { loadCapabilityMetricsFromFilesystem } from '../loaders/loadCapabilityMetricsFromFilesystem';
import { loadTeamsFromFilesystem } from '../loaders/loadTeamsFromFilesystem';

export async function handleCapabilityDetail(c: Context) {
  const capabilitiesWithAssessment = await loadAndParseCapabilities();
  const capabilityMetrics = await loadCapabilityMetricsFromFilesystem();

  const rawTeams = await loadTeamsFromFilesystem();

  const teams = enrichTeamsWithMetrics(rawTeams, capabilityMetrics);

  const capabilities = enrichCapabilitiesWithMetrics(
    capabilitiesWithAssessment,
    capabilityMetrics,
    teams
  );

  const capabilityId = c.req.param('capabilityId');
  let teamFilter = c.req.query('team') || 'all';

  const capability = capabilities.find(c => c.id === capabilityId);
  if (!capability) throw new NotFoundError('Capability', capabilityId);

  const markdownContent = await loadCapabilityMarkdown(capabilityId);

  if (teams.length === 1 && teamFilter === 'all') {
    return c.redirect(`/catalog/capability/${capabilityId}?team=${teams[0].id}`);
  }

  const filteredCapability = getCapabilityScoreForTeam(capability, capabilityMetrics, teamFilter);

  return c.html(
    <CapabilityDetailPage
      teams={teams}
      capability={filteredCapability}
      selectedTeam={teamFilter}
      markdownContent={markdownContent}
    />
  );
}
