# Dev Waymark

A simple website that helps software and data engineering teams continuously surface bottlenecks and experiment with relevant and novel engineering practices.

## Getting Started

## Configuration

Copy `.env.example` to `.env` and configure as needed. All settings have defaults for local development.

```bash
# Copy example configuration to .env file, then configure as needed.
# All default settings are set up for local development.
# Do the same for the end to end test configuration file.
cp .env.example .env
cp .env.e2e.example .env.e2e

# Install deps
bun install

# Install git hooks
bun install-hooks

# Build JS/CSS assets
bun b

# Development with hot reload
bun dev

# Run unit tests
bun test

# Run E2E tests (Note: You may need to run `bunx playwright install` first)
bun test:e2e

# Build for production
bun b:prod

# Start app from dist
bun start
```

Unless otherwise configured, the server runs at `http://localhost:3000`

## Database

### Source database

By default Dev Waymark never creates or migrates the source database schema. The expected schema is documented in `src/db/source/schema.ts`, and a configured source (SQLite file, remote Postgres, Redshift) must have the `entities` and `entity_metadata` tables in place before the app starts.

Set `DEV_WAYMARK_SOURCE_DB_SEED` to opt into automatic schema + seed management for a source Dev Waymark owns:

- `none` (default) — leave the source alone. Assumed to have the schema and rows already.
- `golden` — apply schema, truncate rows, load the full golden dataset (`src/db/source/goldenSeed.ts`). Use for local dev.
- `e2e` — apply schema, truncate rows, load the compact e2e dataset (`src/db/source/e2eSeed.ts`). Use for Playwright.

Any value other than `none` TRUNCATES the source on every start — never point at a real source DB.

### App-state database

Dev Waymark owns and manages the app-state database schema. Migrations run automatically at startup via `appStateRepo.initialize()`. To run them explicitly without starting the server:

```bash
bun migrate
```

### Golden seed data

For local development, set `DEV_WAYMARK_SOURCE_DB_SEED=golden` in your `.env` (see `.env.example`). At startup Dev Waymark will apply the source schema, truncate any existing rows, and load the golden dataset (`src/db/source/goldenSeed.ts`). With `:memory:` SQLite the seed is cached on disk between runs for fast boots.

### Running against Postgres locally

`devenv.nix` declares a single Postgres 16 instance on port `5433` with four databases pre-created: `waymark_source` / `waymark_app` (for `bun dev`) and `waymark_source_e2e` / `waymark_app_e2e` (for `bun test:e2e`). Isolation between the two workflows is by database name, not by process, so both can run simultaneously against the same devenv session.

```bash
devenv up -d      # background postgres via process-compose
bun dev
```

The connection URLs and `DEV_WAYMARK_SOURCE_DB_SEED=golden` are set in `.env` (see `.env.example`). The seed value opts the source Postgres into "fresh on every start" behavior: at startup Dev Waymark applies the source schema, truncates `entities` / `entity_metadata`, and reseeds the dataset. App-state migrations run automatically at startup, so `bun migrate` is not required.

**Never set `DEV_WAYMARK_SOURCE_DB_SEED` to a non-`none` value against a real source database** — it will TRUNCATE its rows on every boot. Leave it `none` (the default) for prod-style configurations; Dev Waymark will then treat the source as read-only and never touch its schema.

Stop the devenv processes with `devenv down` when you're done for the day. Nix and devenv must be installed — see [devenv.sh](https://devenv.sh/getting-started/) for platform install instructions.

#### First-run gotcha: `insteadOf` git rewrite

If your global git config rewrites GitHub HTTPS URLs to SSH:

```
[url "git@github.com:"]
    insteadOf = https://github.com/
```

The first `devenv` command in this repo will fail with `authentication required but no callback set`. Nix's flake fetcher uses libgit2, libgit2 honors the rewrite, and libgit2 can't speak to your SSH agent — so the fetch of `github:cachix/devenv-nixpkgs` gets dropped into a protocol it can't authenticate.

Bootstrap once with a fresh `HOME` so libgit2 doesn't see the rewrite:

```bash
mkdir -p /tmp/nix-home-$USER
HOME=/tmp/nix-home-$USER devenv up -d
```

That single successful run writes `devenv.lock` (already checked into the repo), which pins the flake inputs — every subsequent `devenv` / `bun test:e2e` invocation reads from the lock and never re-fetches, so your normal shell works from then on. If you ever bump inputs with `devenv update`, use the same `HOME` trick for that one command.

