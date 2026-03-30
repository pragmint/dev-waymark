# Step Engine

A simple website that helps software and data engineering teams continuously experiment with relevant and novel engineering practices.

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
bun test:pw  # Note: You may need to run `bunx playwright install` first

# Build for production
bun b:prod

# Start app from dist
bun start

# Download a mirror of the site (requires server on :3000)
bun mirror
```

Server runs at `http://localhost:3000`

## Architecture

Server-side rendered web app built with **Hono** + **Bun**, JSX templating, no client-side framework.

### Data flow

```
Filesystem (YAML/Markdown) → Loaders → Parsers (Zod validation) → Domain (queries/aggregations) → Handlers → Pages → HTML
```

### Layers

- **Handlers** — Thin route handlers: load data, call prepare functions, render a Page. No business logic.
- **Loaders** — Read YAML/Markdown from `examples/` and `resources/`.
- **Parsers** — Zod-validated parsing for team, experiment, metric, and capability schemas.
- **Domain** — Pure business logic: queries, aggregations, and `prepare*Data` transforms that structure data for rendering.
- **Pages** — Full page components (`src/frontend/Pages/`).
- **Components** — Reusable view components: Layout, Sidebar, tiles, etc. (`src/frontend/components/`).

### Data sources

Content lives in the filesystem, not a database:

- `resources/capabilities/*.md` — Capability definitions
- `resources/practices/*.md` — Practice definitions
- `examples/teams/*.yaml` — Team definitions
- `examples/experiments/{teamId}/*.yaml` — Experiment definitions
- `examples/metrics/capability_scores/*.yaml` — Capability score metrics
- `examples/metrics/team_specific/{teamId}/*.yaml` — Team-specific metrics
