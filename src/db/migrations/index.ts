import type { Database } from 'bun:sqlite';

export type Migration = {
  name: string;
  up: (db: Database) => void;
  down: (db: Database) => void;
};

import * as m0 from './migration-20260514T000000Z';

export const migrations: Migration[] = [{ name: 'migration-20260514T000000Z.ts', ...m0 }];
