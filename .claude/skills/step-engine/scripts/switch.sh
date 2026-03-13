#!/usr/bin/env bash
# switch.sh — Switch the active Step Engine data source
#
# Searches for directories containing a .se-source file under the
# projectsDir set in config. Writes the selected path to config.json as
# userDataDir. All other scripts read from the same config, so no shell
# reload or eval is needed.
#
# Config file: ~/.local/share/step-engine/config.json
set -euo pipefail

CONFIG_FILE="$HOME/.local/share/step-engine/config.json"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../../../.." && pwd)"
BUILTIN_EXAMPLES="$PROJECT_ROOT/examples"
DOTENV_FILE="$PROJECT_ROOT/.env"

require_jq() {
  if ! command -v jq &>/dev/null; then
    echo "Error: jq is required. Install with: brew install jq" >&2
    exit 1
  fi
}

require_fzf() {
  if ! command -v fzf &>/dev/null; then
    echo "Error: fzf is required. Install with: brew install fzf" >&2
    exit 1
  fi
}

read_config() {
  local key="$1"
  [[ -f "$CONFIG_FILE" ]] || return 1
  jq -r ".$key // empty" "$CONFIG_FILE"
}

write_config() {
  local key="$1" value="$2"
  mkdir -p "$(dirname "$CONFIG_FILE")"
  if [[ -f "$CONFIG_FILE" ]]; then
    local tmp
    tmp=$(mktemp)
    jq --arg v "$value" ".$key = \$v" "$CONFIG_FILE" > "$tmp" && mv "$tmp" "$CONFIG_FILE"
  else
    jq -n --arg v "$value" "{\"$key\": \$v}" > "$CONFIG_FILE"
  fi
}

write_dotenv_userdata() {
  local value="$1"
  if [[ -f "$DOTENV_FILE" ]] && grep -q "^STEP_ENGINE_USER_DATA=" "$DOTENV_FILE"; then
    sed -i '' "s|^STEP_ENGINE_USER_DATA=.*|STEP_ENGINE_USER_DATA=$value|" "$DOTENV_FILE"
  else
    echo "STEP_ENGINE_USER_DATA=$value" >> "$DOTENV_FILE"
  fi
}

get_projects_dir() {
  local dir
  dir=$(read_config projectsDir) || true
  if [[ -z "$dir" ]]; then
    echo "Error: projectsDir is not set in $CONFIG_FILE" >&2
    echo "Run: se switch set-projects-dir <path>" >&2
    exit 1
  fi
  [[ -d "$dir" ]] || { echo "Error: projectsDir '$dir' does not exist" >&2; exit 1; }
  echo "$dir"
}

find_sentinel_dirs() {
  local sentinel_dirs=""
  if [[ -d "$BUILTIN_EXAMPLES" ]]; then
    sentinel_dirs="$BUILTIN_EXAMPLES"
  fi
  local projects_dir
  projects_dir=$(read_config projectsDir 2>/dev/null) || true
  if [[ -n "$projects_dir" && -d "$projects_dir" ]]; then
    local found
    found=$(find "$projects_dir" \
      -name ".se-source" \
      -not -path "*/node_modules/*" \
      -not -path "*/.git/*" \
      -not -path "*/dist/*" \
      2>/dev/null \
      | while IFS= read -r s; do dirname "$s"; done \
      | sort)
    if [[ -n "$found" ]]; then
      sentinel_dirs=$(printf '%s\n%s' "$sentinel_dirs" "$found" | grep -v '^$' | sort -u)
    fi
  fi
  echo "$sentinel_dirs"
}

cmd_list() {
  require_jq
  local dirs
  dirs=$(find_sentinel_dirs)
  local current
  current=$(read_config userDataDir) || true
  while IFS= read -r dir; do
    [[ -z "$dir" ]] && continue
    local label="$dir"
    [[ "$dir" == "$BUILTIN_EXAMPLES" ]] && label="$dir  (built-in examples)"
    if [[ "$dir" == "$current" ]]; then
      echo "* $label  (active)"
    else
      echo "  $label"
    fi
  done <<< "$dirs"
}

cmd_switch() {
  require_jq
  require_fzf
  local dirs
  dirs=$(find_sentinel_dirs)

  local current
  current=$(read_config userDataDir) || true
  local prompt="Step Engine data source"
  [[ -n "$current" ]] && prompt="$prompt  (current: $current)"

  local selected
  selected=$(echo "$dirs" | fzf \
    --prompt="$prompt > " \
    --preview="echo '--- Contents ---'; ls -1 {} 2>/dev/null; echo ''; if [[ -f {}/.se-source ]]; then content=\$(cat {}/.se-source); [[ -n \"\$content\" ]] && echo '--- Description ---' && echo \"\$content\"; fi" \
    --preview-window="right:45%:wrap" \
    --height="50%" \
    --layout="reverse" \
    --border \
    --bind="esc:abort" \
    2>/dev/tty) || { echo "No selection made." >&2; exit 0; }

  [[ -z "$selected" ]] && exit 0

  write_config userDataDir "$selected"
  write_dotenv_userdata "$selected"
  echo "Switched to: $selected"
  echo "Config updated: $CONFIG_FILE"
  echo ".env updated: $DOTENV_FILE"
}

cmd_set_projects_dir() {
  require_jq
  local path="${1:?Usage: switch.sh set-projects-dir <path>}"
  [[ -d "$path" ]] || { echo "Error: '$path' is not a directory" >&2; exit 1; }
  path="$(cd "$path" && pwd)"  # resolve to absolute
  write_config projectsDir "$path"
  echo "projectsDir set to: $path"
  echo "Config updated: $CONFIG_FILE"
}

cmd_show() {
  require_jq
  if [[ ! -f "$CONFIG_FILE" ]]; then
    echo "No config found at $CONFIG_FILE"
    exit 0
  fi
  echo "Config: $CONFIG_FILE"
  echo ""
  jq '.' "$CONFIG_FILE"
}

usage() {
  cat <<EOF
Usage: switch.sh [command]

Commands:
  (none)                      Open fzf picker to select a data source
  list                        List all registered data sources
  set-projects-dir <path>     Set the directory to search for sentinel files
  show                        Print current config

Config file: $CONFIG_FILE
  userDataDir    Active data root (read by all other scripts)
  projectsDir    Directory searched for .se-source files

Registering a data source:
  touch /path/to/client-data/.se-source
  # Optionally add a description (shown in fzf preview):
  echo "Acme Corp — production" > /path/to/client-data/.se-source

First-time setup:
  bash .claude/skills/step-engine/scripts/switch.sh set-projects-dir ~/Projects
  bash .claude/skills/step-engine/scripts/switch.sh
EOF
}

cmd="${1:-switch}"
shift || true
case "$cmd" in
  switch) cmd_switch ;;
  list) cmd_list ;;
  set-projects-dir) cmd_set_projects_dir "$@" ;;
  show) cmd_show ;;
  help|--help|-h) usage ;;
  *) echo "Unknown command: $cmd" >&2; usage >&2; exit 1 ;;
esac
