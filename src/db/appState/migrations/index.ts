/**
 * App-state migrations.
 *
 * Each migration carries adapter-specific SQL so the differences between SQLite
 * and Postgres are explicit and easy to review. Runners in sqlite.ts and
 * postgres.ts execute the appropriate SQL string.
 *
 * SQLite up migrations may be a function that receives the raw Database when
 * pure SQL is insufficient (e.g. conditional column additions).
 */

import type { Database } from 'bun:sqlite';

export type Migration = {
  name: string;
  sqlite: { up: string | ((db: Database) => void); down: string };
  postgres: { up: string; down: string };
};

import * as m0 from './migration-20260518T000000Z';
import * as m1 from './migration-20260519T000000Z';
import * as m2 from './migration-20260519T120000Z';
import * as m3 from './migration-20260520T000000Z';
import * as m4 from './migration-20260610T000000Z';
import * as m5 from './migration-20260618T000000Z';

export const migrations: Migration[] = [
  { name: 'migration-20260518T000000Z', ...m0 },
  { name: 'migration-20260519T000000Z', ...m1 },
  { name: 'migration-20260519T120000Z', ...m2 },
  { name: 'migration-20260520T000000Z', ...m3 },
  { name: 'migration-20260610T000000Z', ...m4 },
  { name: 'migration-20260618T000000Z', ...m5 },
];
