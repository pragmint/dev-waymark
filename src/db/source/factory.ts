import type { Config } from '../../config';
import { parseSqliteUrl } from '../../config';
import type { SourceDataAdapter } from './adapter';
import { SqliteSourceAdapter } from './sqlite';
import { PostgresSourceAdapter } from './postgres';
import { RedshiftSourceAdapter } from './redshift';
import { seedGoldenData } from './goldenSeed';

export async function createSourceAdapter(config: Config['sourceDb']): Promise<SourceDataAdapter> {
  switch (config.adapter) {
    case 'sqlite': {
      const path = parseSqliteUrl(config.url);
      // Apply the source schema automatically only for in-memory databases.
      // Configured file-based or external databases are assumed to have the
      // schema already — Step Engine never migrates a source database.
      const inMemory = path === ':memory:';
      const adapter = new SqliteSourceAdapter(path, inMemory);
      if (inMemory) await seedGoldenData(adapter);
      return adapter;
    }
    case 'postgres':
      return new PostgresSourceAdapter(config.url);
    case 'redshift':
      return new RedshiftSourceAdapter(config.url);
    default: {
      const _exhaustive: never = config.adapter;
      throw new Error(`Unknown source adapter: ${_exhaustive}`);
    }
  }
}
