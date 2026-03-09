---
name: library-implementer
description: >
  Adds a new npm/bun package or library to the project — from installation through
  integration. Use this skill whenever the user wants to add, install, or integrate
  a new package, library, or dependency, whether they say "add X", "use X", "install X",
  "integrate X", or "I want to use X library". Works great when the user provides a
  link to the library's docs, npm page, or GitHub repo. Even if the user just names
  a library without further context, use this skill to handle the full integration
  workflow properly.
---

## Goal

Take a library from "I want to use it" to "it's properly integrated" — installed,
typed, and wired in following this project's conventions.

## Step 1: Gather context

Before writing any code, collect what you need:

**If the user provided a URL** (npm page, GitHub, docs site, etc.) — fetch it.
Extract: the install command, the API shape, basic usage examples, and TypeScript
support status. If the URL leads to a README or docs page, look for TypeScript
usage examples specifically.

**If no URL was provided** — use your knowledge of the library. If you're uncertain
about the API, say so briefly and ask the user for the link or for clarification on
how they want to use it.

**Also check the project:**

- What's the package manager? (This project uses `bun` — install with `bun add <pkg>`)
- Is there an existing similar library? (No need to add duplicates)
- Where would this library naturally be used? (loaders? handlers? frontend scripts?)

## Step 2: Install

```bash
bun add <package-name>
# For dev-only tools:
bun add -d <package-name>
```

If the library needs a `@types/` package and doesn't ship its own types, add that too.

## Step 3: Integrate

Wire the library into the codebase following the project's patterns:

- **Imports**: Use named imports where possible; avoid `import *`
- **Types**: Never use `any` — the linter treats it as an error. Derive types from
  the library's own types or use Zod schemas for runtime validation at system
  boundaries (user input, external data)
- **Placement**: Follow the data-flow layers — loaders load, parsers parse, queries
  query. Don't reach across layers
- **Style**: Single quotes, trailing commas (es5), 100-char line width

If the library needs initialization or configuration (a client, a plugin, middleware),
add it in `index.tsx` with the rest of the app's imperative wiring — that's the
"imperative shell" layer.

## Step 4: Verify

After making changes, run:

```bash
bun check
```

This runs prettier + eslint + tsc. Fix anything that fails before finishing.
If there are type errors from the library itself (rare but happens with poorly typed
packages), explain the issue and suggest a fix — don't use `any` as a band-aid.

## What good output looks like

- The package is in `package.json` and `bun.lock` is updated
- There's a working usage example in the right file(s)
- `bun check` passes
- If the library replaces or wraps something that existed before, the old code is cleaned up

## Handling ambiguity

If it's unclear what the user wants to _do_ with the library (just install it? build
a full integration? replace something?), ask one focused question before proceeding.
Don't assume scope — a user saying "add chart.js" might want a tiny chart or a full
charting subsystem.
