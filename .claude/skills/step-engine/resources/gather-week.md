# gather-week.sh

Aggregate all data for a given week into a single structured output — the primary input for generating weekly summaries.

**Accepts any date within the target week. Week runs Monday–Sunday.**

> **Date format:** `D.M.YYYY` — e.g. `16.1.2026`

## What it collects

| Section | Content |
|---|---|
| `EXPERIMENTS` | Active/blocked/polish experiments, or experiments started this week. Includes practice, week-of-experiment, and full action plan with statuses. |
| `CAPABILITY SCORES` | All capability score entries recorded during the week, grouped by capability. |
| `TEAM METRICS` | All team-specific metric entries recorded during the week, grouped by team/metric. |

## Command

```bash
bash .claude/skills/step-engine/scripts/gather-week.sh <date>
```

## Summary generation workflow

1. Run `gather-week.sh` to collect all context for the week
2. Read the output and synthesize into summary format
3. Write the result with `summaries.sh set`

```bash
# Step 1 — gather context (pipe or capture)
bash .claude/skills/step-engine/scripts/gather-week.sh 16.1.2026

# Step 3 — write the generated summary
bash .claude/skills/step-engine/scripts/summaries.sh set 16.1.2026 <<'EOF'
**Overview:** ...

**Key Highlights:**
...

**Areas of Focus:**
...

**Next Steps:** ...
EOF
```

## Examples

```bash
# Gather context for the week containing Jan 16
bash .claude/skills/step-engine/scripts/gather-week.sh 16.1.2026

# Works with any date in the week — all equivalent
bash .claude/skills/step-engine/scripts/gather-week.sh 12.1.2026
bash .claude/skills/step-engine/scripts/gather-week.sh 14.1.2026
bash .claude/skills/step-engine/scripts/gather-week.sh 18.1.2026
```
