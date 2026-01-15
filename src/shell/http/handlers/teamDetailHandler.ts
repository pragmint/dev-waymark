// Team detail route handler - Single Responsibility: Handle team detail page requests

import { RouteHandler } from '../router';
import { findTeamById } from '../../../core/data/teamQueries';
import { groupCapabilitiesByCategory } from '../../../core/data/capabilityQueries';
import { loadPracticeFromFilesystem } from '../../loaders/practiceLoader';
import { generateTeamDetailPageContent } from '../../../core/rendering/teamPage';
import { renderPage } from '../../../core/rendering/templates';

export const teamDetailHandler: RouteHandler = async (url, context) => {
  const match = url.pathname.match(/^\/team\/([a-z0-9-]+)\/?$/);
  if (!match) return null;

  const teamId = match[1];
  const team = findTeamById(context.teams, teamId);

  if (!team) {
    return new Response("Team Not Found", { status: 404 });
  }

  // Prepare data for rendering
  const capabilitiesByCategory = groupCapabilitiesByCategory(context.capabilities);
  const capabilityMap = new Map(context.capabilities.map(c => [c.id, c]));

  // Load practices for all experiments
  const practiceMap = new Map();
  for (const exp of team.activeExperiments) {
    const practice = await loadPracticeFromFilesystem(exp.practiceId);
    if (practice) {
      practiceMap.set(exp.practiceId, practice);
    }
  }

  const content = generateTeamDetailPageContent(
    team,
    capabilitiesByCategory,
    capabilityMap,
    practiceMap
  );

  const html = renderPage(context.templates, context.teams, {
    title: team.name,
    heading: team.name,
    activePage: team.id,
    content,
  });

  return new Response(html, {
    headers: { "Content-Type": "text/html" },
  });
};
