// Roll back the most recently applied app-state migration.
// Source database schema is never managed by Step Engine — see src/db/source/schema.ts.
import { loadConfig } from '../src/config';
import { createAppStateRepo } from '../src/db/appState/factory';

const config = loadConfig();
const repo = createAppStateRepo(config.appDb);
await repo.initialize();
await repo.rollbackLast();
await repo.close();
