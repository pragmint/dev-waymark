/**
 * Prints Prettier-style negated glob patterns (e.g. `!extra-wide-viz`) for every
 * other git worktree nested under this repo, so `prettier` doesn't scan them.
 * Unlike eslint.config.js, Prettier has no way to compute ignores at run time,
 * so this is meant to be interpolated into the prettier command via `$(...)`.
 */
import { execSync } from 'node:child_process';
import { parseOtherWorktreeIgnoreArgs } from '../src/domain/worktreeIgnores';

try {
  const output = execSync('git worktree list --porcelain', { encoding: 'utf-8' });
  console.log(parseOtherWorktreeIgnoreArgs(output, process.cwd()).join(' '));
} catch {
  console.log('');
}
