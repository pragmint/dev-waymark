import { spawn } from 'node:child_process';
import { existsSync, unlinkSync } from 'node:fs';
import { loadE2EEnv, usesPostgres } from './e2eEnv';
import { OWNED_MARKER } from './globalSetup';

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

export default async function globalTeardown(): Promise<void> {
  if (!usesPostgres(loadE2EEnv())) return;
  // If globalSetup didn't start devenv (postgres was already up), don't stop
  // it — the developer's own `bun dev` session may still need it.
  if (!existsSync(OWNED_MARKER)) return;

  console.log('[e2e] Stopping devenv…');
  unlinkSync(OWNED_MARKER);
  await run('devenv', ['down']);
}
