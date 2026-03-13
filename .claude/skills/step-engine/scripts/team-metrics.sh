#!/usr/bin/env bash
# team-metrics.sh — Get and set team-specific metric data
# Usage: ./team-metrics.sh <command> [args]
#
# Data structure per file:
#   data:
#     - date: 9.1.2026
#       value: 65
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
METRICS_DIR="$DATA_DIR/metrics/team_specific"

require_yq() {
  if ! command -v yq &>/dev/null; then
    echo "Error: yq is required. Install with: brew install yq" >&2
    exit 1
  fi
}

cmd_list() {
  local team_id="${1:-}"
  if [[ -n "$team_id" ]]; then
    local dir="$METRICS_DIR/$team_id"
    [[ -d "$dir" ]] || { echo "Error: no metrics found for team '$team_id'" >&2; exit 1; }
    for f in "$dir"/*.yaml; do
      [[ -f "$f" ]] || continue
      basename "$f" .yaml
    done
  else
    for dir in "$METRICS_DIR"/*/; do
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
  local team_id="${1:?Usage: team-metrics.sh get <team-id> <metric>}"
  local metric="${2:?Missing metric}"
  local file="$METRICS_DIR/$team_id/$metric.yaml"
  [[ -f "$file" ]] || { echo "Error: metric '$team_id/$metric' not found" >&2; exit 1; }
  cat "$file"
}

cmd_list_entries() {
  require_yq
  local team_id="${1:?Usage: team-metrics.sh list-entries <team-id> <metric>}"
  local metric="${2:?Missing metric}"
  local file="$METRICS_DIR/$team_id/$metric.yaml"
  [[ -f "$file" ]] || { echo "Error: metric '$team_id/$metric' not found" >&2; exit 1; }
  echo "date | value"
  echo "-----|------"
  yq '.data[] | .date + " | " + (.value | tostring)' "$file"
}

cmd_add_entry() {
  require_yq
  local team_id="${1:?Usage: team-metrics.sh add-entry <team-id> <metric> <date> <value>}"
  local metric="${2:?Missing metric}"
  local date="${3:?Missing date}"
  local value="${4:?Missing value}"
  local file="$METRICS_DIR/$team_id/$metric.yaml"
  [[ -f "$file" ]] || { echo "Error: metric '$team_id/$metric' not found" >&2; exit 1; }

  if yq -e ".data[] | select(.date == \"$date\")" "$file" &>/dev/null; then
    echo "Error: entry for date='$date' already exists. Use update-entry instead." >&2
    exit 1
  fi

  yq -i ".data += [{\"date\": \"$date\", \"value\": $value}]" "$file"
  echo "Added entry: $team_id/$metric / $date = $value"
}

cmd_update_entry() {
  require_yq
  local team_id="${1:?Usage: team-metrics.sh update-entry <team-id> <metric> <date> <value>}"
  local metric="${2:?Missing metric}"
  local date="${3:?Missing date}"
  local value="${4:?Missing value}"
  local file="$METRICS_DIR/$team_id/$metric.yaml"
  [[ -f "$file" ]] || { echo "Error: metric '$team_id/$metric' not found" >&2; exit 1; }

  if ! yq -e ".data[] | select(.date == \"$date\")" "$file" &>/dev/null; then
    echo "Error: entry for date='$date' not found. Use add-entry instead." >&2
    exit 1
  fi

  yq -i "(.data[] | select(.date == \"$date\") | .value) = $value" "$file"
  echo "Updated entry: $team_id/$metric / $date = $value"
}

cmd_delete_entry() {
  require_yq
  local team_id="${1:?Usage: team-metrics.sh delete-entry <team-id> <metric> <date>}"
  local metric="${2:?Missing metric}"
  local date="${3:?Missing date}"
  local file="$METRICS_DIR/$team_id/$metric.yaml"
  [[ -f "$file" ]] || { echo "Error: metric '$team_id/$metric' not found" >&2; exit 1; }
  yq -i "del(.data[] | select(.date == \"$date\"))" "$file"
  echo "Deleted entry: $team_id/$metric / $date"
}

cmd_create() {
  local team_id="${1:?Usage: team-metrics.sh create <team-id> <metric>}"
  local metric="${2:?Missing metric}"
  local file="$METRICS_DIR/$team_id/$metric.yaml"
  [[ ! -f "$file" ]] || { echo "Error: metric '$team_id/$metric' already exists" >&2; exit 1; }
  mkdir -p "$METRICS_DIR/$team_id"
  cat > "$file" <<EOF
data: []
EOF
  echo "Created $file"
}

usage() {
  cat <<EOF
Usage: team-metrics.sh <command> [args]

Commands:
  list [team-id]                                   List metrics (all or by team)
  get <team-id> <metric>                            Print metric YAML
  list-entries <team-id> <metric>                   List all date/value entries
  add-entry <team-id> <metric> <date> <value>       Add a new data point
  update-entry <team-id> <metric> <date> <value>    Update an existing data point
  delete-entry <team-id> <metric> <date>            Remove a data point
  create <team-id> <metric>                         Create a new metric file

Examples:
  ./team-metrics.sh list team_a
  ./team-metrics.sh get team_a test-coverage
  ./team-metrics.sh list-entries team_a linter-error-count
  ./team-metrics.sh add-entry team_a test-coverage 1.2.2026 72.5
  ./team-metrics.sh update-entry team_a test-coverage 13.1.2026 71.0

Environment:
  Config: ~/.local/share/step-engine/config.json  (userDataDir key; falls back to ./examples)
EOF
}

cmd="${1:-help}"
shift || true
case "$cmd" in
  list) cmd_list "$@" ;;
  get) cmd_get "$@" ;;
  list-entries) cmd_list_entries "$@" ;;
  add-entry) cmd_add_entry "$@" ;;
  update-entry) cmd_update_entry "$@" ;;
  delete-entry) cmd_delete_entry "$@" ;;
  create) cmd_create "$@" ;;
  help|--help|-h) usage ;;
  *) echo "Unknown command: $cmd" >&2; usage >&2; exit 1 ;;
esac
