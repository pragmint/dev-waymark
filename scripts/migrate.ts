// Run any pending app-state migrations.
// Source database schema is never managed by Dev Waymark — see src/db/source/schema.ts.
import { loadConfig } from '../src/config';
import { createAppStateRepo } from '../src/db/appState/factory';

const config = loadConfig();
const repo = createAppStateRepo(config.appDb);
await repo.migrate();
await repo.close();
