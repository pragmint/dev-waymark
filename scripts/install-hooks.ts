import { existsSync } from 'fs';
import { appendFileSync, chmodSync, writeFileSync, readFileSync } from 'fs';

const HOOK_FILE = '.git/hooks/pre-commit';
const HOOK_COMMAND = 'bun check:commit';

if (!existsSync(HOOK_FILE)) {
  writeFileSync(HOOK_FILE, '#!/bin/sh\n');
}

const contents = readFileSync(HOOK_FILE, 'utf8');

if (!contents.includes(HOOK_COMMAND)) {
  appendFileSync(HOOK_FILE, `${HOOK_COMMAND}\n`);
  console.log(`Installed pre-commit hook: ${HOOK_FILE}`);
} else {
  console.log('pre-commit hook already contains bun check:commit, skipping');
}

chmodSync(HOOK_FILE, 0o755);
