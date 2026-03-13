# summaries.sh

Read and write weekly summary markdown files.

**Data:** `$STEP_ENGINE_USER_DATA/summaries/{D.M.YYYY}.md`

> **Date format:** `D.M.YYYY` — e.g. `16.1.2026`, `1.2.2026` (no leading zeros)

## Markdown structure

Summaries are free-form markdown. The conventional structure is:

```markdown
**Overview:** ...

**Key Highlights:**

- **Capability Name** description of progress or change.

**Areas of Focus:**

- **Capability Name** description of what needs attention.

**Next Steps:** ...
```

## Commands

```bash
bash .claude/skills/step-engine/scripts/summaries.sh list
bash .claude/skills/step-engine/scripts/summaries.sh get <date>
bash .claude/skills/step-engine/scripts/summaries.sh set <date>              # reads from stdin
bash .claude/skills/step-engine/scripts/summaries.sh set-file <date> <file>  # copies from a file
bash .claude/skills/step-engine/scripts/summaries.sh delete <date>
```

> **Note:** The `edit` command opens an interactive editor and is not suitable for non-interactive use. Use `set` with a heredoc or pipe instead.

## Writing a summary non-interactively

Use a heredoc with `set`:

```bash
bash .claude/skills/step-engine/scripts/summaries.sh set 1.2.2026 <<'EOF'
**Overview:** This week marked progress in deployment automation...

**Key Highlights:**

- **Deployment Automation** three more teams now have fully automated pipelines.

**Areas of Focus:**

- **Monitoring** only two teams have comprehensive observability in place.

**Next Steps:** Focus on rolling out monitoring templates to remaining teams.
EOF
```

## Examples

```bash
bash .claude/skills/step-engine/scripts/summaries.sh list
bash .claude/skills/step-engine/scripts/summaries.sh get 16.1.2026
bash .claude/skills/step-engine/scripts/summaries.sh delete 16.1.2026
```
