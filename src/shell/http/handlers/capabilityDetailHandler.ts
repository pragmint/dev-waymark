// Capability detail route handler - Single Responsibility: Handle capability detail page requests

import { RouteHandler } from '../router';
import { findCapabilityById } from '../../../core/data/capabilityQueries';
import { generateCapabilityDetailPageContent } from '../../../core/rendering/capabilityPage';
import { renderPage } from '../../../core/rendering/templates';

export const capabilityDetailHandler: RouteHandler = async (url, context) => {
  const match = url.pathname.match(/^\/catalog\/capability\/([a-z0-9-]+)\/?$/);
  if (!match) return null;

  const capabilityId = match[1];
  const capability = findCapabilityById(context.capabilities, capabilityId);

  if (!capability) {
    return new Response("Capability Not Found", { status: 404 });
  }

  const content = generateCapabilityDetailPageContent(capability);

  const html = renderPage(context.templates, context.teams, {
    title: capability.name,
    heading: capability.name,
    activePage: 'capabilities',
    content,
  });

  return new Response(html, {
    headers: { "Content-Type": "text/html" },
  });
};
