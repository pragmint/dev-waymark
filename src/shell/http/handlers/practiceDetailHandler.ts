// Practice detail route handler - Single Responsibility: Handle practice detail page requests

import { RouteHandler } from '../router';
import { loadPracticeFromFilesystem } from '../../loaders/practiceLoader';
import { generatePracticeDetailPageContent } from '../../../core/rendering/practicePage';
import { renderPage } from '../../../core/rendering/templates';

export const practiceDetailHandler: RouteHandler = async (url, context) => {
  const match = url.pathname.match(/^\/catalog\/practice\/([a-z0-9-]+)\/?$/);
  if (!match) return null;

  const practiceId = match[1];
  const practice = await loadPracticeFromFilesystem(practiceId);

  if (!practice) {
    return new Response("Practice Not Found", { status: 404 });
  }

  const content = generatePracticeDetailPageContent(practice);

  const html = renderPage(context.templates, context.teams, {
    title: practice.title,
    heading: practice.title,
    activePage: 'practices',
    content,
  });

  return new Response(html, {
    headers: { "Content-Type": "text/html" },
  });
};
