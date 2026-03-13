#!/usr/bin/env bash
# gather-week.sh — Aggregate all data relevant to a given week
# Usage: ./gather-week.sh <date>
#
# Accepts any date within the target week (D.M.YYYY). Outputs all experiments
# active that week, capability scores recorded that week, and team metrics
# recorded that week — structured for use as summary generation context.
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

require_yq() {
  if ! command -v yq &>/dev/null; then
    echo "Error: yq is required. Install with: brew install yq" >&2
    exit 1
  fi
}

# Parse D.M.YYYY → epoch (midnight, macOS date)
parse_date() {
  local d="$1"
  [[ -z "$d" || "$d" == "null" ]] && return 1
  local day month year
  IFS='.' read -r day month year <<< "$d"
  [[ -n "$year" ]] || return 1
  local padded
  printf -v padded "%02d.%02d.%04d" "$day" "$month" "$year"
  date -j -f "%d.%m.%Y %H:%M:%S" "$padded 00:00:00" "+%s" 2>/dev/null || return 1
}

# Format epoch → D.M.YYYY (no leading zeros)
format_date() {
  date -j -r "$1" "+%-d.%-m.%Y"
}

# Return 0 if D.M.YYYY date string falls within [week_start, week_end] epochs
in_week() {
  local date_str="$1" week_start="$2" week_end="$3"
  local epoch
  epoch=$(parse_date "$date_str") || return 1
  [[ "$epoch" -ge "$week_start" && "$epoch" -le "$week_end" ]]
}

# Given an epoch, return "week_start week_end" for Mon–Sun containing that date
get_week_bounds() {
  local epoch="$1"
  local dow
  dow=$(date -j -r "$epoch" "+%u")  # 1=Mon … 7=Sun
  local mon_epoch=$(( epoch - (dow - 1) * 86400 ))
  # Re-normalise to midnight in case of DST drift
  local mon_date
  mon_date=$(date -j -r "$mon_epoch" "+%d.%m.%Y")
  local week_start
  week_start=$(date -j -f "%d.%m.%Y %H:%M:%S" "$mon_date 00:00:00" "+%s")
  local week_end=$(( week_start + 7 * 86400 - 1 ))
  echo "$week_start $week_end"
}

