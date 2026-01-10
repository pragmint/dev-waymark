// Imperative Shell - All I/O happens here
// Core business logic is imported as pure functions

import { handleResourceRequest } from './src/shell/http/resourceHandler';
import { loadTemplatesFromFilesystem } from './src/shell/loaders/templateLoader';
import { loadTeamsFromFilesystem } from './src/shell/loaders/teamLoader';
import { loadCapabilitiesFromFilesystem } from './src/shell/loaders/capabilityLoader';
import { loadPracticeFromFilesystem } from './src/shell/loaders/practiceLoader';
import { renderPage } from './src/core/rendering/templates';
import { enrichCapabilitiesWithTeamData } from './src/core/data/capabilityAggregations';
import {
  getTopThreeCapabilities,
  groupCapabilitiesByCategory,
  findCapabilityById
} from './src/core/data/capabilityQueries';
import { findTeamById, findExperimentById } from './src/core/data/teamQueries';
import { generateOverviewPageContent } from './src/core/rendering/overviewPage';

// Import old implementations temporarily for routes not yet refactored
import { generateCapabilityCatalogPageContent } from './src/capabilityCatalogPage';
import { generatePracticesCatalogPageContent } from './src/practicesCatalogPage';
import { generatePracticeDetailPageContent } from './src/practiceDetailPage';
import { generateTeamDetailPageContent } from './src/teamDetailPage';
import { generateExperimentDetailPageContent } from './src/experimentDetailPage';
import { generateCapabilityDetailPageContent } from './src/capabilityDetailPage';

// --- INITIALIZATION (I/O) ---
const templates = await loadTemplatesFromFilesystem();
const rawCapabilities = await loadCapabilitiesFromFilesystem();
const teams = await loadTeamsFromFilesystem();

// --- PURE TRANSFORMATION ---
const capabilities = enrichCapabilitiesWithTeamData(rawCapabilities, teams);

