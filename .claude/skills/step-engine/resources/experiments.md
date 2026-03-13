# experiments.sh

Manage experiment YAML files.

**Data:** `$STEP_ENGINE_USER_DATA/experiments/{team-id}/{experiment-id}.yaml`

> **Team ID format:** use underscores — `team_a`, `team_b`. (Teams directory uses hyphens; experiments and metrics use underscores.)

## YAML structure

```yaml
context:
  problem_statement: >
  desired_outcome: >
hypothesis:
  statement: >
  assumptions: []
  risks: []
  risk_mitigations: []
intervention:
  practice_under_test:
  related_capabilities: []
  description: >
  success_criteria: []
  status: backlog
  start-date: 10.1.2026       # D.M.YYYY format
  expected-duration-in-weeks: 8
  action-plan:
    - title: "Do something"
      assigned-to: []
      link:
      status: backlog
decision-roles:
  - responsible: []
  - accountable: []
  - consulted: []
  - informed: []
```

## Valid statuses

`backlog` · `active` · `blocked` · `polish` · `pitch`

## Common `set-field` yq paths

| Path | Example value |
|---|---|
| `intervention.status` | `active` |
| `intervention.start-date` | `1.2.2026` |
| `intervention.expected-duration-in-weeks` | `6` |
| `intervention.practice_under_test` | `trunk-based-development` |
| `context.problem_statement` | `"Build times are too slow"` |
| `context.desired_outcome` | `"Under 10 min builds"` |
| `hypothesis.statement` | `"If we cache builds..."` |

## Commands

```bash
bash .claude/skills/step-engine/scripts/experiments.sh list [team-id]
bash .claude/skills/step-engine/scripts/experiments.sh get <team-id> <experiment-id>
bash .claude/skills/step-engine/scripts/experiments.sh set-status <team-id> <experiment-id> <status>
bash .claude/skills/step-engine/scripts/experiments.sh set-field <team-id> <experiment-id> <yq-path> <value>
bash .claude/skills/step-engine/scripts/experiments.sh set-action-status <team-id> <exp-id> "<action-title>" <status>
bash .claude/skills/step-engine/scripts/experiments.sh create <team-id> <experiment-id>
```

## Examples

```bash
bash .claude/skills/step-engine/scripts/experiments.sh list
bash .claude/skills/step-engine/scripts/experiments.sh list team_a
bash .claude/skills/step-engine/scripts/experiments.sh get team_a test-exp-active-new
bash .claude/skills/step-engine/scripts/experiments.sh set-status team_a test-exp-active-new blocked
bash .claude/skills/step-engine/scripts/experiments.sh set-field team_a test-exp-active-new intervention.start-date 1.2.2026
bash .claude/skills/step-engine/scripts/experiments.sh set-action-status team_a test-exp-active-new "Parallelize test suite across 4 runners" complete
bash .claude/skills/step-engine/scripts/experiments.sh create team_a my-new-experiment
```
