# CLAUDE.md

## Commands

- **`bun dev`** — Start dev server with hot reload (port 3000)
- **`bun check`** — Run prettier --check, eslint, and tsc
- **`bun fix`** — Auto-fix formatting and lint issues
- **`bun b`** — Build frontend assets (JS + CSS to `public/`)
- **`bun b:prod`** — Production build (bundles server + assets to `dist/`)
- **`bun test`** — Run unit tests (Bun test runner, searches `./src`)
- **`bun test:e`** — Run Playwright E2E tests (requires server on :3000)

Unit tests live alongside source files as `*.test.ts`. Run a single file with `bun test path/to/file.test.ts`.

## Architecture

Server-side rendered web app: **Hono** + **Bun**, JSX templating, no client-side framework. Tracks engineering team capability assessments, experiments, and metrics.

### Data flow

```
Filesystem (YAML/Markdown) → Loaders → Parsers (Zod validation) → Aggregations/Queries → Handlers → Page Components → HTML
```

### Layer responsibilities

- **`index.tsx`** — Entry point. Route definitions, middleware, error handler. Imperative shell — all I/O wiring here.
- **`src/handlers/`** — Thin route handlers: load data, call prepare functions, render a Page component. No business logic.
- **`src/loaders/`** — Read YAML/Markdown from `examples/` and `resources/`. Return parsed data.
- **`src/parsers/`** — Zod-validated parsing. `yaml/` for team/experiment/metric schemas; `markdown/` for capability content and maturity assessments.
- **`src/domain/`** — Pure business logic: queries, aggregations, errors, date parsing, and `prepare*Data.ts` transforms that structure data for rendering.
- **`src/schemas/`** — Shared Zod schemas and inferred types.
- **`src/frontend/Pages/`** — Full page components.
- **`src/frontend/components/`** — Reusable view components (`Layout`, `Page`, `Sidebar`, tiles).
- **`src/frontend/scripts/`** — Client-side vanilla JS (compiled to `public/`). Minimal interactivity and Chart.js visualizations.

**Layer dependency rule**: `src/domain/`, `src/loaders/`, and `src/handlers/` must never import from `src/frontend/`. Frontend scripts may import from `src/schemas/` and `src/domain/`.

### Data sources

Content lives in the filesystem, not a database:

- `resources/capabilities/*.md` — Capability definitions
- `resources/practices/*.md` — Practice definitions
- `examples/teams/*.yaml` — Team definitions
- `examples/experiments/{teamId}/*.yaml` — Experiment definitions
- `examples/metrics/capability_scores/*.yaml` — Capability score metrics
- `examples/metrics/team_specific/{teamId}/*.yaml` — Team-specific metrics

## Hooks

- **Post-edit**: `bun check` runs after every Edit/Write. Edits are blocked on lint, format, or type errors. Run `bun fix` to auto-resolve.
- **Pre-commit**: `bun check:commit` runs before every commit. If blocked, diagnose with `bun check:commit` directly — never use git commands to work around this.

## Code style

- Prettier: single quotes, trailing commas (es5), 100 char width
- ESLint: `no-explicit-any` is an error; unused vars must be prefixed with `_`
- Zod 4 for all runtime schema validation
- No `interface` declarations in `src/schemas/` — use `export type Foo = z.infer<typeof FooSchema>`. See [Zod Schema Conventions](.claude/info/zod-schema-conventions.md) for the passthrough/transform exception.
- All `import` statements must appear at the top of `.ts`/`.tsx` files before any executable code.

## Shared utilities

Never reimplement these inline — see [Shared Utilities](.claude/info/shared-utilities.md) for usage examples.

- **ENOENT checks**: Use `isEnoentError(error)` from `src/loaders/isEnoentError.ts`.
- **Date parsing**: Server-side → `parseDate()` from `src/domain/parseDate.ts`. Frontend scripts → `parseDataDate()` from `src/frontend/scripts/insights-date-utils.ts`.

## Reference Files

- [Zod Schema Conventions](.claude/info/zod-schema-conventions.md) — Type export rules, the passthrough/transform exception, and examples.
- [Shared Utilities](.claude/info/shared-utilities.md) — ENOENT error checking and date parsing utilities with usage examples.
