# team-metrics.sh

Manage team-specific metric time series files.

**Data:** `$STEP_ENGINE_USER_DATA/metrics/team_specific/{team-id}/{metric}.yaml`

> **Team ID format:** use underscores — `team_a`, `team_b`
> **Date format:** `D.M.YYYY` — e.g. `9.1.2026`, `1.2.2026`

## YAML structure

```yaml
data:
  - date: 9.1.2026
    value: 65
  - date: 10.1.2026
    value: 67.5
```

Values are numeric (integer or float).

## Commands

```bash
bash .claude/skills/step-engine/scripts/team-metrics.sh list [team-id]
bash .claude/skills/step-engine/scripts/team-metrics.sh get <team-id> <metric>
bash .claude/skills/step-engine/scripts/team-metrics.sh list-entries <team-id> <metric>
bash .claude/skills/step-engine/scripts/team-metrics.sh add-entry <team-id> <metric> <date> <value>
bash .claude/skills/step-engine/scripts/team-metrics.sh update-entry <team-id> <metric> <date> <value>
bash .claude/skills/step-engine/scripts/team-metrics.sh delete-entry <team-id> <metric> <date>
bash .claude/skills/step-engine/scripts/team-metrics.sh create <team-id> <metric>
```

## Notes

- `add-entry` will error if `date` already exists — use `update-entry` instead
- Metric names use hyphens: `linter-error-count`, `test-coverage`, `production-bug-count`
- Run `list <team-id>` to see what metrics exist for a team before adding entries

## Examples

```bash
bash .claude/skills/step-engine/scripts/team-metrics.sh list
bash .claude/skills/step-engine/scripts/team-metrics.sh list team_a
bash .claude/skills/step-engine/scripts/team-metrics.sh get team_a test-coverage
bash .claude/skills/step-engine/scripts/team-metrics.sh list-entries team_a linter-error-count
bash .claude/skills/step-engine/scripts/team-metrics.sh add-entry team_a test-coverage 1.2.2026 72.5
bash .claude/skills/step-engine/scripts/team-metrics.sh update-entry team_a test-coverage 13.1.2026 71.0
bash .claude/skills/step-engine/scripts/team-metrics.sh delete-entry team_a test-coverage 13.1.2026
bash .claude/skills/step-engine/scripts/team-metrics.sh create team_a new-metric-name
```
