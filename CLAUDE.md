# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

- **`bun dev`** — Start dev server with hot reload (port 3000)
- **`bun check`** — Run prettier --check, eslint, and tsc
- **`bun fix`** — Auto-fix formatting and lint issues
- **`bun b`** — Build frontend assets (JS + CSS to public/)
- **`bun b:prod`** — Production build (bundles server + assets to dist/)
- **`bun test`** — Run unit tests (Bun test runner, searches `./src`)
- **`bun test:e`** — Run Playwright E2E tests (requires server on :3000)

Unit tests live alongside source files as `*.test.ts`. Run a single test file with `bun test path/to/file.test.ts`.

## Architecture

This is a server-side rendered web app built with **Hono** + **Bun**, using JSX for templating (no client-side framework). It tracks engineering team capability assessments, experiments, and metrics.

### Data flow

```
Filesystem (YAML/Markdown) → Loaders → Parsers (Zod validation) → Aggregations/Queries → Handlers → Page Components → HTML
```

### Layer responsibilities

- **`index.tsx`** — App entry point. Route definitions, middleware, and error handler. "Imperative shell" — all I/O wiring happens here.
- **`src/handlers/`** — Route handlers. Should be thin: load data, call prepare functions, render a Page component. No business logic.
- **`src/loaders/`** — Read YAML/Markdown files from `examples/` and `resources/` directories. Return parsed data.
- **`src/parsers/`** — YAML and Markdown parsing with Zod schema validation. `yaml/` for team/experiment/metric schemas, `markdown/` for capability content and maturity assessments.
- **`src/core/domain/`** — Pure business logic. Schemas (`*Schemas.ts`), types (`*Types.ts`), queries (`*Queries.ts`), aggregations (`*Aggregations.ts`), error classes (`errors.ts`), and date parsing (`parseDate.ts`). Data transformations like `prepareTeamDetailData.ts` structure data for page rendering.
- **`src/frontend/Pages/`** — Full page components. Some pages have co-located handler logic in `Pages/handlers/`.
- **`src/frontend/components/`** — Reusable view components (`Layout`, `Page`, `Sidebar`, tiles).
- **`src/frontend/scripts/`** — Client-side vanilla JS (compiled to `public/`). Handles minimal interactivity like toggles and Chart.js visualizations.

### Data sources

Content lives in the filesystem, not a database:

- `resources/capabilities/*.md` — Capability definitions
- `resources/practices/*.md` — Practice definitions
- `examples/teams/*.yaml` — Team definitions
- `examples/experiments/{teamId}/*.yaml` — Experiment definitions
- `examples/metrics/capability_scores/*.yaml` — Capability score metrics
- `examples/metrics/team_specific/{teamId}/*.yaml` — Team-specific metrics

### Post-edit hook

A hook runs `bun check` after every Edit/Write. Edits are blocked if linting, formatting, or type-checking fails. Run `bun fix` to auto-resolve formatting and lint issues.

## Code style

- Prettier: single quotes, trailing commas (es5), no semicolons omission, 100 char width
- ESLint: `no-explicit-any` is an error; unused vars must be prefixed with `_`
- Zod 4 for all runtime schema validation

## Shared utilities

- **ENOENT checks in loaders**: Use `isEnoentError(error)` from `src/loaders/isEnoentError.ts` — never write the inline `error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT'` pattern.
- **Date parsing**: Server-side code uses `parseDate()` from `src/domain/parseDate.ts`. Frontend scripts (`src/frontend/scripts/`) use `parseDataDate()` from `insights-date-utils.ts`. Do not duplicate this logic inline.
