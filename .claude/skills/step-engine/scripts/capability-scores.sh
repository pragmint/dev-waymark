#!/usr/bin/env bash
# capability-scores.sh — Get and set capability score metrics
# Usage: ./capability-scores.sh <command> [args]
#
# Data structure per file:
#   data:
#     - team: team-a
#       date: 27.1.2026
#       value:
#         - metric-key: 3
#         - other-key: 2
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
SCORES_DIR="$DATA_DIR/metrics/capability_scores"

require_yq() {
  if ! command -v yq &>/dev/null; then
    echo "Error: yq is required. Install with: brew install yq" >&2
    exit 1
  fi
}

cmd_list() {
  for f in "$SCORES_DIR"/*.yaml; do
    [[ -f "$f" ]] || continue
    basename "$f" .yaml
  done
}

cmd_get() {
  local capability="${1:?Usage: capability-scores.sh get <capability>}"
  local file="$SCORES_DIR/$capability.yaml"
  [[ -f "$file" ]] || { echo "Error: capability '$capability' not found" >&2; exit 1; }
  cat "$file"
}

cmd_list_entries() {
  require_yq
  local capability="${1:?Usage: capability-scores.sh list-entries <capability>}"
  local file="$SCORES_DIR/$capability.yaml"
  [[ -f "$file" ]] || { echo "Error: capability '$capability' not found" >&2; exit 1; }
  echo "team | date"
  echo "-----|-----"
  yq '.data[] | .team + " | " + .date' "$file"
}

# add-entry <capability> <team> <date> [key=value ...]
# Example: ./capability-scores.sh add-entry continuous-delivery team-a 1.2.2026 value-delivery-frequency=3 lead-time-for-changes=2
cmd_add_entry() {
  require_yq
  local capability="${1:?Usage: capability-scores.sh add-entry <capability> <team> <date> [key=value ...]}"
  local team="${2:?Missing team}"
  local date="${3:?Missing date}"
  shift 3

  local file="$SCORES_DIR/$capability.yaml"
  [[ -f "$file" ]] || { echo "Error: capability '$capability' not found" >&2; exit 1; }

  # Check for duplicate team+date
  if yq -e ".data[] | select(.team == \"$team\" and .date == \"$date\")" "$file" &>/dev/null; then
    echo "Error: entry for team='$team' date='$date' already exists. Use update-entry instead." >&2
    exit 1
  fi

  # Build the value array from key=value pairs
  local value_expr="[]"
  for pair in "$@"; do
    local key="${pair%%=*}"
    local val="${pair#*=}"
    value_expr="$value_expr + [{\"$key\": $val}]"
  done

  yq -i ".data += [{\"team\": \"$team\", \"date\": \"$date\", \"value\": $value_expr}]" "$file"
  echo "Added entry: $capability / $team / $date"
}

# update-entry <capability> <team> <date> [key=value ...]
# Updates the value array for a matching team+date entry
cmd_update_entry() {
  require_yq
  local capability="${1:?Usage: capability-scores.sh update-entry <capability> <team> <date> [key=value ...]}"
  local team="${2:?Missing team}"
  local date="${3:?Missing date}"
  shift 3

  local file="$SCORES_DIR/$capability.yaml"
  [[ -f "$file" ]] || { echo "Error: capability '$capability' not found" >&2; exit 1; }

  if ! yq -e ".data[] | select(.team == \"$team\" and .date == \"$date\")" "$file" &>/dev/null; then
    echo "Error: entry for team='$team' date='$date' not found. Use add-entry instead." >&2
    exit 1
  fi

  local value_expr="[]"
  for pair in "$@"; do
    local key="${pair%%=*}"
    local val="${pair#*=}"
    value_expr="$value_expr + [{\"$key\": $val}]"
  done

  yq -i "(.data[] | select(.team == \"$team\" and .date == \"$date\") | .value) = $value_expr" "$file"
  echo "Updated entry: $capability / $team / $date"
}

cmd_delete_entry() {
  require_yq
  local capability="${1:?Usage: capability-scores.sh delete-entry <capability> <team> <date>}"
  local team="${2:?Missing team}"
  local date="${3:?Missing date}"
  local file="$SCORES_DIR/$capability.yaml"
  [[ -f "$file" ]] || { echo "Error: capability '$capability' not found" >&2; exit 1; }
  yq -i "del(.data[] | select(.team == \"$team\" and .date == \"$date\"))" "$file"
  echo "Deleted entry: $capability / $team / $date"
}

usage() {
  cat <<EOF
Usage: capability-scores.sh <command> [args]

Commands:
  list                                              List all capability names
  get <capability>                                  Print full YAML for a capability
  list-entries <capability>                         List all team/date entries
  add-entry <capability> <team> <date> [k=v ...]   Add a new data entry
  update-entry <capability> <team> <date> [k=v ...] Update values for an existing entry
  delete-entry <capability> <team> <date>           Remove a data entry

Examples:
  ./capability-scores.sh list
  ./capability-scores.sh get continuous-delivery
  ./capability-scores.sh list-entries continuous-delivery
  ./capability-scores.sh add-entry continuous-delivery team-a 1.2.2026 value-delivery-frequency=3 lead-time-for-changes=2
  ./capability-scores.sh update-entry continuous-delivery team-a 27.1.2026 value-delivery-frequency=4

Environment:
  Config: ~/.local/share/step-engine/config.json  (userDataDir key; falls back to ./examples)
EOF
}

cmd="${1:-help}"
shift || true
case "$cmd" in
  list) cmd_list ;;
  get) cmd_get "$@" ;;
  list-entries) cmd_list_entries "$@" ;;
  add-entry) cmd_add_entry "$@" ;;
  update-entry) cmd_update_entry "$@" ;;
  delete-entry) cmd_delete_entry "$@" ;;
  help|--help|-h) usage ;;
  *) echo "Unknown command: $cmd" >&2; usage >&2; exit 1 ;;
esac
