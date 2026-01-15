// Capability catalog route handler - Single Responsibility: Handle capability catalog page requests

import { RouteHandler } from '../router';
import { groupCapabilitiesByCategory } from '../../../core/data/capabilityQueries';
import { generateCapabilityCatalogPageContent } from '../../../core/rendering/capabilityPage';
import { renderPage } from '../../../core/rendering/templates';

export const capabilityCatalogHandler: RouteHandler = async (_url, context) => {
  const capabilitiesByCategory = groupCapabilitiesByCategory(context.capabilities);
  const content = generateCapabilityCatalogPageContent(capabilitiesByCategory);

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
