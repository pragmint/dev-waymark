# Step Engine

A simple website that helps software and data engineering teams continuously surface bottlenecks and experiment with relevant and novel engineering practices.

## Getting Started

```bash
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

# Run E2E tests (requires server on :3000)
bun test:e2e  # Note: You may need to run `bunx playwright install` first
# In order to have passing e2e tests you need to load the test data.
# IE run the generate and seed commands to populate the database.

# Build for production
bun b:prod

# Start app from dist
bun start
```

Unless otherwise configured, the server runs at `http://localhost:3000`

## Database

The app uses a local SQLite database (default: `step-engine.sqlite`). Override the path with the `DATABASE_PATH` env var.

### Migrations

```bash
# Apply all pending migrations
bun migrate

# Roll back the most recent migration
bun rollback
```

Migrations run automatically on `bun dev` and `bun start`. Run `bun migrate` manually when you need to apply them without starting the server.

### Seed data

```bash
# Seed the database with fixture data (also runs pending migrations)
bun seed
```

The fixtures are parquet files in `pipelines/fixtures/`. To regenerate them after changing the fixture definitions:

```bash
bun generate
```

## Architecture

Server-side rendered web app built with **Hono** + **Bun**, JSX templating, no client-side framework.

### Data flow

Data can originate from a number of sources (JIRA, Linear, GitHub, Claude, Slack, Google Calendar, DataDog, etc). That data gets fed into a data lake where it can be sliced and diced by this application.

Internally, all of this data gets organized into entities and meta-data. For example, one of the entities that could get extracted is a ticket. Each ticket could have meta-data like issue-type, created-at, in-progress-at, etc.
