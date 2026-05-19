import type { Config } from '../../config';
import { parseSqliteUrl } from '../../config';
import type { AppStateRepository } from './repository';
import { SqliteAppStateRepository } from './sqlite';
import { PostgresAppStateRepository } from './postgres';

export function createAppStateRepo(config: Config['appDb']): AppStateRepository {
  switch (config.adapter) {
    case 'sqlite':
      return new SqliteAppStateRepository(parseSqliteUrl(config.url));
    case 'postgres':
      return new PostgresAppStateRepository(config.url);
    default: {
      const _exhaustive: never = config.adapter;
      throw new Error(`Unknown app state adapter: ${_exhaustive}`);
    }
  }
}
