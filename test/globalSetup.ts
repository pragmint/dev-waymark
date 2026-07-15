import { spawn } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { createConnection } from 'node:net';
import { Pool } from 'pg';
import type { FullConfig } from '@playwright/test';
import { loadE2EEnv, usesPostgres } from './e2eEnv';
import { runDevenv } from './runDevenv';
import { urlForWorker } from './strictTest';

// Marker written when this run started devenv itself, so globalTeardown knows
// not to touch a devenv session that was already up (e.g. from `bun dev`).
export const OWNED_MARKER = '.devenv-e2e-owned';

const POSTGRES_HOST = '127.0.0.1';
const POSTGRES_PORT = 5433;

function tryConnect(host: string, port: number, timeoutMs: number): Promise<boolean> {
  return new Promise(resolve => {
    const socket = createConnection({ host, port });
    const done = (ok: boolean) => {
      socket.destroy();
      resolve(ok);
    };
    socket.once('connect', () => done(true));
    socket.once('error', () => done(false));
    setTimeout(() => done(false), timeoutMs);
  });
}

async function waitForPort(host: string, port: number, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await tryConnect(host, port, 500)) return;
    await new Promise(r => setTimeout(r, 250));
  }
  throw new Error(`Timed out waiting for ${host}:${port}`);
}

function run(cmd: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const proc = spawn(cmd, args, { stdio: 'inherit' });
    proc.on('exit', code => {
      if (code === 0) resolve();
      else reject(new Error(`\`${cmd} ${args.join(' ')}\` exited with code ${code}`));
    });
    proc.on('error', reject);
  });
}

const DB_NAME_PATTERN = /^[a-zA-Z0-9_]+$/;

// devenv.nix only pre-creates the base e2e databases; each Playwright worker
// needs its own `<db>_worker_N` database (see urlForWorker in strictTest.ts).
// Postgres has no `CREATE DATABASE IF NOT EXISTS`, so check pg_database first.
// This also means a fresh devenv Postgres instance (e.g. a new git worktree
// that isn't reusing another checkout's already-running instance) ends up
// self-sufficient instead of depending on databases created by hand.
async function ensureWorkerDatabases(
  env: Record<string, string>,
  workerCount: number
): Promise<void> {
  const urls = [env.DEV_WAYMARK_SOURCE_DB_URL, env.DEV_WAYMARK_APP_DB_URL].filter(
    (url): url is string =>
      !!url && (url.startsWith('postgres://') || url.startsWith('postgresql://'))
  );
  if (urls.length === 0) return;

  const admin = new URL(urls[0]);
  const pool = new Pool({
    host: admin.hostname,
    port: Number(admin.port),
    user: admin.username,
    password: admin.password,
    database: 'postgres',
  });
  try {
    for (const url of urls) {
      for (let workerIndex = 0; workerIndex < workerCount; workerIndex++) {
        const dbName = new URL(urlForWorker(url, workerIndex)).pathname.slice(1);
        if (!DB_NAME_PATTERN.test(dbName)) {
          throw new Error(`Refusing to create database with unexpected name: ${dbName}`);
        }
        const { rowCount } = await pool.query('SELECT 1 FROM pg_database WHERE datname = $1', [
          dbName,
        ]);
        if (rowCount === 0) {
          console.log(`[e2e] Creating database ${dbName}…`);
          await pool.query(`CREATE DATABASE "${dbName}"`);
        }
      }
    }
  } finally {
    await pool.end();
  }
}

export default async function globalSetup(config: FullConfig): Promise<void> {
  // Build frontend assets once for the whole run. Per-worker webServers
  // (spawned in test/strictTest.ts) all read the same ./public output.
  console.log('[e2e] Building frontend assets…');
  await run('bun', ['scripts/build.ts']);

  const env = loadE2EEnv();
  if (!usesPostgres(env)) return;

  if (await tryConnect(POSTGRES_HOST, POSTGRES_PORT, 500)) {
    // Something is already listening — assume it's a devenv started by the
    // developer's own `bun dev` session and leave it alone.
    console.log(`[e2e] Postgres already reachable on ${POSTGRES_HOST}:${POSTGRES_PORT}`);
  } else {
    console.log('[e2e] Starting devenv…');
    await runDevenv(['up', '-d']);
    await waitForPort(POSTGRES_HOST, POSTGRES_PORT, 30_000);
    writeFileSync(OWNED_MARKER, `started ${new Date().toISOString()}\n`);
  }

  await ensureWorkerDatabases(env, config.workers);
}
