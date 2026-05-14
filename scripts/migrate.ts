import { getDb } from '../src/db/client';
import { runMigrations } from '../src/db/migrate';

const db = getDb();
runMigrations(db);
