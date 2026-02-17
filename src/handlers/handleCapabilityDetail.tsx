import { Context } from 'hono';
import { getCapabilityScoreForTeam } from '../core/data/capabilityQueries';
import { CapabilityDetailPage } from '../frontend/Pages/CapabilityDetailPage';
import { loadCapabilityMarkdown } from '../loaders/loadCapabilityMarkdown';
import { loadDataContext } from '../loaders/loadDataContext';
import { NotFoundError } from '../shell/middleware/errorHandler';

const { capabilities, teams, capabilityMetrics } = await loadDataContext();

export async function handleCapabilityDetail(c: Context) {
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
