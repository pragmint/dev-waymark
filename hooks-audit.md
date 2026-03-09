# Hooks Audit

## Setup

**PostToolUse** (after every Edit/Write): `check.sh` — runs `bun check` (prettier + eslint + tsc)

**Stop** (after every response):

1. `check.sh` — same as above
2. `test.sh` — runs `bun test`; Playwright only if `src/frontend/` changed
3. Agent: **bun-tester** — verifies test coverage
4. Agent: **code-standardizer** — verifies naming/structure conventions

All hooks skip if no TS files changed or `.no-hooks` exists. Use `touch .no-hooks` to disable during planning sessions (gitignored).

---

## Open Issue

**Agent hooks spawn on every Stop, even no-change turns.** The changed-files guard lives inside the agent prompt, so the subprocess still starts before checking. Options:

- Accept it (early-exit logic bounds the cost)
- Convert to command hooks + shell scripts (zero spawn cost, no agent judgment)
- Wait for conditional hook triggers in Claude Code
