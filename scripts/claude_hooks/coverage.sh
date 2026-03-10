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

THRESHOLD=85

coverage_output=$(bun test --coverage 2>&1)

# If tests failed, test.sh will already block — don't double-report
if [ $? -ne 0 ]; then
  exit 0
fi

# Extract the overall line coverage percentage from the "All files" summary row
line_coverage=$(echo "$coverage_output" | grep 'All files' | awk -F'|' '{print $3}' | tr -d ' ')

if [ -z "$line_coverage" ]; then
  exit 0 # Could not parse output — skip silently
fi

# Truncate to integer for comparison
coverage_int=$(echo "$line_coverage" | cut -d'.' -f1)

if [ "$coverage_int" -lt "$THRESHOLD" ]; then
  jq -n --arg cov "$line_coverage" --arg threshold "$THRESHOLD" --arg output "$coverage_output" '{
    "decision": "block",
    "reason": ("Line coverage is " + $cov + "% — below the " + $threshold + "% threshold. Add tests before completing.\n\n" + $output)
  }'
  exit 2
fi

exit 0
