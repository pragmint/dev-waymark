import { handleResourceRequest } from './src/resourceLoader';
import { pageRenderer } from './src/pageRenderer';
import { generateOverviewPageContent } from './src/overviewPage';
import { loadCapabilities, getCapabilityById, updateCapabilitiesFromTeams } from './src/capabilities';
import { generateCapabilityDetailPageContent } from './src/capabilityDetailPage';
import { generateCapabilityCatalogPageContent } from './src/capabilityCatalogPage';
import { generatePracticesCatalogPageContent } from './src/practicesCatalogPage';
import { generatePracticeDetailPageContent, loadPracticeById } from './src/practiceDetailPage';
import { loadTeams, getAllTeams, getTeamById, getExperimentById } from './src/teams';
import { generateTeamDetailPageContent } from './src/teamDetailPage';
import { generateExperimentDetailPageContent } from './src/experimentDetailPage';

// Initialize
await pageRenderer.init();
await loadCapabilities();
await loadTeams();

// Update capabilities with team-averaged scores
updateCapabilitiesFromTeams(getAllTeams());

// Set teams in pageRenderer for dynamic nav
pageRenderer.setTeams(getAllTeams());

const server = Bun.serve({
  port: 3000,
  async fetch(req) {
    const url = new URL(req.url);

    // Try to handle as a resource request
    const resourceResponse = await handleResourceRequest(url);
    if (resourceResponse) {
      return resourceResponse;
    }

    // Handle overview page with dynamic content
    if (url.pathname === '/') {
      const content = await generateOverviewPageContent();
      const html = pageRenderer.render({
        title: 'Overview',
        heading: 'Overview',
        activePage: 'overview',
        content,
      });
      return new Response(html, {
        headers: {
          "Content-Type": "text/html",
        },
      });
    }

    // Handle capabilities catalog page
    if (url.pathname === '/catalog/capability/' || url.pathname === '/catalog/capability') {
      const content = generateCapabilityCatalogPageContent();
      const html = pageRenderer.render({
        title: 'Capabilities',
        heading: 'Capabilities',
        activePage: 'capabilities',
        content,
      });
      return new Response(html, {
        headers: {
          "Content-Type": "text/html",
        },
      });
    }

    // Handle practices catalog page
    if (url.pathname === '/catalog/practice/' || url.pathname === '/catalog/practice') {
      const content = await generatePracticesCatalogPageContent();
      const html = pageRenderer.render({
        title: 'Practices',
        heading: 'Practices',
        activePage: 'practices',
        content,
      });
      return new Response(html, {
        headers: {
          "Content-Type": "text/html",
        },
      });
    }

    // Handle dynamic practice detail pages
    const practiceMatch = url.pathname.match(/^\/catalog\/practice\/([a-z0-9-]+)\/?$/);
    if (practiceMatch) {
      const practiceId = practiceMatch[1];
      const practice = await loadPracticeById(practiceId);

      if (practice) {
        const content = await generatePracticeDetailPageContent(practiceId);
        if (content) {
          const html = pageRenderer.render({
            title: practice.title,
            heading: practice.title,
            activePage: 'practices',
            content,
          });
          return new Response(html, {
            headers: {
              "Content-Type": "text/html",
            },
          });
        }
      }

      // Practice not found
      return new Response("Practice Not Found", { status: 404 });
    }

    // Handle dynamic team pages
    const teamMatch = url.pathname.match(/^\/team\/([a-z0-9-]+)\/?$/);
    if (teamMatch) {
      const teamId = teamMatch[1];
      const team = getTeamById(teamId);

      if (team) {
        const content = await generateTeamDetailPageContent(teamId);
        if (content) {
          const html = pageRenderer.render({
            title: team.name,
            heading: team.name,
            activePage: team.id,
            content,
          });
          return new Response(html, {
            headers: {
              "Content-Type": "text/html",
            },
          });
        }
      }

      // Team not found
      return new Response("Team Not Found", { status: 404 });
    }

    // Handle dynamic experiment detail pages
    const experimentMatch = url.pathname.match(/^\/experiment\/([a-z0-9-]+)\/?$/);
    if (experimentMatch) {
      const experimentId = experimentMatch[1];
      const result = getExperimentById(experimentId);

      if (result) {
        const { team, experiment } = result;
        const practice = await loadPracticeById(experiment.practiceId);
        const practiceName = practice ? practice.title : experiment.practiceId;

        const content = await generateExperimentDetailPageContent(experimentId);
        if (content) {
          const html = pageRenderer.render({
            title: `${practiceName} - ${team.name}`,
            heading: `Experiment: ${practiceName}`,
            activePage: team.id,
            content,
          });
          return new Response(html, {
            headers: {
              "Content-Type": "text/html",
            },
          });
        }
      }

      // Experiment not found
      return new Response("Experiment Not Found", { status: 404 });
    }

    // Handle dynamic capability detail pages
    const capabilityMatch = url.pathname.match(/^\/catalog\/capability\/([a-z0-9-]+)\/?$/);
    if (capabilityMatch) {
      const capabilityId = capabilityMatch[1];
      const capability = getCapabilityById(capabilityId);

      if (capability) {
        const content = generateCapabilityDetailPageContent(capabilityId);
        if (content) {
          const html = pageRenderer.render({
            title: capability.name,
            heading: capability.name,
            activePage: 'capabilities',
            content,
          });
          return new Response(html, {
            headers: {
              "Content-Type": "text/html",
            },
          });
        }
      }

      // Capability not found
      return new Response("Capability Not Found", { status: 404 });
    }

    // Route to appropriate page configuration
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
      const html = pageRenderer.render(pageConfig);
      return new Response(html, {
        headers: {
          "Content-Type": "text/html",
        },
      });
    }

    // 404 for unknown routes
    return new Response("Not Found", { status: 404 });
  },
});

console.log(`Server running at http://localhost:${server.port}`);
