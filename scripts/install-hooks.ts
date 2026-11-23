import { execSync } from 'node:child_process';
import { appendFileSync, chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { dirname } from 'node:path';

// Ask git rather than assuming `.git/hooks`: in a worktree `.git` is a file, and hooks live in
// the main checkout's git directory, shared by every worktree.
const HOOK_FILE = execSync('git rev-parse --git-path hooks/pre-commit', {
  encoding: 'utf8',
}).trim();
const HOOK_COMMANDS = ['bun check:commit', 'bun check:pipeline'];

mkdirSync(dirname(HOOK_FILE), { recursive: true });
if (!existsSync(HOOK_FILE)) {
  writeFileSync(HOOK_FILE, '#!/bin/sh\nset -e\n');
}

// Without `set -e` a hook's status is its last command's, so an earlier failing check would
// no longer block the commit once another is appended.
const lines = readFileSync(HOOK_FILE, 'utf8').split('\n');
if (!lines.includes('set -e')) {
  lines.splice(lines[0].startsWith('#!') ? 1 : 0, 0, 'set -e');
  writeFileSync(HOOK_FILE, lines.join('\n'));
}

for (const command of HOOK_COMMANDS) {
  if (readFileSync(HOOK_FILE, 'utf8').includes(command)) {
    console.log(`pre-commit hook already runs ${command}, skipping`);
  } else {
    appendFileSync(HOOK_FILE, `${command}\n`);
    console.log(`Added ${command} to ${HOOK_FILE}`);
  }
}

chmodSync(HOOK_FILE, 0o755);
