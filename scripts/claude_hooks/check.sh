#!/bin/bash

# Skip if planning/analysis mode is active
if [ -f ".no-hooks" ]; then
  exit 0
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