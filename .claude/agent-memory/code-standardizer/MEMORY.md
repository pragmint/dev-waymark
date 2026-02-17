# Code Standardizer Memory

## Project: step-engine (Hono + Bun SSR)

### Naming Conventions

#### src/core/data/

- **Schemas**: `[entity]Schemas.ts` (camelCase prefix, PascalCase suffix)
- **Types**: `[entity]Types.ts` (camelCase prefix, PascalCase suffix)
- **Queries**: `[entity]Queries.ts` (camelCase prefix, PascalCase suffix)
- **Aggregations**: `[entity]Aggregations.ts` (camelCase prefix, PascalCase suffix)
- **Prepare functions**: `prepare[Entity]Data.ts` (camelCase throughout)

Entity prefixes: `capability`, `experiment`, `team`, `metric`, `summary`

#### Type/Schema Pattern

- Schemas defined in `*Schemas.ts` with Zod, types derived via `z.infer`
- `*Types.ts` files re-export types from schemas for backward compatibility
- Schemas are single source of truth

### Category Folder Standards

#### src/core/data/ Structure

Pure business logic layer - no I/O except in prepare functions:

1. **Schemas** - Zod runtime validation schemas
2. **Types** - Type re-exports and schema re-exports
3. **Queries** - Pure query functions (filter, find, transform)
4. **Aggregations** - Pure aggregation/enrichment functions
5. **Prepare functions** - Orchestrate I/O and data prep for page rendering

### Utility Function Locality Issues Found

#### parseDate duplication

- Two identical implementations exist:
  - `/src/core/utils/dateFormatter.ts` (canonical)
  - `/src/frontend/scripts/insights-utils.ts` (duplicate)
- `prepareTeamDetailData.ts` imports from frontend layer (wrong)
- Should standardize all core data files to use core utils version

#### Helper function duplication

- `isDimensionScore` and `getNumericScore` duplicated in:
  - `capabilityQueries.ts`
  - `metricAggregations.ts`
  - `prepareTeamDetailData.ts`
- Three identical private implementations doing the same thing

### Standardization Work (2026-02-17)

#### Completed

1. **Renamed summaryTypes.ts to summarySchemas.ts** - Now follows naming convention
   - Created new summaryTypes.ts as re-export file (for backward compatibility)
   - Updated imports in loadSummariesFromFilesystem.ts and OverviewHandler.ts
2. **Fixed prepareTeamDetailData.ts parseDate import** - Now imports from core utils layer
3. **Extracted duplicate helper functions** - Created metricHelpers.ts with:
   - `isDimensionScore(value: MetricValue)`
   - `getNumericScore(value: MetricValue)`
   - Updated capabilityQueries.ts, metricAggregations.ts, prepareTeamDetailData.ts to import shared helpers

#### Notes

- All tests passing after refactor
- Type checking, linting, formatting all pass
- Pattern now fully consistent across all entity files

### Architectural Decisions

- Core data layer should be pure (no I/O) except prepare functions
- Prepare functions are allowed async I/O for orchestrating page data
- Test files use `.test.ts` suffix, live alongside source files
- Post-edit hook runs `bun check` (prettier, eslint, tsc) after all edits
