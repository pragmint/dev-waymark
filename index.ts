// Imperative Shell - All I/O happens here
// Core business logic is imported as pure functions

import { handleResourceRequest } from './src/shell/http/resourceHandler';
import { loadTemplatesFromFilesystem } from './src/shell/loaders/templateLoader';
import { loadTeamsFromFilesystem } from './src/shell/loaders/teamLoader';
import { loadCapabilitiesFromFilesystem } from './src/shell/loaders/capabilityLoader';
import { enrichCapabilitiesWithTeamData } from './src/core/data/capabilityAggregations';
import { createAppRouter } from './src/shell/http/routes';

// --- INITIALIZATION (I/O) ---
const templates = await loadTemplatesFromFilesystem();
const rawCapabilities = await loadCapabilitiesFromFilesystem();
const teams = await loadTeamsFromFilesystem();

// --- PURE TRANSFORMATION ---
const capabilities = enrichCapabilitiesWithTeamData(rawCapabilities, teams);

// --- ROUTING SETUP ---
const router = createAppRouter();

// --- HTTP SERVER (I/O) ---
const server = Bun.serve({
  port: 3000,
  async fetch(req) {
    const url = new URL(req.url);

    // Static resources first
    const resourceResponse = await handleResourceRequest(url);
    if (resourceResponse) {
      return resourceResponse;
    }

    // Route everything else through the router
    return router.route(url, { templates, teams, capabilities });
  },
});

console.log(`Server running at http://localhost:${server.port}`);
