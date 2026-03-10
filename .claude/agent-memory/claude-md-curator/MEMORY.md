# Claude.md Curator Memory

## Project: step-engine

### Key facts
- Domain layer is `src/domain/` (NOT `src/core/domain/` — an old inaccuracy now fixed)
- Schemas live in `src/schemas/` (separate from `src/domain/`)
- No `src/frontend/Pages/handlers/` subdirectory — handlers live in `src/handlers/`
- `src/domain/` contains: queries, aggregations, errors, parseDate, prepare*Data transforms

### .claude/info/ files (created 2026-03-10)
- `zod-schema-conventions.md` — type export rules, passthrough+transform exception
- `shared-utilities.md` — isEnoentError and date parsing utilities

### What stays inline in CLAUDE.md
- All bun commands (used every session)
- Data flow diagram
- Layer responsibilities (one sentence each)
- Data source paths
- Core code style rules (brief)
- Hook behavior (post-edit, pre-commit)

### What goes to .claude/info/
- Zod exception clause detail (passthrough+transform)
- Verbose inline patterns to avoid (with ESLint rule context)
- Anything with a code example or multi-sentence explanation

### Recurring decisions
- "No semicolons omission" in Prettier rule is awkward phrasing — it means semicolons ARE used (not omitted). Keep as-is since it matches existing convention wording.
- Import grouping rule (imports at top) is a universal one-liner — keep inline.
