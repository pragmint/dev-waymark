import { Context } from "hono";
import { findCapabilityById, getCapabilityScoreForTeam } from "../core/data/capabilityQueries";
import { NotFoundError } from "../core/errors";
import { CapabilityDetailPage } from "../pages/CapabilityDetailPage";
import { loadCapabilityMarkdown } from "../shell/loaders/capabilityLoader";
import { loadDataContext } from "../loaders/loadDataContext";

const { capabilities, teams, capabilityMetrics } = await loadDataContext()

export async function handleCapabilityDetail(c: Context) {
  const capabilityId = c.req.param('capabilityId');
  const capability = findCapabilityById(capabilities, capabilityId);

  if (!capability) {
    throw new NotFoundError('Capability', capabilityId);
  }

  // Get team filter from query string
  let teamFilter = c.req.query('team') || 'all';

  // If there's only one team, automatically show that team's score
  if (teams.length === 1 && teamFilter === 'all') {
    const singleTeamId = teams[0].id;
    return c.redirect(`/catalog/capability/${capabilityId}?team=${singleTeamId}`);
  }

  // Calculate team-specific score
  const filteredCapability = getCapabilityScoreForTeam(capability, capabilityMetrics, teamFilter);

  // Load capability markdown content
  const markdownContent = await loadCapabilityMarkdown(capabilityId);

  return c.html(
    <CapabilityDetailPage
      teams={teams}
      capability={filteredCapability}
      selectedTeam={teamFilter}
      markdownContent={markdownContent}
    />
  );
};
