import { relative } from 'node:path';

/**
 * Parses `git worktree list --porcelain` output into the repo-relative paths
 * of every worktree other than the one at `cwd`, so tooling that scans the
 * whole repo tree can skip them. Excludes worktrees outside of `cwd` entirely.
 */
export function listOtherWorktreePaths(porcelainOutput: string, cwd: string): string[] {
  return porcelainOutput
    .split('\n')
    .filter(line => line.startsWith('worktree '))
    .map(line => relative(cwd, line.slice('worktree '.length).trim()))
    .filter(rel => rel && !rel.startsWith('..'));
}

/** Prettier-style negated glob patterns (e.g. `!extra-wide-viz`) for other worktrees. */
export function parseOtherWorktreeIgnoreArgs(porcelainOutput: string, cwd: string): string[] {
  return listOtherWorktreePaths(porcelainOutput, cwd).map(rel => `!${rel}`);
}
