#!/usr/bin/env bash
# experiments.sh — Get and set experiment data
# Usage: ./experiments.sh <command> [args]
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CONFIG_FILE="$HOME/.local/share/step-engine/config.json"

get_data_dir() {
  if [[ -f "$CONFIG_FILE" ]] && command -v jq &>/dev/null; then
    local dir
    dir=$(jq -r '.userDataDir // empty' "$CONFIG_FILE" 2>/dev/null)
    [[ -n "$dir" ]] && echo "$dir" && return
  fi
  echo "$(cd "$SCRIPT_DIR/../../../.." && pwd)/examples"
}

DATA_DIR="$(get_data_dir)"
EXPERIMENTS_DIR="$DATA_DIR/experiments"

require_yq() {
  if ! command -v yq &>/dev/null; then
    echo "Error: yq is required. Install with: brew install yq" >&2
    exit 1
  fi
}

cmd_list() {
  local team_id="${1:-}"
  if [[ -n "$team_id" ]]; then
    local dir="$EXPERIMENTS_DIR/$team_id"
    [[ -d "$dir" ]] || { echo "Error: no experiments found for team '$team_id'" >&2; exit 1; }
    for f in "$dir"/*.yaml; do
      [[ -f "$f" ]] || continue
      echo "$team_id/$(basename "$f" .yaml)"
    done
  else
    for dir in "$EXPERIMENTS_DIR"/*/; do
      [[ -d "$dir" ]] || continue
      local tid
      tid="$(basename "$dir")"
      for f in "$dir"*.yaml; do
        [[ -f "$f" ]] || continue
        echo "$tid/$(basename "$f" .yaml)"
      done
    done
  fi
}

cmd_get() {
  local team_id="${1:?Usage: experiments.sh get <team-id> <experiment-id>}"
  local exp_id="${2:?Missing experiment-id}"
  local file="$EXPERIMENTS_DIR/$team_id/$exp_id.yaml"
  [[ -f "$file" ]] || { echo "Error: experiment '$team_id/$exp_id' not found" >&2; exit 1; }
  cat "$file"
}

cmd_set_status() {
  require_yq
  local team_id="${1:?Usage: experiments.sh set-status <team-id> <experiment-id> <status>}"
  local exp_id="${2:?Missing experiment-id}"
  local status="${3:?Missing status}"
  local file="$EXPERIMENTS_DIR/$team_id/$exp_id.yaml"
  [[ -f "$file" ]] || { echo "Error: experiment '$team_id/$exp_id' not found" >&2; exit 1; }
  yq -i ".intervention.status = \"$status\"" "$file"
  echo "Set $team_id/$exp_id status → $status"
}

# set-field uses yq path notation, e.g. "intervention.start-date" or "hypothesis.statement"
cmd_set_field() {
  require_yq
  local team_id="${1:?Usage: experiments.sh set-field <team-id> <experiment-id> <yq-path> <value>}"
  local exp_id="${2:?Missing experiment-id}"
  local path="${3:?Missing yq-path (e.g. intervention.status)}"
  local value="${4:?Missing value}"
  local file="$EXPERIMENTS_DIR/$team_id/$exp_id.yaml"
  [[ -f "$file" ]] || { echo "Error: experiment '$team_id/$exp_id' not found" >&2; exit 1; }
  yq -i ".$path = \"$value\"" "$file"
  echo "Updated $team_id/$exp_id: .$path = \"$value\""
}

cmd_set_action_status() {
  require_yq
  local team_id="${1:?Usage: experiments.sh set-action-status <team-id> <experiment-id> <action-title> <status>}"
  local exp_id="${2:?Missing experiment-id}"
  local title="${3:?Missing action-title}"
  local status="${4:?Missing status}"
  local file="$EXPERIMENTS_DIR/$team_id/$exp_id.yaml"
  [[ -f "$file" ]] || { echo "Error: experiment '$team_id/$exp_id' not found" >&2; exit 1; }
  yq -i "(.intervention.action-plan[] | select(.title == \"$title\") | .status) = \"$status\"" "$file"
  echo "Set action '$title' status → $status"
}

cmd_create() {
  local team_id="${1:?Usage: experiments.sh create <team-id> <experiment-id>}"
  local exp_id="${2:?Missing experiment-id}"
  local file="$EXPERIMENTS_DIR/$team_id/$exp_id.yaml"
  [[ ! -f "$file" ]] || { echo "Error: experiment '$team_id/$exp_id' already exists" >&2; exit 1; }
  mkdir -p "$EXPERIMENTS_DIR/$team_id"
  cat > "$file" <<EOF
context:
  problem_statement: >

  desired_outcome: >

hypothesis:
  statement: >

  assumptions: []
  risks: []
  risk_mitigations: []
intervention:
  practice_under_test:
  related_capabilities: []
  description: >

  success_criteria: []
  status: backlog
  start-date:
  expected-duration-in-weeks:
  action-plan: []
decision-roles:
  - responsible: []
  - accountable: []
  - consulted: []
  - informed: []
EOF
  echo "Created $file"
}

usage() {
  cat <<EOF
Usage: experiments.sh <command> [args]

Commands:
  list [team-id]                                             List experiments (all or by team)
  get <team-id> <experiment-id>                             Print experiment YAML
  set-status <team-id> <experiment-id> <status>             Update intervention.status
  set-field <team-id> <experiment-id> <yq-path> <value>    Set any field by dot-path
  set-action-status <team-id> <exp-id> <title> <status>    Update an action-plan item status
  create <team-id> <experiment-id>                          Create a new experiment file

Valid statuses: backlog, active, blocked, polish, pitch

Environment:
  Config: ~/.local/share/step-engine/config.json  (userDataDir key; falls back to ./examples)
EOF
}

cmd="${1:-help}"
shift || true
case "$cmd" in
  list) cmd_list "$@" ;;
  get) cmd_get "$@" ;;
  set-status) cmd_set_status "$@" ;;
  set-field) cmd_set_field "$@" ;;
  set-action-status) cmd_set_action_status "$@" ;;
  create) cmd_create "$@" ;;
  help|--help|-h) usage ;;
  *) echo "Unknown command: $cmd" >&2; usage >&2; exit 1 ;;
esac
