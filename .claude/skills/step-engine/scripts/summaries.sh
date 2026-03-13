#!/usr/bin/env bash
# summaries.sh — Get and set weekly summary markdown files
# Usage: ./summaries.sh <command> [args]
#
# Files are named D.M.YYYY.md (e.g. 16.1.2026.md)
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
SUMMARIES_DIR="$DATA_DIR/summaries"

cmd_list() {
  for f in "$SUMMARIES_DIR"/*.md; do
    [[ -f "$f" ]] || continue
    basename "$f" .md
  done
}

cmd_get() {
  local date="${1:?Usage: summaries.sh get <date>  (e.g. 16.1.2026)}"
  local file="$SUMMARIES_DIR/$date.md"
  [[ -f "$file" ]] || { echo "Error: summary '$date' not found" >&2; exit 1; }
  cat "$file"
}

# set: write summary content from stdin
# Usage: echo "content" | ./summaries.sh set <date>
#        ./summaries.sh set <date> < content.md
cmd_set() {
  local date="${1:?Usage: summaries.sh set <date>  (reads content from stdin)}"
  mkdir -p "$SUMMARIES_DIR"
  local file="$SUMMARIES_DIR/$date.md"
  cat > "$file"
  echo "Written to $file"
}

# set-file: write summary from an existing file
cmd_set_file() {
  local date="${1:?Usage: summaries.sh set-file <date> <source-file>}"
  local source="${2:?Missing source file path}"
  [[ -f "$source" ]] || { echo "Error: source file '$source' not found" >&2; exit 1; }
  mkdir -p "$SUMMARIES_DIR"
  local file="$SUMMARIES_DIR/$date.md"
  cp "$source" "$file"
  echo "Copied '$source' → $file"
}

# edit: open in $EDITOR (falls back to vi)
cmd_edit() {
  local date="${1:?Usage: summaries.sh edit <date>}"
  mkdir -p "$SUMMARIES_DIR"
  local file="$SUMMARIES_DIR/$date.md"
  if [[ ! -f "$file" ]]; then
    cat > "$file" <<EOF
**Overview:**

**Key Highlights:**

**Areas of Focus:**

**Next Steps:**
EOF
    echo "Created $file"
  fi
  "${EDITOR:-vi}" "$file"
}

cmd_delete() {
  local date="${1:?Usage: summaries.sh delete <date>}"
  local file="$SUMMARIES_DIR/$date.md"
  [[ -f "$file" ]] || { echo "Error: summary '$date' not found" >&2; exit 1; }
  rm "$file"
  echo "Deleted $file"
}

usage() {
  cat <<EOF
Usage: summaries.sh <command> [args]

Commands:
  list                       List all summary dates
  get <date>                 Print summary content
  set <date>                 Write summary from stdin
  set-file <date> <file>     Write summary from a file
  edit <date>                Open summary in \$EDITOR (creates if missing)
  delete <date>              Delete a summary

Date format: D.M.YYYY  (e.g. 16.1.2026)

Examples:
  ./summaries.sh list
  ./summaries.sh get 16.1.2026
  echo "My summary" | ./summaries.sh set 1.2.2026
  ./summaries.sh set-file 1.2.2026 /tmp/draft.md
  ./summaries.sh edit 1.2.2026

Environment:
  Config: ~/.local/share/step-engine/config.json  (userDataDir key; falls back to ./examples)
  EDITOR      Editor for the edit command (default: vi)
EOF
}

cmd="${1:-help}"
shift || true
case "$cmd" in
  list) cmd_list ;;
  get) cmd_get "$@" ;;
  set) cmd_set "$@" ;;
  set-file) cmd_set_file "$@" ;;
  edit) cmd_edit "$@" ;;
  delete) cmd_delete "$@" ;;
  help|--help|-h) usage ;;
  *) echo "Unknown command: $cmd" >&2; usage >&2; exit 1 ;;
esac
