/**
 * App-state migrations.
 *
 * Each migration carries adapter-specific SQL so the differences between SQLite
 * and Postgres are explicit and easy to review. Runners in sqlite.ts and
 * postgres.ts execute the appropriate SQL string.
 */

export type Migration = {
  name: string;
  sqlite: { up: string; down: string };
  postgres: { up: string; down: string };
};

import * as m0 from './migration-20260518T000000Z';

export const migrations: Migration[] = [{ name: 'migration-20260518T000000Z', ...m0 }];
