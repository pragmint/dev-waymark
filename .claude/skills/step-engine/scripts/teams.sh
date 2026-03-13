#!/usr/bin/env bash
# teams.sh — Get and set team data
# Usage: ./teams.sh <command> [args]
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
TEAMS_DIR="$DATA_DIR/teams"

require_yq() {
  if ! command -v yq &>/dev/null; then
    echo "Error: yq is required. Install with: brew install yq" >&2
    exit 1
  fi
}

cmd_list() {
  for f in "$TEAMS_DIR"/*.yaml; do
    [[ -f "$f" ]] || continue
    basename "$f" .yaml
  done
}

cmd_get() {
  local team_id="${1:?Usage: teams.sh get <team-id>}"
  local file="$TEAMS_DIR/$team_id.yaml"
  [[ -f "$file" ]] || { echo "Error: team '$team_id' not found" >&2; exit 1; }
  cat "$file"
}

cmd_set_field() {
  require_yq
  local team_id="${1:?Usage: teams.sh set-field <team-id> <field> <value>}"
  local field="${2:?Missing field}"
  local value="${3:?Missing value}"
  local file="$TEAMS_DIR/$team_id.yaml"
  [[ -f "$file" ]] || { echo "Error: team '$team_id' not found" >&2; exit 1; }
  yq -i ".$field = \"$value\"" "$file"
  echo "Updated $team_id: .$field = \"$value\""
}

cmd_add_capability() {
  require_yq
  local team_id="${1:?Usage: teams.sh add-capability <team-id> <capability>}"
  local capability="${2:?Missing capability}"
  local file="$TEAMS_DIR/$team_id.yaml"
  [[ -f "$file" ]] || { echo "Error: team '$team_id' not found" >&2; exit 1; }
  if yq -e ".targetedCapabilities[] | select(. == \"$capability\")" "$file" &>/dev/null; then
    echo "Capability '$capability' already present in $team_id" >&2
    exit 1
  fi
  yq -i ".targetedCapabilities += [\"$capability\"]" "$file"
  echo "Added '$capability' to $team_id"
}

cmd_remove_capability() {
  require_yq
  local team_id="${1:?Usage: teams.sh remove-capability <team-id> <capability>}"
  local capability="${2:?Missing capability}"
  local file="$TEAMS_DIR/$team_id.yaml"
  [[ -f "$file" ]] || { echo "Error: team '$team_id' not found" >&2; exit 1; }
  yq -i ".targetedCapabilities -= [\"$capability\"]" "$file"
  echo "Removed '$capability' from $team_id"
}

cmd_create() {
  local team_id="${1:?Usage: teams.sh create <team-id> <name>}"
  local name="${2:?Missing name}"
  local file="$TEAMS_DIR/$team_id.yaml"
  [[ ! -f "$file" ]] || { echo "Error: team '$team_id' already exists" >&2; exit 1; }
  mkdir -p "$TEAMS_DIR"
  cat > "$file" <<EOF
id: $team_id
name: $name
description: >

targetedCapabilities: []
EOF
  echo "Created $file"
}

usage() {
  cat <<EOF
Usage: teams.sh <command> [args]

Commands:
  list                                    List all team IDs
  get <team-id>                           Print team YAML
  set-field <team-id> <field> <value>     Set a top-level field (requires yq)
  add-capability <team-id> <capability>   Append a targeted capability (requires yq)
  remove-capability <team-id> <cap>       Remove a targeted capability (requires yq)
  create <team-id> <name>                 Create a new team file

Environment:
  Config: ~/.local/share/step-engine/config.json  (userDataDir key; falls back to ./examples)
EOF
}

cmd="${1:-help}"
shift || true
case "$cmd" in
  list) cmd_list ;;
  get) cmd_get "$@" ;;
  set-field) cmd_set_field "$@" ;;
  add-capability) cmd_add_capability "$@" ;;
  remove-capability) cmd_remove_capability "$@" ;;
  create) cmd_create "$@" ;;
  help|--help|-h) usage ;;
  *) echo "Unknown command: $cmd" >&2; usage >&2; exit 1 ;;
esac
