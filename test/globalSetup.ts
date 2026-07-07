import { spawn } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { createConnection } from 'node:net';
import { loadE2EEnv, usesPostgres } from './e2eEnv';

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

export default async function globalSetup(): Promise<void> {
  if (!usesPostgres(loadE2EEnv())) return;

  if (await tryConnect(POSTGRES_HOST, POSTGRES_PORT, 500)) {
    // Something is already listening — assume it's a devenv started by the
    // developer's own `bun dev` session and leave it alone.
    console.log(`[e2e] Postgres already reachable on ${POSTGRES_HOST}:${POSTGRES_PORT}`);
    return;
  }

  console.log('[e2e] Starting devenv…');
  await run('devenv', ['up', '-d']);
  await waitForPort(POSTGRES_HOST, POSTGRES_PORT, 30_000);
  writeFileSync(OWNED_MARKER, `started ${new Date().toISOString()}\n`);
}
