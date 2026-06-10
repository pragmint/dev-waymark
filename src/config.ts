import { z } from 'zod';

const SourceDbAdapterSchema = z.enum(['sqlite', 'postgres', 'redshift']);
const AppDbAdapterSchema = z.enum(['sqlite', 'postgres']);

const ConfigSchema = z.object({
  port: z.number(),
  sourceDb: z.object({
    adapter: SourceDbAdapterSchema,
    url: z.string().min(1),
    name: z.string(),
  }),
  appDb: z.object({
    adapter: AppDbAdapterSchema,
    url: z.string().min(1),
  }),
});

export type Config = z.infer<typeof ConfigSchema>;
export type SourceDbAdapter = z.infer<typeof SourceDbAdapterSchema>;
export type AppDbAdapter = z.infer<typeof AppDbAdapterSchema>;

/**
 * Parse a sqlite:// URL to the path that Bun's SQLite driver expects.
 *   sqlite:///path/to/file.sqlite → path/to/file.sqlite
 *   sqlite:///:memory:            → :memory:
 *   plain path                    → unchanged (backward compat with DATABASE_PATH)
 */
export function parseSqliteUrl(url: string): string {
  if (url.startsWith('sqlite:///')) return url.slice('sqlite:///'.length);
  return url;
}

export function loadConfig(): Config {
  const port = parseInt(process.env.PORT ?? '3000', 10);

  // Source DB — default to in-memory SQLite when no source is configured.
  // Dev Waymark never migrates a source database; the schema must already exist
  // (see src/db/source/schema.ts). The in-memory default is an empty database
  // with the schema applied, useful for local development and testing.
  // DATABASE_PATH is accepted as a legacy fallback for file-based SQLite.
  const rawSourceAdapter = process.env.DEV_WAYMARK_SOURCE_DB_ADAPTER ?? 'sqlite';
  const sourceUrl =
    process.env.DEV_WAYMARK_SOURCE_DB_URL ??
    (process.env.DATABASE_PATH ? `sqlite:///${process.env.DATABASE_PATH}` : 'sqlite:///:memory:');
  const sourceName = process.env.DEV_WAYMARK_SOURCE_DB_NAME ?? 'default';

  // App state DB — default to local sqlite when not configured
  const rawAppAdapter = process.env.DEV_WAYMARK_APP_DB_ADAPTER ?? 'sqlite';
  const appUrl = process.env.DEV_WAYMARK_APP_DB_URL ?? 'sqlite:///dev-waymark-app.sqlite';

  return ConfigSchema.parse({
    port,
    sourceDb: { adapter: rawSourceAdapter, url: sourceUrl, name: sourceName },
    appDb: { adapter: rawAppAdapter, url: appUrl },
  });
}
