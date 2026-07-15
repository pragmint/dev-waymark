import { existsSync, unlinkSync } from 'node:fs';
import { loadE2EEnv, usesPostgres } from './e2eEnv';
import { OWNED_MARKER } from './globalSetup';
import { runDevenv } from './runDevenv';

export default async function globalTeardown(): Promise<void> {
  if (!usesPostgres(loadE2EEnv())) return;
  // If globalSetup didn't start devenv (postgres was already up), don't stop
  // it — the developer's own `bun dev` session may still need it.
  if (!existsSync(OWNED_MARKER)) return;

  console.log('[e2e] Stopping devenv…');
  unlinkSync(OWNED_MARKER);
  await runDevenv(['processes', 'down']);
}
