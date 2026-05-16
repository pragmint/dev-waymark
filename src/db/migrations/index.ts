import type { Database } from 'bun:sqlite';

export type Migration = {
  name: string;
  up: (db: Database) => void;
  down: (db: Database) => void;
};

import * as m0 from './migration-20260514T000000Z';
import * as m1 from './migration-20260516T000000Z';

export const migrations: Migration[] = [
  { name: 'migration-20260514T000000Z.ts', ...m0 },
  { name: 'migration-20260516T000000Z.ts', ...m1 },
];
