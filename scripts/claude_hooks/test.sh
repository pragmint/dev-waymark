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

unit_test_output=$(bun test 2>&1)

if [ $? -ne 0 ]; then
  jq -n --arg output "$unit_test_output" '{
    "decision": "block",
    "reason": ("Unit test suite is failing.\n\n  Output: " + $output)
  }'
  exit 2 # Exit with code 2 to block
fi

# Only run E2E tests if frontend files changed
frontend_changed=$(git status --short 2>/dev/null | grep -E '^.{3}src/frontend/')
if [ -n "$frontend_changed" ]; then
  ui_test_output=$(PLAYWRIGHT_HTML_OPEN=never bun test:e2e 2>&1)

  if [ $? -ne 0 ]; then
    jq -n --arg output "$ui_test_output" '{
      "decision": "block",
      "reason": ("UI test suite is failing.\n\n  Output: " + $output)
    }'
    exit 2 # Exit with code 2 to block
  fi
fi

exit 0 # Exit with code 0 on success