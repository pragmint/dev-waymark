/**
 * Pre-commit check for the Python pipeline: runs `uv run pytest` when the staged changes touch
 * pipeline code, and `bun test` in each touched container. Tests run against the working tree,
 * so unstaged edits to the same files count too.
 */
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { pipelineChecksFor } from '../src/domain/pipelineChecks';

const staged = Bun.spawnSync(['git', 'diff', '--cached', '--name-only'], { stderr: 'inherit' });
if (staged.exitCode !== 0) process.exit(staged.exitCode);

const paths = staged.stdout.toString().split('\n').filter(Boolean);
const checks = pipelineChecksFor(paths).filter(check =>
  // A deleted container has nothing left to test.
  check.command[0] === 'bun' ? existsSync(join(check.cwd, 'package.json')) : true
);

for (const check of checks) {
  if (!Bun.which(check.command[0])) {
    console.error(
      `check:pipeline: \`${check.command[0]}\` isn't on PATH. Commit from \`devenv shell\`, ` +
        'which provides it.'
    );
    process.exit(1);
  }
  console.log(`check:pipeline: ${check.name}`);
  const result = Bun.spawnSync(check.command, {
    cwd: check.cwd,
    stdio: ['inherit', 'inherit', 'inherit'],
  });
  if (result.exitCode !== 0) {
    console.error(`check:pipeline: ${check.name} failed`);
    process.exit(result.exitCode ?? 1);
  }
}
