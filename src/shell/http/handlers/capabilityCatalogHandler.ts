// Capability catalog route handler - Single Responsibility: Handle capability catalog page requests

import { RouteHandler } from '../router';
import { generateCapabilityCatalogPageContent } from '../../../capabilityCatalogPage';
import { renderPage } from '../../../core/rendering/templates';

export const capabilityCatalogHandler: RouteHandler = async (url, context) => {
  const content = generateCapabilityCatalogPageContent();

  const html = renderPage(context.templates, context.teams, {
    title: 'Capabilities',
    heading: 'Capabilities',
    activePage: 'capabilities',
    content,
  });

  return new Response(html, {
    headers: { "Content-Type": "text/html" },
  });
};