// --- HTTP SERVER (I/O) ---
const server = Bun.serve({
  port: 3000,
  async fetch(req) {
    const url = new URL(req.url);

    // Try to handle as a resource request
    const resourceResponse = await handleResourceRequest(url);
    if (resourceResponse) {
      return resourceResponse;
    }

    // Handle overview page
    if (url.pathname === '/') {
      const topThree = getTopThreeCapabilities(capabilities);
      const capabilitiesByCategory = groupCapabilitiesByCategory(capabilities);

      // Load executive summary (I/O)
      const executiveSummaryFile = Bun.file("resources/private/html/partials/overview/executive-summary.html");
      const executiveSummary = await executiveSummaryFile.text();

      // Pure content generation
      const content = generateOverviewPageContent(topThree, capabilitiesByCategory, executiveSummary);

      // Pure page rendering
      const html = renderPage(templates, teams, {
        title: 'Overview',
        heading: 'Overview',
        activePage: 'overview',
        content,
      });

      return new Response(html, {
        headers: { "Content-Type": "text/html" },
      });
    }

    // Handle capabilities catalog page
    if (url.pathname === '/catalog/capability/' || url.pathname === '/catalog/capability') {
      const content = generateCapabilityCatalogPageContent();
      const html = renderPage(templates, teams, {
        title: 'Capabilities',
        heading: 'Capabilities',
        activePage: 'capabilities',
        content,
      });
      return new Response(html, {
        headers: { "Content-Type": "text/html" },
      });
    }

    // Handle practices catalog page
    if (url.pathname === '/catalog/practice/' || url.pathname === '/catalog/practice') {
      const content = await generatePracticesCatalogPageContent();
      const html = renderPage(templates, teams, {
        title: 'Practices',
        heading: 'Practices',
        activePage: 'practices',
        content,
      });
      return new Response(html, {
        headers: { "Content-Type": "text/html" },
      });
    }

    // Handle dynamic practice detail pages
    const practiceMatch = url.pathname.match(/^\/catalog\/practice\/([a-z0-9-]+)\/?$/);
    if (practiceMatch) {
      const practiceId = practiceMatch[1];
      const practice = await loadPracticeFromFilesystem(practiceId);

      if (practice) {
        const content = await generatePracticeDetailPageContent(practiceId);
        if (content) {
          const html = renderPage(templates, teams, {
            title: practice.title,
            heading: practice.title,
            activePage: 'practices',
            content,
          });
          return new Response(html, {
            headers: { "Content-Type": "text/html" },
          });
        }
      }

      return new Response("Practice Not Found", { status: 404 });
    }

    // Handle dynamic team pages
    const teamMatch = url.pathname.match(/^\/team\/([a-z0-9-]+)\/?$/);
    if (teamMatch) {
      const teamId = teamMatch[1];
      const team = findTeamById(teams, teamId);

      if (team) {
        const content = await generateTeamDetailPageContent(teamId);
        if (content) {
          const html = renderPage(templates, teams, {
            title: team.name,
            heading: team.name,
            activePage: team.id,
            content,
          });
          return new Response(html, {
            headers: { "Content-Type": "text/html" },
          });
        }
      }

      return new Response("Team Not Found", { status: 404 });
    }

    // Handle dynamic experiment detail pages
    const experimentMatch = url.pathname.match(/^\/experiment\/([a-z0-9-]+)\/?$/);
    if (experimentMatch) {
      const experimentId = experimentMatch[1];
      const result = findExperimentById(teams, experimentId);

      if (result) {
        const { team, experiment } = result;
        const practice = await loadPracticeFromFilesystem(experiment.practiceId);
        const practiceName = practice ? practice.title : experiment.practiceId;

        const content = await generateExperimentDetailPageContent(experimentId);
        if (content) {
          const html = renderPage(templates, teams, {
            title: `${practiceName} - ${team.name}`,
            heading: `Experiment: ${practiceName}`,
            activePage: team.id,
            content,
          });
          return new Response(html, {
            headers: { "Content-Type": "text/html" },
          });
        }
      }

      return new Response("Experiment Not Found", { status: 404 });
    }

    // Handle dynamic capability detail pages
    const capabilityMatch = url.pathname.match(/^\/catalog\/capability\/([a-z0-9-]+)\/?$/);
    if (capabilityMatch) {
      const capabilityId = capabilityMatch[1];
      const capability = findCapabilityById(capabilities, capabilityId);

      if (capability) {
        const content = generateCapabilityDetailPageContent(capabilityId);
        if (content) {
          const html = renderPage(templates, teams, {
            title: capability.name,
            heading: capability.name,
            activePage: 'capabilities',
            content,
          });
          return new Response(html, {
            headers: { "Content-Type": "text/html" },
          });
        }
      }

      return new Response("Capability Not Found", { status: 404 });
    }

    // Coming soon pages
    const comingSoonContent = `
      <div style="max-width: 600px; margin: 64px auto; text-align: center;">
        <div style="font-size: 64px; margin-bottom: 24px; opacity: 0.3;">🚧</div>
        <h2 style="font-size: 32px; color: #333; margin-bottom: 16px;">Coming Soon</h2>
        <p style="font-size: 18px; color: #666; line-height: 1.6;">
          This page is currently under development. Check back later for updates.
        </p>
      </div>
    `;

    const routes: Record<string, { title: string; heading: string; activePage: string; content?: string }> = {
      '/insight/': { title: 'Insights', heading: 'Insights', activePage: 'insights', content: comingSoonContent },
      '/catalog/resource/': { title: 'Resources', heading: 'Resources', activePage: 'resources', content: comingSoonContent },
    };

    const pageConfig = routes[url.pathname];
    if (pageConfig) {
      const html = renderPage(templates, teams, pageConfig);
      return new Response(html, {
        headers: { "Content-Type": "text/html" },
      });
    }

    // 404 for unknown routes
    return new Response("Not Found", { status: 404 });
  },
});

console.log(`Server running at http://localhost:${server.port}`);
