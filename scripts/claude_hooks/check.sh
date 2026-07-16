#!/bin/bash

# Skip if planning/analysis mode is active
if [ -f ".no-hooks" ]; then
  exit 0
fi

# `eslint.config.js` imports a `.ts` helper at runtime, which relies on Node's
# TypeScript type stripping (on by default in Node >=23.6 / >=22.18). Hooks
# inherit the launching shell's PATH, which may point at an older Node where the
# import fails with ERR_UNKNOWN_FILE_EXTENSION. Activate the version pinned in
# `.nvmrc` (see engines in package.json) before running checks.
export NVM_DIR="${NVM_DIR:-$HOME/.nvm}"
if [ -s "$NVM_DIR/nvm.sh" ]; then
  # shellcheck disable=SC1091
  \. "$NVM_DIR/nvm.sh"
  nvm use >/dev/null 2>&1 || nvm use 23 >/dev/null 2>&1
fi

# Skip if no TypeScript source files were changed
changed=$(git status --short 2>/dev/null | grep -E '\.(ts|tsx)$')
if [ -z "$changed" ]; then
  exit 0
fi

output=$(bun check 2>&1)

# Check the exit status of the linter
if [ $? -ne 0 ]; then
  jq -n --arg output "$output" '{
    "decision": "block",
    "reason": ("Linting, formatting, and type-checking must pass before proceeding. Try running `bun fix`.\n\n" + $output)
  }'
  exit 2 # Exit with code 2 to block
else
  exit 0 # Exit with code 0 on success
fi