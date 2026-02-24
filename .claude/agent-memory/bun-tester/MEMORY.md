# Bun Tester Agent Memory

## Key Patterns

### Browser global shimming for frontend scripts

Bun's test runner has no `window` global. Frontend modules that use `window.X` need a shim.
Place this at the top of the test file, BEFORE any imports that load the module under test:

```ts
(globalThis as unknown as Record<string, unknown>)['window'] = globalThis;
```

Then assign mocks to `globalThis` (e.g. `globalThis['Chart'] = mockConstructor`) and clean
them up in `afterEach`. See `src/frontend/scripts/insights-chart.test.ts` for a full example.

### Module purity in this codebase

- `src/core/domain/` and `src/domain/` — pure; test exhaustively, no mocks needed
- `src/frontend/scripts/` — impure (window globals, DOM); mock at the global boundary
- `src/loaders/` — impure (filesystem); mock or use fixture files
- `src/parsers/` — pure (Zod + string parsing); test exhaustively

### Test file conventions

- File placement: `*.test.ts` co-located alongside source files
- Import style: `import { describe, it, expect, beforeEach, afterEach, mock } from 'bun:test'`
- Pattern: Arrange / Act / Assert with blank-line separation between stages
- Prefer `it()` over `test()` for sentence-style names

### Detailed notes

- See `patterns.md` for the Chart mock factory pattern (reusable across chart tests)
