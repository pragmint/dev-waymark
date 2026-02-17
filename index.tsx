import { Hono } from 'hono';
import type { Context } from 'hono';
import { serveStatic } from 'hono/bun';
import { trimTrailingSlash } from 'hono/trailing-slash';
import { NotFoundError, isAppError, formatErrorForLogging } from './src/core/domain/errors';
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

app.onError(async (err: Error, c: Context) => {
  console.log(formatErrorForLogging(err, { path: c.req.path, method: c.req.method }));

  if (isAppError(err)) {
    if (err instanceof NotFoundError) {
      return c.text(err.message, 404);
    }
    return c.text(`Server error: ${err.message}`, 500);
  }

  return c.text('An unexpected error occurred', 500);
});
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