gather_experiments() {
  local week_start="$1" week_end="$2"
  local section_printed=0

  for team_dir in "$DATA_DIR/experiments"/*/; do
    [[ -d "$team_dir" ]] || continue
    local team_id
    team_id="$(basename "$team_dir")"

    for exp_file in "$team_dir"*.yaml; do
      [[ -f "$exp_file" ]] || continue
      local exp_id
      exp_id="$(basename "$exp_file" .yaml)"

      local status start_date
      status=$(yq '.intervention.status' "$exp_file")
      start_date=$(yq '.intervention.start-date' "$exp_file")
      [[ "$start_date" == "null" ]] && start_date=""

      # Include if in-progress status, OR started during this week
      local include=0
      case "$status" in
        active|blocked|polish) include=1 ;;
      esac
      if [[ "$include" -eq 0 ]] && [[ -n "$start_date" ]] && in_week "$start_date" "$week_start" "$week_end"; then
        include=1
      fi
      [[ "$include" -eq 1 ]] || continue

      if [[ "$section_printed" -eq 0 ]]; then
        echo "=== EXPERIMENTS (active this week) ==="
        section_printed=1
      fi

      echo ""
      echo "$team_id / $exp_id  [status: $status]"

      local practice duration
      practice=$(yq '.intervention.practice_under_test' "$exp_file")
      duration=$(yq '.intervention.expected-duration-in-weeks' "$exp_file")
      [[ "$practice" != "null" && -n "$practice" ]] && echo "  practice: $practice"

      if [[ -n "$start_date" ]]; then
        local start_epoch weeks_in=""
        start_epoch=$(parse_date "$start_date") || true
        if [[ -n "$start_epoch" && "$duration" != "null" ]]; then
          local n=$(( (week_start - start_epoch) / 86400 / 7 + 1 ))
          [[ "$n" -ge 1 ]] && weeks_in=" (week $n of $duration)"
        fi
        echo "  started: $start_date$weeks_in"
      fi

      # Related capabilities
      local cap_count
      cap_count=$(yq '.intervention.related_capabilities | length' "$exp_file")
      if [[ "$cap_count" -gt 0 ]]; then
        local caps
        caps=$(yq '.intervention.related_capabilities | join(", ")' "$exp_file")
        echo "  capabilities: $caps"
      fi

      # Action plan
      local action_count
      action_count=$(yq '.intervention.action-plan | length' "$exp_file")
      if [[ "$action_count" -gt 0 ]]; then
        echo "  action plan:"
        yq '.intervention.action-plan[] | "    [" + .status + "] " + .title' "$exp_file"
      fi
    done
  done

  [[ "$section_printed" -eq 1 ]] && echo ""
}

gather_capability_scores() {
  local week_start="$1" week_end="$2"
  local section_printed=0

  for score_file in "$DATA_DIR/metrics/capability_scores"/*.yaml; do
    [[ -f "$score_file" ]] || continue
    local capability
    capability="$(basename "$score_file" .yaml)"

    local entry_count
    entry_count=$(yq '.data | length' "$score_file")
    local cap_printed=0

    for (( i=0; i<entry_count; i++ )); do
      local entry_date entry_team
      entry_date=$(yq ".data[$i].date" "$score_file")
      entry_team=$(yq ".data[$i].team" "$score_file")

      in_week "$entry_date" "$week_start" "$week_end" || continue

      if [[ "$section_printed" -eq 0 ]]; then
        echo "=== CAPABILITY SCORES (recorded this week) ==="
        section_printed=1
      fi
      if [[ "$cap_printed" -eq 0 ]]; then
        echo ""
        echo "[$capability]"
        cap_printed=1
      fi

      echo "  $entry_team ($entry_date):"
      yq ".data[$i].value[] | to_entries[] | \"    \" + .key + \": \" + (.value | tostring)" "$score_file"
    done
  done

  [[ "$section_printed" -eq 1 ]] && echo ""
}

gather_team_metrics() {
  local week_start="$1" week_end="$2"
  local section_printed=0

  for team_dir in "$DATA_DIR/metrics/team_specific"/*/; do
    [[ -d "$team_dir" ]] || continue
    local team_id
    team_id="$(basename "$team_dir")"

    for metric_file in "$team_dir"*.yaml; do
      [[ -f "$metric_file" ]] || continue
      local metric_id
      metric_id="$(basename "$metric_file" .yaml)"

      local entry_count
      entry_count=$(yq '.data | length' "$metric_file")
      local metric_printed=0

      for (( i=0; i<entry_count; i++ )); do
        local entry_date entry_value
        entry_date=$(yq ".data[$i].date" "$metric_file")
        entry_value=$(yq ".data[$i].value" "$metric_file")

        in_week "$entry_date" "$week_start" "$week_end" || continue

        if [[ "$section_printed" -eq 0 ]]; then
          echo "=== TEAM METRICS (recorded this week) ==="
          section_printed=1
        fi
        if [[ "$metric_printed" -eq 0 ]]; then
          echo ""
          echo "$team_id / $metric_id"
          metric_printed=1
        fi

        echo "  $entry_date: $entry_value"
      done
    done
  done

  [[ "$section_printed" -eq 1 ]] && echo ""
}

usage() {
  cat <<EOF
Usage: gather-week.sh <date>

Collects all data for the week containing <date> and prints it to stdout.
The output is structured context for generating a weekly summary.

Arguments:
  date    Any date within the target week, in D.M.YYYY format (e.g. 16.1.2026)

Output sections:
  EXPERIMENTS          Active/blocked/polish experiments, or started this week
  CAPABILITY SCORES    Entries recorded during the week
  TEAM METRICS         Entries recorded during the week

Generating a summary:
  bash .claude/skills/step-engine/scripts/gather-week.sh 16.1.2026
  # Then ask Claude to synthesize the output and write the summary:
  # bash .claude/skills/step-engine/scripts/summaries.sh set 16.1.2026 <<'EOF'
  # ... generated content ...
  # EOF

Environment:
  Config: ~/.local/share/step-engine/config.json  (userDataDir key; falls back to ./examples)
EOF
}

case "${1:-}" in
  help|--help|-h) usage; exit 0 ;;
esac

INPUT_DATE="${1:?Usage: gather-week.sh <date>  (e.g. 16.1.2026)}"
require_yq

INPUT_EPOCH=$(parse_date "$INPUT_DATE") || {
  echo "Error: cannot parse '$INPUT_DATE' — use D.M.YYYY format (e.g. 16.1.2026)" >&2
  exit 1
}

read -r WEEK_START WEEK_END <<< "$(get_week_bounds "$INPUT_EPOCH")"

echo "WEEK: $(format_date "$WEEK_START") – $(format_date "$WEEK_END")"
echo ""
gather_experiments "$WEEK_START" "$WEEK_END"
gather_capability_scores "$WEEK_START" "$WEEK_END"
gather_team_metrics "$WEEK_START" "$WEEK_END"
