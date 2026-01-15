// Experiment detail route handler - Single Responsibility: Handle experiment detail page requests

import { RouteHandler } from '../router';
import { findExperimentById } from '../../../core/data/teamQueries';
import { loadPracticeFromFilesystem } from '../../loaders/practiceLoader';
import { generateExperimentDetailPageContent } from '../../../experimentDetailPage';
import { renderPage } from '../../../core/rendering/templates';

export const experimentDetailHandler: RouteHandler = async (url, context) => {
  const match = url.pathname.match(/^\/experiment\/([a-z0-9-]+)\/?$/);
  if (!match) return null;

  const experimentId = match[1];
  const result = findExperimentById(context.teams, experimentId);

  if (!result) {
    return new Response("Experiment Not Found", { status: 404 });
  }

  const { team, experiment } = result;
  const practice = await loadPracticeFromFilesystem(experiment.practiceId);
  const practiceName = practice ? practice.title : experiment.practiceId;

  const content = await generateExperimentDetailPageContent(experimentId);
  if (!content) {
    return new Response("Experiment Not Found", { status: 404 });
  }

  const html = renderPage(context.templates, context.teams, {
    title: `${practiceName} - ${team.name}`,
    heading: `Experiment: ${practiceName}`,
    activePage: team.id,
    content,
  });

  return new Response(html, {
    headers: { "Content-Type": "text/html" },
  });
};
