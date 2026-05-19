# Step Engine

A simple website that helps software and data engineering teams continuously surface bottlenecks and experiment with relevant and novel engineering practices.

## Getting Started

## Configuration

Copy `.env.example` to `.env` and configure as needed. All settings have defaults for local development.

```bash
# Copy example configuration to .env file, then configure as needed.
# All default settings are set up for local development.
cp .env.example .env

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

Step Engine never creates or migrates the source database schema. The expected schema is documented in `src/db/source/schema.ts`. The source database must have the `entities` and `entity_metadata` tables in place before the app starts.

When no source database is configured, Step Engine boots with an empty in-memory SQLite database (schema applied automatically). This is the default for local development and tests.

### App-state database

Step Engine owns and manages the app-state database schema. Migrations run automatically at startup via `appStateRepo.initialize()`. To run them explicitly without starting the server:

```bash
bun migrate
```

### Golden seed data

When no source database is configured, Step Engine boots with an in-memory SQLite database pre-seeded with a golden dataset (`src/db/source/goldenSeed.ts`). This is the default for local development and tests. No manual seeding step is required — the data is loaded automatically at startup.

## Architecture

Server-side rendered web app built with **Hono** + **Bun**, JSX templating, no client-side framework.

### Two-database design

Step Engine separates **source data** from **application state**:

| Concern                           | Owner             | Adapters                   | Default                  |
| --------------------------------- | ----------------- | -------------------------- | ------------------------ |
| Source data (entities + metadata) | External / client | SQLite, Postgres, Redshift | in-memory SQLite         |
| App state (datasets, views, etc.) | Step Engine       | SQLite, Postgres           | `step-engine-app.sqlite` |

The two databases are configured independently and can live on different servers. Step Engine never modifies the source database schema.

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
- **`src/db/source/schema.ts`** — Documented source schema DDL. Applied automatically to in-memory SQLite only.
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
