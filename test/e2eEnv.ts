import { existsSync, readFileSync } from 'node:fs';

// Minimal .env.e2e loader shared by playwright.config.ts (webServer env) and
// the globalSetup / globalTeardown hooks (which need to know whether to start
// the devenv Postgres process).
export function loadE2EEnv(path = '.env.e2e'): Record<string, string> {
  if (!existsSync(path)) return {};
  const env: Record<string, string> = {};
  for (const raw of readFileSync(path, 'utf8').split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    const value = line
      .slice(eq + 1)
      .trim()
      .replace(/^['"]|['"]$/g, '');
    env[key] = value;
  }
  return env;
}

/**
 * True when the loaded e2e config points at Postgres (either DB). The devenv
 * process only needs to be started for this case — a SQLite `:memory:` run
 * has no external dependencies.
 */
export function usesPostgres(env: Record<string, string>): boolean {
  return (
    env.DEV_WAYMARK_SOURCE_DB_ADAPTER === 'postgres' ||
    env.DEV_WAYMARK_APP_DB_ADAPTER === 'postgres'
  );
}
