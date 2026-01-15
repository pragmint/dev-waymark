// Team detail route handler - Single Responsibility: Handle team detail page requests

import { RouteHandler } from '../router';
import { findTeamById } from '../../../core/data/teamQueries';
import { generateTeamDetailPageContent } from '../../../teamDetailPage';
import { renderPage } from '../../../core/rendering/templates';

export const teamDetailHandler: RouteHandler = async (url, context) => {
  const match = url.pathname.match(/^\/team\/([a-z0-9-]+)\/?$/);
  if (!match) return null;

  const teamId = match[1];
  const team = findTeamById(context.teams, teamId);

  if (!team) {
    return new Response("Team Not Found", { status: 404 });
  }

  const content = await generateTeamDetailPageContent(teamId);
  if (!content) {
    return new Response("Team Not Found", { status: 404 });
  }

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
