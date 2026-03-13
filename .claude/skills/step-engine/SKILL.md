---
name: step-engine
description: >
  Manages data in the Step Engine examples directory — teams, experiments, capability
  scores, team-specific metrics, and weekly summaries. Use this skill whenever the user
  wants to read, create, update, or delete any of that data, add data points to a metric,
  change an experiment's status, record capability scores, or write a summary.
---

# Step Engine Data Scripts

You are managing structured data in the `examples/` directory (or `$STEP_ENGINE_USER_DATA` if set). Use the bash scripts in `.claude/skills/step-engine/scripts/` to read and write data — do not edit YAML or markdown files manually unless a script cannot accomplish the task.

## Triggers

Use this skill when the user wants to:
- Read, list, create, or update teams, experiments, capability scores, metrics, or summaries
- Add or modify data points, entries, or fields in any of the above
- Query what data exists (e.g. "what experiments does team_a have?")
- Perform bulk or multi-step data operations

## Prerequisites

Before any write operation, confirm `yq` is available:
```bash
command -v yq || echo "yq not found — install with: brew install yq"
```
If missing, tell the user and stop. Read-only commands (`list`, `get`) do not require `yq`.

## Running Scripts

All scripts must be run from the **project root**. Use this path pattern:
```bash
bash .claude/skills/step-engine/scripts/<script-name>.sh <command> [args]
```

## Configuration

Scripts read from `~/.local/share/step-engine/config.json`:

```json
{
  "userDataDir": "/path/to/active/data",
  "projectsDir": "/path/to/projects"
}
```

- `userDataDir` — the active data root used by all data scripts. Falls back to `./examples` if not set.
- `projectsDir` — the directory `switch.sh` searches for `.se-source` files.

This file is managed by `switch.sh` and is not directly accessible to Claude. If scripts appear to be operating on the wrong directory, ask the user to run `switch.sh show` to confirm the current config.

## Intent → Script Mapping

| User wants to... | Script |
|---|---|
| List, view, create, or update a team | `teams.sh` |
| Add/remove a targeted capability from a team | `teams.sh` |
| List, view, create, or update an experiment | `experiments.sh` |
| Change an experiment's status or action item | `experiments.sh` |
| View or update organisation-wide capability scores | `capability-scores.sh` |
| View or update a team's own metric time series | `team-metrics.sh` |
| Read or write a weekly summary | `summaries.sh` |
| Gather all data for a week / generate a summary | `gather-week.sh` |
| Switch which client/project data is active | `switch.sh` |

Full command references: [teams](resources/teams.md) · [experiments](resources/experiments.md) · [capability-scores](resources/capability-scores.md) · [team-metrics](resources/team-metrics.md) · [summaries](resources/summaries.md) · [gather-week](resources/gather-week.md) · [switch](resources/switch.md)

## Common Multi-Step Workflows

**Generate a weekly summary:**
```bash
# 1. Gather all data for the week
bash .claude/skills/step-engine/scripts/gather-week.sh 16.1.2026
# 2. Synthesize the output into summary format, then write it
bash .claude/skills/step-engine/scripts/summaries.sh set 16.1.2026 <<'EOF'
**Overview:** ...
**Key Highlights:** ...
**Areas of Focus:** ...
**Next Steps:** ...
EOF
```

**Create a new team with metrics:**
```bash
bash .claude/skills/step-engine/scripts/teams.sh create team-d "Team D"
bash .claude/skills/step-engine/scripts/team-metrics.sh create team_d linter-error-count
bash .claude/skills/step-engine/scripts/team-metrics.sh create team_d test-coverage
```

**Move an experiment through its lifecycle:**
```bash
# Activate a backlog experiment
bash .claude/skills/step-engine/scripts/experiments.sh set-status team_a my-experiment active
# Mark an action item complete
bash .claude/skills/step-engine/scripts/experiments.sh set-action-status team_a my-experiment "Action title" complete
```

**Record a new round of capability scores:**
```bash
bash .claude/skills/step-engine/scripts/capability-scores.sh add-entry continuous-delivery team-a 1.2.2026 value-delivery-frequency=3 lead-time-for-changes=2
bash .claude/skills/step-engine/scripts/capability-scores.sh add-entry continuous-delivery team-b 1.2.2026 value-delivery-frequency=2 lead-time-for-changes=3
```

## Interaction Pattern

1. Run the relevant script(s)
2. If a write succeeded, confirm what changed (e.g. "Added entry for team-a on 1.2.2026")
3. If the user asks to see the result, follow up with a `get` command and display the output
4. If a command fails, show the error and suggest a fix before retrying

## Boundaries

This skill only manages **data files** in `examples/` (or `$STEP_ENGINE_USER_DATA`). It does not:
- Modify source code, schemas, parsers, or loaders
- Add new capability or practice definitions to `resources/`
- Change the structure of YAML schemas
- Handle anything outside the five data categories above
