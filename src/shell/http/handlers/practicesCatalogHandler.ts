// Practices catalog route handler - Single Responsibility: Handle practices catalog page requests

import { RouteHandler } from '../router';
import { loadAllPracticesFromFilesystem } from '../../loaders/practiceLoader';
import { generatePracticesCatalogPageContent } from '../../../core/rendering/practicePage';
import { renderPage } from '../../../core/rendering/templates';

export const practicesCatalogHandler: RouteHandler = async (_url, context) => {
  const practices = await loadAllPracticesFromFilesystem();
  const content = generatePracticesCatalogPageContent(practices);

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
