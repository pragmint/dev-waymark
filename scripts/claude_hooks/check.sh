#!/bin/bash

output=$(bun check)

# Check the exit status of the linter
if [ $? -ne 0 ]; then
  jq -n '{
    "decision": "block",
    "reason": "Linting, formatting, and type-checking must pass before proceeding. Try running `bun fix`."
  }'
  exit 2 # Exit with code 2 to block
else
  exit 0 # Exit with code 0 on success
fi