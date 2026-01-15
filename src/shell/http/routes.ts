// Route configuration - Single Responsibility: Define the application's routing table

import { Router } from './router';
import { overviewHandler } from './handlers/overviewHandler';
import { capabilityCatalogHandler } from './handlers/capabilityCatalogHandler';
import { practicesCatalogHandler } from './handlers/practicesCatalogHandler';
import { practiceDetailHandler } from './handlers/practiceDetailHandler';
import { teamDetailHandler } from './handlers/teamDetailHandler';
import { experimentDetailHandler } from './handlers/experimentDetailHandler';
import { capabilityDetailHandler } from './handlers/capabilityDetailHandler';
import { comingSoonHandler } from './handlers/comingSoonHandler';

export const createAppRouter = (): Router => {
  const router = new Router();

  // Simple routes
  router.add('/', overviewHandler);
  router.add('/catalog/capability', capabilityCatalogHandler);
  router.add('/catalog/practice', practicesCatalogHandler);

  // Pattern routes (regex)
  router.add(/^\/catalog\/practice\/([a-z0-9-]+)\/?$/, practiceDetailHandler);
  router.add(/^\/team\/([a-z0-9-]+)\/?$/, teamDetailHandler);
  router.add(/^\/experiment\/([a-z0-9-]+)\/?$/, experimentDetailHandler);
  router.add(/^\/catalog\/capability\/([a-z0-9-]+)\/?$/, capabilityDetailHandler);

  // Coming soon routes
  router.add('/insight/', comingSoonHandler);
  router.add('/catalog/resource/', comingSoonHandler);

  return router;
};
