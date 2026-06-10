# CLAUDE.md

## Commands

- **`bun dev`** — Start dev server with hot reload (port 3000)
- **`bun check`** — Run prettier --check, eslint, and tsc
- **`bun fix`** — Auto-fix formatting and lint issues
- **`bun b`** — Build frontend assets (JS + CSS to `public/`)
- **`bun b:prod`** — Production build (bundles server + assets to `dist/`)
- **`bun test`** — Run unit tests (Bun test runner, searches `./src`)
- **`bun test:e2e`** — Run Playwright E2E tests (requires server on :3000)

Unit tests live alongside source files as `*.test.ts`. Run a single file with `bun test path/to/file.test.ts`.

## Architecture

Server-side rendered web app: **Hono** + **Bun**, JSX templating, no client-side framework. Browses and filters engineering entities stored in SQLite.

### Data flow

```
SQLite → Repository (entityRepository) → Queries → Handlers → Page Components → HTML
```

### Layer responsibilities

- **`index.tsx`** — Entry point. Route definitions, middleware, error handler. Imperative shell — all I/O wiring here.
- **`src/db/`** — SQLite client, migrations, and entity repository. All database access goes through here.
- **`src/handlers/`** — Thin route handlers: query the repository, call domain functions, render a Page component. No business logic.
- **`src/domain/`** — Pure business logic: entity queries and date parsing.
- **`src/schemas/`** — Shared Zod schemas and inferred types.
- **`src/frontend/Pages/`** — Full page components.
- **`src/frontend/components/`** — Reusable view components (`Layout`, `FilterBar`, `MetadataTable`).
- **`src/frontend/scripts/`** — Client-side vanilla JS (compiled to `public/`). Filter panel interaction.

**Layer dependency rule**: `src/domain/`, `src/db/`, and `src/handlers/` must never import from `src/frontend/`. Frontend scripts may import from `src/schemas/` and `src/domain/`.

### Data sources

Data is stored in a SQLite database (`dev-waymark.sqlite`) and accessed exclusively via `src/db/entityRepository.ts`.

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

- **Date parsing**: Use `parseDate()` from `src/domain/parseDate.ts` for all server-side date parsing. Do not reimplement inline.

## Reference Files

- [Zod Schema Conventions](.claude/info/zod-schema-conventions.md) — Type export rules, the passthrough/transform exception, and examples.
