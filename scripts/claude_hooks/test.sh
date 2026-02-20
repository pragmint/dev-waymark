#!/bin/bash

unit_test_output=$(bun test 2>&1)

# Check the exit status of the linter
if [ $? -ne 0 ]; then
  jq -n --arg output "$unit_test_output" '{
    "decision": "block",
    "reason": ("Unit test suite is failing.\n\n  Output: " + $output)
  }'
  exit 2 # Exit with code 2 to block
else
  ui_test_output=$(PLAYWRIGHT_HTML_OPEN=never bun test:pw 2>&1)

  # Check the exit status of the linter
  if [ $? -ne 0 ]; then
    jq -n --arg output "$ui_test_output" '{
      "decision": "block",
      "reason": ("UI test suite is failing.\n\n  Output: " + $output)
    }'
    exit 2 # Exit with code 2 to block
  fi
fi

exit 0 # Exit with code 0 on success