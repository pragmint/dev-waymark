# switch.sh

Switch the active data source by updating `~/.local/share/step-engine/config.json`.

All other scripts read `userDataDir` from the same config file, so switching takes effect immediately — no shell reload or eval needed.

## Config file

`~/.local/share/step-engine/config.json`

```json
{
  "userDataDir": "/path/to/active/data",
  "projectsDir": "/path/to/your/projects"
}
```

## Commands

```bash
bash .claude/skills/step-engine/scripts/switch.sh                         # fzf picker
bash .claude/skills/step-engine/scripts/switch.sh list                    # list all sources
bash .claude/skills/step-engine/scripts/switch.sh set-projects-dir <path> # set search root
bash .claude/skills/step-engine/scripts/switch.sh show                    # print current config
```

## First-time setup

```bash
# 1. Set the directory to search for sentinel files
bash .claude/skills/step-engine/scripts/switch.sh set-projects-dir ~/Projects

# 2. Open the picker and select a data source
bash .claude/skills/step-engine/scripts/switch.sh
```

## Registering a data source

Place a `.se-source` file in any directory you want to appear in the picker. It can be empty, or contain a short description shown in the fzf preview pane:

```bash
touch /path/to/client-data/.se-source
# or with a description:
echo "Acme Corp — production" > /path/to/client-data/.se-source
```

## Requirements

- `jq` for config reads/writes (`brew install jq`)
- `fzf` for the interactive picker (`brew install fzf`)
