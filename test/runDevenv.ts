import { spawn } from 'node:child_process';
import { isEnoentError } from '../src/loaders/isEnoentError';

// Shared by globalSetup.ts / globalTeardown.ts. `devenv` is normally on PATH
// via a global nix profile install, but that depends on the calling shell
// having sourced the nix-daemon profile script (e.g. a login shell, or
// direnv via this repo's `.envrc`). A shell that skips that step — CI, a
// freshly opened terminal, a worktree opened before login init finishes —
// won't find `devenv` even though `nix` itself is reliably on PATH. Fall
// back to `nix run` in that case rather than failing outright.
function spawnCommand(cmd: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const proc = spawn(cmd, args, { stdio: 'inherit' });
    proc.on('exit', code => {
      if (code === 0) resolve();
      else reject(new Error(`\`${cmd} ${args.join(' ')}\` exited with code ${code}`));
    });
    proc.on('error', reject);
  });
}

async function runDevenvFallback(args: string[]): Promise<void> {
  console.log('[e2e] `devenv` not found on PATH, falling back to `nix run nixpkgs#devenv`…');
  await spawnCommand('nix', ['run', 'nixpkgs#devenv', '--', ...args]);
}

export async function runDevenv(args: string[]): Promise<void> {
  const error = await spawnCommand('devenv', args).catch(e => e);
  if (error === undefined) return;
  if (!isEnoentError(error)) throw error;

  const fallbackError = await runDevenvFallback(args).catch(e => e);
  if (fallbackError === undefined) return;
  if (!isEnoentError(fallbackError)) throw fallbackError;

  throw new Error(
    'Neither `devenv` nor `nix` were found on PATH. Install devenv (https://devenv.sh/getting-started/) ' +
      'and make sure your shell sources the nix profile (e.g. via direnv — run `direnv allow` in this ' +
      "checkout to pick up the repo's .envrc), or open a login shell before running `bun test:e2e`."
  );
}
