import { test as base, expect } from '@playwright/test';
import { spawn, type ChildProcess } from 'node:child_process';
import { createConnection } from 'node:net';
import { Pool } from 'pg';
import { loadE2EEnv } from './e2eEnv';

// Worker-scoped server: each Playwright worker owns its own bun index.tsx
// process on a unique port with its own DB. Sharing one server across
// workers cross-contaminated preset rows (see git history around 2026-07-13).

const BASE_PORT = 4080;

const SQLITE_DEFAULTS: Record<string, string> = {
  DEV_WAYMARK_TEST_MODE: '1',
  DEV_WAYMARK_SOURCE_DB_ADAPTER: 'sqlite',
  DEV_WAYMARK_SOURCE_DB_URL: 'sqlite:///:memory:',
  DEV_WAYMARK_SOURCE_DB_SEED: 'e2e',
  DEV_WAYMARK_APP_DB_ADAPTER: 'sqlite',
  DEV_WAYMARK_APP_DB_URL: 'sqlite:///:memory:',
};

function tryConnect(port: number, timeoutMs: number): Promise<boolean> {
  return new Promise(resolve => {
    const socket = createConnection({ host: '127.0.0.1', port });
    const done = (ok: boolean) => {
      socket.destroy();
      resolve(ok);
    };
    socket.once('connect', () => done(true));
    socket.once('error', () => done(false));
    setTimeout(() => done(false), timeoutMs);
  });
}

async function waitForPort(port: number, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await tryConnect(port, 250)) return;
    await new Promise(r => setTimeout(r, 100));
  }
  throw new Error(`Timed out waiting for port ${port}`);
}

// Rewrite DB URLs so each worker owns disjoint state.
//   sqlite :memory:  → unchanged (already per-process)
//   sqlite file      → foo.sqlite → foo-worker-N.sqlite
//   postgres         → dbname → dbname_worker_N (created by globalSetup.ts)
export function urlForWorker(url: string, workerIndex: number): string {
  if (url.includes(':memory:')) return url;
  if (url.startsWith('sqlite:///')) {
    return url.replace(/(\.sqlite)?$/, `-worker-${workerIndex}.sqlite`);
  }
  if (url.startsWith('postgres://') || url.startsWith('postgresql://')) {
    const parsed = new URL(url);
    parsed.pathname = `${parsed.pathname}_worker_${workerIndex}`;
    return parsed.toString();
  }
  return url;
}

function envForWorker(workerIndex: number, port: number): NodeJS.ProcessEnv {
  const merged: Record<string, string> = { ...SQLITE_DEFAULTS, ...loadE2EEnv() };
  merged.DEV_WAYMARK_SOURCE_DB_URL = urlForWorker(merged.DEV_WAYMARK_SOURCE_DB_URL, workerIndex);
  merged.DEV_WAYMARK_APP_DB_URL = urlForWorker(merged.DEV_WAYMARK_APP_DB_URL, workerIndex);
  return { ...process.env, ...merged, PORT: String(port) };
}

const DB_NAME_PATTERN = /^[a-zA-Z0-9_]+$/;

// globalSetup.ts pre-creates worker databases for indices 0..config.workers-1,
// but Playwright retires a worker and spawns a replacement with a HIGHER index
// after a test failure — that index has no pre-created database. Provision the
// worker's postgres databases here, on boot, so any index is self-sufficient.
// Idempotent (checks pg_database first), so the pre-created indices are no-ops.
async function ensureWorkerDatabases(env: NodeJS.ProcessEnv): Promise<void> {
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
      const dbName = new URL(url).pathname.slice(1);
      if (!DB_NAME_PATTERN.test(dbName)) {
        throw new Error(`Refusing to create database with unexpected name: ${dbName}`);
      }
      const { rowCount } = await pool.query('SELECT 1 FROM pg_database WHERE datname = $1', [
        dbName,
      ]);
      if (rowCount === 0) {
        await pool.query(`CREATE DATABASE "${dbName}"`);
      }
    }
  } finally {
    await pool.end();
  }
}

// Buffer per-worker server output so it can be dumped only if the server dies
// or misbehaves. Piping it live to the parent stdout produces confusing
// out-of-order interleaving because bun block-buffers its stdout when it's
// not a TTY, so log lines arrive after the tests that "used" them.
function bufferStream(
  stream: NodeJS.ReadableStream | null,
  buffer: string[],
  maxLines = 200
): void {
  if (!stream) return;
  let leftover = '';
  stream.setEncoding('utf8');
  stream.on('data', chunk => {
    leftover += chunk;
    const lines = leftover.split('\n');
    leftover = lines.pop() ?? '';
    for (const line of lines) {
      buffer.push(line);
      if (buffer.length > maxLines) buffer.shift();
    }
  });
}

async function spawnWorkerServer(workerIndex: number): Promise<{
  baseURL: string;
  stop: () => Promise<void>;
}> {
  const port = BASE_PORT + workerIndex;
  const env = envForWorker(workerIndex, port);
  // A worker restarted after a failure gets a fresh index that globalSetup
  // never provisioned — create its databases before booting the server.
  await ensureWorkerDatabases(env);
  const proc: ChildProcess = spawn('bun', ['index.tsx'], {
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  const logs: string[] = [];
  bufferStream(proc.stdout, logs);
  bufferStream(proc.stderr, logs);

  const exited = new Promise<number | null>(resolve => {
    proc.once('exit', code => resolve(code));
  });

  const dumpLogs = (label: string): void => {
    if (logs.length === 0) return;
    process.stderr.write(`\n[worker-${workerIndex}] ${label}:\n`);
    for (const line of logs) process.stderr.write(`[worker-${workerIndex}] ${line}\n`);
  };

  try {
    await Promise.race([
      waitForPort(port, 20_000),
      exited.then(code => {
        throw new Error(`Worker ${workerIndex} server exited early with code ${code}`);
      }),
    ]);
  } catch (err) {
    dumpLogs('server failed to start');
    proc.kill('SIGTERM');
    throw err;
  }

  proc.once('exit', code => {
    if (code !== 0 && code !== null) dumpLogs(`server exited with code ${code}`);
  });

  const stop = async (): Promise<void> => {
    if (proc.exitCode != null) return;
    proc.kill('SIGTERM');
    await Promise.race([exited, new Promise(r => setTimeout(r, 5_000))]);
    if (proc.exitCode == null) proc.kill('SIGKILL');
  };

  return { baseURL: `http://localhost:${port}`, stop };
}

type WorkerFixtures = { workerBaseURL: string };

// Wrapper around Playwright's `test` that:
//   - boots a per-worker webServer (fixes cross-worker DB contamination)
//   - fails the test on any uncaught page-level error (default fixture
//     silently swallows these)
export const test = base.extend<Record<string, never>, WorkerFixtures>({
  workerBaseURL: [
    // eslint-disable-next-line no-empty-pattern
    async ({}, use, workerInfo) => {
      const server = await spawnWorkerServer(workerInfo.workerIndex);
      try {
        await use(server.baseURL);
      } finally {
        await server.stop();
      }
    },
    { scope: 'worker' },
  ],
  baseURL: async ({ workerBaseURL }, use) => {
    await use(workerBaseURL);
  },
  page: async ({ page }, use) => {
    const errors: Error[] = [];
    page.on('pageerror', err => errors.push(err));
    await use(page);
    if (errors.length > 0) {
      const summary = errors.map(e => e.stack ?? e.message).join('\n\n');
      throw new Error(`Uncaught page errors during test:\n\n${summary}`);
    }
  },
});

export { expect };