## Testing

### Unit tests

```bash
bun test
# single file
bun test path/to/file.test.ts
```

### End-to-end tests

```bash
bun test:e2e
# single file, optionally filtered
bun test:e2e -- path/to/spec.ts -g "test name pattern"
```

Playwright starts its own server on port `4080` — don't start `bun dev` first.

The webServer environment is loaded from `.env.e2e` (gitignored) if present, layered on top of an in-memory SQLite fallback so behavior is unchanged when the file is absent. Copy the example to customise:

```bash
cp .env.e2e.example .env.e2e
```

When `.env.e2e` uses the Postgres adapter, `test/globalSetup.ts` runs `devenv up -d` if the Postgres port isn't already listening and waits for it to accept connections. `test/globalTeardown.ts` calls `devenv down` — but only when this run was the one that started devenv (tracked via a `.devenv-e2e-owned` marker file). If your `bun dev` session already has devenv running, e2e reuses it and leaves it alone at the end.

To run without devenv, comment out the Postgres block in `.env.e2e`; the fallback in `playwright.config.ts` uses in-memory SQLite and globalSetup skips the devenv lifecycle entirely.

## Architecture

Server-side rendered web app built with **Hono** + **Bun**, JSX templating, no client-side framework.

### Two-database design

Dev Waymark separates **source data** from **application state**:

| Concern                           | Owner             | Adapters                   | Default                  |
| --------------------------------- | ----------------- | -------------------------- | ------------------------ |
| Source data (entities + metadata) | External / client | SQLite, Postgres, Redshift | in-memory SQLite         |
| App state (presets, views, etc.)  | Dev Waymark       | SQLite, Postgres           | `dev-waymark-app.sqlite` |

The two databases are configured independently and can live on different servers. Dev Waymark leaves the source schema alone by default; setting `DEV_WAYMARK_SOURCE_DB_SEED` to `golden` or `e2e` is the only way to opt in to schema management + reseed for a source.

### Data flow

```
Source DB (SQLite / Postgres / Redshift)
    ↓  SourceDataAdapter
entityRepository (EAV queries, filters)
    ↓
Handlers → Page Components → HTML
```

Application state writes flow through `AppStateRepository`, never through the source adapter.

### Layer responsibilities

- **`index.tsx`** — Entry point. Loads config, initialises adapters, wires routes.
- **`src/config.ts`** — Centralised environment config. Single place to read all env vars.
- **`src/db/source/`** — `SourceDataAdapter` interface + SQLite / Postgres / Redshift implementations.
- **`src/db/source/schema.ts`** — Documented source schema DDL, in both SQLite and Postgres flavours. Applied automatically when `DEV_WAYMARK_SOURCE_DB_SEED` is set to `golden` or `e2e`.
- **`src/db/sqliteUtils.ts`** — `runSql()` helper for executing multi-statement DDL blocks.
- **`src/db/appState/`** — `AppStateRepository` interface + SQLite / Postgres implementations.
- **`src/db/appState/migrations/`** — App-state migration files (one per feature).
- **`src/db/entityRepository.ts`** — EAV query logic. Uses `SourceDataAdapter` — not tied to any specific DB driver.
- **`src/handlers/`** — Thin route handlers: parse request, call repo, render page.
- **`src/domain/`** — Pure business logic.
- **`src/schemas/`** — Shared Zod schemas and inferred types.
- **`src/frontend/`** — JSX page/component templates and client-side scripts.
- **`pipelines/`** — Development utilities (seed, fixture generation). Not part of app startup.

### Adding a new source adapter

1. Create `src/db/source/<name>.ts` implementing `SourceDataAdapter`.
2. Add the adapter name to `SourceDbAdapterSchema` in `src/config.ts`.
3. Add a case to `createSourceAdapter()` in `src/db/source/factory.ts`.

### Adding a new app state adapter

1. Create `src/db/appState/<name>.ts` implementing `AppStateRepository`.
2. Add the adapter name to `AppDbAdapterSchema` in `src/config.ts`.
3. Add a case to `createAppStateRepo()` in `src/db/appState/factory.ts`.

### Adding an app-state migration

1. Create `src/db/appState/migrations/migration-<timestamp>.ts` with `sqlite` and `postgres` exports, each containing `up` and `down` SQL strings.
2. Register it in `src/db/appState/migrations/index.ts`.
