import { getDb } from '../src/db/client';
import { rollbackMigration } from '../src/db/migrate';

const db = getDb();
rollbackMigration(db);
