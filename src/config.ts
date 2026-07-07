import { z } from 'zod';

const SourceDbAdapterSchema = z.enum(['sqlite', 'postgres', 'redshift']);
const AppDbAdapterSchema = z.enum(['sqlite', 'postgres']);
const SourceDbSeedSchema = z.enum(['none', 'golden', 'e2e']);

const ConfigSchema = z.object({
  port: z.number(),
  // Enables the e2e test harness: truncates the app-state DB at boot and mounts
  // the /test/* seeding endpoints Playwright uses. Has no effect on the source
  // DB — that's controlled entirely by sourceDb.seed.
  testMode: z.boolean(),
  sourceDb: z.object({
    adapter: SourceDbAdapterSchema,
    url: z.string().min(1),
    name: z.string(),
    // Which dataset (if any) Dev Waymark installs into the source DB on boot.
    //   'none'   — treat the source as prod-style; never touch its schema or rows.
    //   'golden' — apply schema, truncate rows, load the full golden dataset.
    //   'e2e'    — apply schema, truncate rows, load the compact e2e dataset.
    // Any non-'none' value TRUNCATES the source on every start — never point at
    // a real source DB.
    seed: SourceDbSeedSchema,
  }),
  appDb: z.object({
    adapter: AppDbAdapterSchema,
    url: z.string().min(1),
  }),
});

export type Config = z.infer<typeof ConfigSchema>;
export type SourceDbAdapter = z.infer<typeof SourceDbAdapterSchema>;
export type AppDbAdapter = z.infer<typeof AppDbAdapterSchema>;
export type SourceDbSeed = z.infer<typeof SourceDbSeedSchema>;

/**
 * Parse a sqlite:// URL to the path that Bun's SQLite driver expects.
 *   sqlite:///path/to/file.sqlite → path/to/file.sqlite
 *   sqlite:///:memory:            → :memory:
 *   plain path                    → unchanged
 */
export function parseSqliteUrl(url: string): string {
  if (url.startsWith('sqlite:///')) return url.slice('sqlite:///'.length);
  return url;
}

export function loadConfig(): Config {
  const port = parseInt(process.env.PORT ?? '3000', 10);

  // Source DB — default to in-memory SQLite when no source is configured.
  // Dev Waymark never migrates a source database; the schema must already
  // exist (see src/db/source/schema.ts) unless DEV_WAYMARK_SOURCE_DB_SEED opts
  // into schema management.
  const rawSourceAdapter = process.env.DEV_WAYMARK_SOURCE_DB_ADAPTER ?? 'sqlite';
  const sourceUrl = process.env.DEV_WAYMARK_SOURCE_DB_URL ?? 'sqlite:///:memory:';
  const sourceName = process.env.DEV_WAYMARK_SOURCE_DB_NAME ?? 'default';
  const sourceSeed = process.env.DEV_WAYMARK_SOURCE_DB_SEED ?? 'none';

  // App state DB — default to local sqlite when not configured
  const rawAppAdapter = process.env.DEV_WAYMARK_APP_DB_ADAPTER ?? 'sqlite';
  const appUrl = process.env.DEV_WAYMARK_APP_DB_URL ?? 'sqlite:///dev-waymark-app.sqlite';

  const testMode = process.env.DEV_WAYMARK_TEST_MODE === '1';

  return ConfigSchema.parse({
    port,
    testMode,
    sourceDb: {
      adapter: rawSourceAdapter,
      url: sourceUrl,
      name: sourceName,
      seed: sourceSeed,
    },
    appDb: { adapter: rawAppAdapter, url: appUrl },
  });
}
