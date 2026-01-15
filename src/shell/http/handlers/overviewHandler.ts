// Overview route handler - Single Responsibility: Handle overview page requests

import { RouteHandler } from '../router';
import { getTopThreeCapabilities, groupCapabilitiesByCategory } from '../../../core/data/capabilityQueries';
import { generateOverviewPageContent } from '../../../core/rendering/overviewPage';
import { renderPage } from '../../../core/rendering/templates';

export const overviewHandler: RouteHandler = async (url, context) => {
  const topThree = getTopThreeCapabilities(context.capabilities);
  const capabilitiesByCategory = groupCapabilitiesByCategory(context.capabilities);

  const executiveSummaryFile = Bun.file("resources/private/html/partials/overview/executive-summary.html");
  const executiveSummary = await executiveSummaryFile.text();

  const content = generateOverviewPageContent(topThree, capabilitiesByCategory, executiveSummary);

  const html = renderPage(context.templates, context.teams, {
    title: 'Overview',
    heading: 'Overview',
    activePage: 'overview',
    content,
  });

  return new Response(html, {
    headers: { "Content-Type": "text/html" },
  });
};
