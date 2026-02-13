import { Hono } from 'hono';
import { serveStatic } from 'hono/bun';
import { errorHandler } from './src/shell/middleware/errorHandler';
import { trimTrailingSlash } from 'hono/trailing-slash';
import { handleOverview } from './src/handlers/handleOverview';
import { handleInsight } from './src/handlers/handleInsight';
import { handleCapabilityCatalog } from './src/handlers/handleCapabilityCatalog';
import { handleCapabilityDetail } from './src/handlers/handleCapabilityDetail';
import { handlePracticeCatalog } from './src/handlers/handlePracticeCatalog';
import { handlePracticeDetail } from './src/handlers/handlePracticeDetail';
import { handleTeamDetail } from './src/handlers/handleTeamDetail';
import { handleExperimentDetail } from './src/handlers/handleExperimentDetail';

// Imperative Shell - All I/O happens here
// Core business logic is imported as pure functions
const app = new Hono();

app.onError(errorHandler);
app.use(trimTrailingSlash());
app.use('/public/*', serveStatic({ root: './' }));

app.get('/', handleOverview);
app.get('/archive/:date', handleOverview);
app.get('/insight', handleInsight);
app.get('/catalog/capability', handleCapabilityCatalog);
app.get('/catalog/capability/:capabilityId', handleCapabilityDetail);
app.get('/catalog/practice', handlePracticeCatalog);
app.get('/catalog/practice/:practiceId', handlePracticeDetail);
app.get('/team/:teamId', handleTeamDetail);
app.get('/experiment/:experimentId', handleExperimentDetail);

export default {
  port: 3000,
  fetch: app.fetch,
};

console.log('Server running at http://localhost:3000');
