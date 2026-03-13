# capability-scores.sh

Manage capability score metric files.

**Data:** `$STEP_ENGINE_USER_DATA/metrics/capability_scores/{capability}.yaml`

> **Date format:** `D.M.YYYY` — e.g. `27.1.2026`, `1.2.2026`
> **Team format:** use hyphens — `team-a`, `team-b`

## YAML structure

```yaml
data:
  - team: team-a
    date: 27.1.2026
    value:
      - value-delivery-frequency: 3
      - lead-time-for-changes: 2
      - change-failure-rate: 1
      - time-to-restore-service: 1
```

The `value` array contains single-key objects. Keys vary per capability — run `get <capability>` to see which keys an existing file uses before adding entries.

## Commands

```bash
bash .claude/skills/step-engine/scripts/capability-scores.sh list
bash .claude/skills/step-engine/scripts/capability-scores.sh get <capability>
bash .claude/skills/step-engine/scripts/capability-scores.sh list-entries <capability>
bash .claude/skills/step-engine/scripts/capability-scores.sh add-entry <capability> <team> <date> [key=value ...]
bash .claude/skills/step-engine/scripts/capability-scores.sh update-entry <capability> <team> <date> [key=value ...]
bash .claude/skills/step-engine/scripts/capability-scores.sh delete-entry <capability> <team> <date>
```

## Notes

- `add-entry` will error if a `team`+`date` combination already exists — use `update-entry` instead
- `update-entry` replaces the entire `value` array, so include all keys not just the changed one
- Run `get <capability>` first to check existing keys before adding a new entry

## Examples

```bash
bash .claude/skills/step-engine/scripts/capability-scores.sh list
bash .claude/skills/step-engine/scripts/capability-scores.sh get continuous-delivery
bash .claude/skills/step-engine/scripts/capability-scores.sh list-entries continuous-delivery
bash .claude/skills/step-engine/scripts/capability-scores.sh add-entry continuous-delivery team-a 1.2.2026 value-delivery-frequency=3 lead-time-for-changes=2
bash .claude/skills/step-engine/scripts/capability-scores.sh update-entry continuous-delivery team-a 27.1.2026 value-delivery-frequency=4 lead-time-for-changes=2 change-failure-rate=1 time-to-restore-service=1
bash .claude/skills/step-engine/scripts/capability-scores.sh delete-entry continuous-delivery team-a 1.2.2026
```
