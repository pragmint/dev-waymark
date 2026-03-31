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

### Insights page multi-axis refactor (Mar 2026)

Pure functions in `src/frontend/scripts/insights-data.ts`:

- `teamIdToName()` — pure lookup
- `transformTeamMetricData()` — pure transformation, handles numeric and qualitative metrics
- `transformCapabilityMetricData()` — pure grouping and transformation by team
- `buildMultiAxisChartData()` — NEW: pure merge for multi-axis display, assigns yAxisID, aligns dates
- `mergeChartDataForComparison()` — pure merge for dual y-axes

Pure functions in `src/frontend/scripts/insights-chart.ts`:

- `resolveChartType()` — pure type determination
- `computeLimits()` — pure bounds calculation
- `rangeFor()` — pure axis range with intelligent tick selection
- `computeAxisRanges()` — pure extraction by yAxisID
- `calculateAlignedTickCount()` — pure grid alignment calculator (well-tested)
- `createAnnotationsForQualitativeData()` — impure (creates DOM tooltips + event listeners)
- `createAnnotationsForExperiments()` — pure annotation factory
- `createTooltipCallbacks()` — pure callback factory
- `ChartManager` — impure (manages Chart.js instance lifecycle)

Pure functions in `src/frontend/scripts/insights.ts`:

- `findStartIndex()` — pure date search from left
- `findEndIndex()` — pure date search from right
- `computeExperimentOverlays()` — pure overlay computation
- `buildAxisConfig()` — pure config factory
- `buildChartTitle()` — pure title builder with length constraints

Test coverage status (Mar 31, 2026):

- `insights-chart.test.ts`: 51 passing tests for ChartManager and calculateAlignedTickCount
- `insights-data.test.ts`: 30 passing tests for data transformations
- Missing: tests for buildMultiAxisChartData (new function, not yet tested)
- Missing: tests for computeExperimentOverlays, buildAxisConfig, buildChartTitle
- All tests passing: 393 total across codebase

### Detailed notes

- See `patterns.md` for the Chart mock factory pattern (reusable across chart tests)
- Chart mock factory in insights-chart.test.ts provides reusable test infrastructure
- Experiment overlay colors are constants defined at module level
