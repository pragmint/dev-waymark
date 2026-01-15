// Practices catalog route handler - Single Responsibility: Handle practices catalog page requests

import { RouteHandler } from '../router';
import { generatePracticesCatalogPageContent } from '../../../practicesCatalogPage';
import { renderPage } from '../../../core/rendering/templates';

export const practicesCatalogHandler: RouteHandler = async (url, context) => {
  const content = await generatePracticesCatalogPageContent();

  const html = renderPage(context.templates, context.teams, {
    title: 'Practices',
    heading: 'Practices',
    activePage: 'practices',
    content,
  });

  return new Response(html, {
    headers: { "Content-Type": "text/html" },
  });
};
