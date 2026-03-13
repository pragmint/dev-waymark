# teams.sh

Manage team YAML files.

**Data:** `$STEP_ENGINE_USER_DATA/teams/{team-id}.yaml`

> **Team ID format:** use hyphens — `team-a`, `team-b`. Note: experiment and metric directories use underscores (`team_a`). These are different namespaces.

## YAML structure

```yaml
id: team-a
name: Team A
description: >
  A description of the team.
targetedCapabilities:
  - continuous-delivery
  - deployment-automation
```

## Valid fields for `set-field`

| Field | Type | Notes |
|---|---|---|
| `id` | string | Should match the filename |
| `name` | string | Display name |
| `description` | string | Free text |

Use `add-capability` / `remove-capability` for `targetedCapabilities` — do not use `set-field` for arrays.

## Commands

```bash
bash .claude/skills/step-engine/scripts/teams.sh list
bash .claude/skills/step-engine/scripts/teams.sh get <team-id>
bash .claude/skills/step-engine/scripts/teams.sh set-field <team-id> <field> <value>
bash .claude/skills/step-engine/scripts/teams.sh add-capability <team-id> <capability>
bash .claude/skills/step-engine/scripts/teams.sh remove-capability <team-id> <capability>
bash .claude/skills/step-engine/scripts/teams.sh create <team-id> <name>
```

## Examples

```bash
bash .claude/skills/step-engine/scripts/teams.sh list
bash .claude/skills/step-engine/scripts/teams.sh get team-a
bash .claude/skills/step-engine/scripts/teams.sh set-field team-a name "Platform Team"
bash .claude/skills/step-engine/scripts/teams.sh add-capability team-a test-automation
bash .claude/skills/step-engine/scripts/teams.sh remove-capability team-a flexible-infrastructure
bash .claude/skills/step-engine/scripts/teams.sh create team-d "Team D"
```
