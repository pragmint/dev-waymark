# Audit: Clean Architecture — Dependency Rule Compliance

**Date**: 2026-03-09
**Scope**: Verify that source code dependencies only point inward across all architectural layers (domain → schemas only; handlers/loaders/parsers never import from frontend)
**Files examined**: 65 (all non-test `.ts` and `.tsx` source files)

---

## Summary

The codebase demonstrates strong Clean Architecture adherence overall — parsers, loaders, schemas, and most domain files are correctly isolated. However, four files in the domain layer directly violate the Dependency Rule by importing from outer layers (frontend Pages/components and infrastructure loaders). The core issue is a recurring pattern where "prepare data" functions are typed against their consuming Page's props type, creating an inward-pointing dependency from domain to UI. One handler also leaks domain logic into the adapter layer.

| Severity | Count |
| -------- | ----- |
| Critical | 0     |
| High     | 4     |
| Medium   | 2     |
| Low      | 0     |
| Info     | 0     |

---

## Findings

### [HIGH] Domain imports UI props type as return type — `src/domain/prepareTeamDetailData.ts`

**Category**: Layer violation (domain → UI)
**Location**: `src/domain/prepareTeamDetailData.ts:8`

`prepareTeamDetailData` imports `TeamDetailPageProps` from `../frontend/Pages/TeamDetailPage` and uses it as the function's return type. This means the domain layer is coupled to the UI layer's prop contract. Any change to how the page component consumes its data ripples inward to the domain. The function comment calls it "Pure, testable function" but it is neither: the return type binds it to the frontend.

**Suggested fix**: Define a dedicated domain type (e.g. `TeamDetailData` in `src/schemas/` or inline in the domain file) that captures what the function returns. Have `TeamDetailPageProps` extend or alias it in the frontend layer, or simply let the handler spread the domain result into the page props.

---

### [HIGH] Domain imports infrastructure (loader) directly — `src/domain/prepareTeamDetailData.ts`

**Category**: Layer violation (domain → infrastructure)
**Location**: `src/domain/prepareTeamDetailData.ts:4`

`prepareTeamDetailData` calls `await loadPracticeFromFilesystem(...)` at lines 54 and 67, importing the loader from `../loaders/loadPracticeFromFilesystem`. This makes the "pure, testable" domain function perform I/O and impossible to unit test without a real filesystem. Domain functions should receive their data as arguments — I/O belongs in the handler.

**Suggested fix**: Move the two `loadPracticeFromFilesystem` calls into `handleTeamDetail.tsx`, build the `practiceMap` there, and pass it as a parameter to `prepareTeamDetailData`.

---

### [HIGH] Domain imports UI props type as return type — `src/domain/prepareOverviewData.ts`

**Category**: Layer violation (domain → UI)
**Location**: `src/domain/prepareOverviewData.ts:4`

`prepareOverviewData` imports `OverviewPageProps` from `../frontend/Pages/OverviewPage` and declares it as the return type. Same structural problem as `prepareTeamDetailData`: the domain function's contract is owned by the UI layer.

**Suggested fix**: Extract the return shape as a standalone type (e.g. `OverviewData`) in schemas or inline in the domain file. Update `OverviewPage` to accept that type (or a superset of it).

---

### [HIGH] Domain logic stranded in handler file — `src/handlers/handleExperimentDetail.tsx`

**Category**: Misplaced domain logic
**Location**: `src/handlers/handleExperimentDetail.tsx:45–79`

`prepareExperimentDetailData` is a data-preparation function exported from a handler file. It is annotated "Pure, testable function" but contains a `loadPracticeFromFilesystem` call (line 58) and references `MiniChartData` from the frontend. Functions that orchestrate domain logic and are intended to be testable belong in `src/domain/`, not `src/handlers/`. Being in the handler file also prevents reuse and obscures architectural intent.

**Suggested fix**: Move `prepareExperimentDetailData` to `src/domain/prepareExperimentDetailData.ts`. Resolve the `MiniChartData` dependency per the medium finding below, and move the `loadPracticeFromFilesystem` call into the handler.

---

### [MEDIUM] Domain imports type from frontend component — `src/domain/experimentMetricsData.ts`

**Category**: Layer violation (domain → UI)
**Location**: `src/domain/experimentMetricsData.ts:5`

`resolveMetricChartData` returns `MiniChartData | null`, where `MiniChartData` is imported from `../frontend/components/MiniChart`. A data shape used by domain logic should not be defined inside a frontend component file. This forces `experimentMetricsData.ts` to depend on a UI artifact.

**Suggested fix**: Move the `MiniChartData` type declaration to `src/schemas/` (e.g. `chartSchemas.ts`). Have `MiniChart.tsx` import it from there instead of defining it.

---

### [MEDIUM] Handler imports data type from frontend component — `src/handlers/handleExperimentDetail.tsx`

**Category**: Layer violation (handler → UI component type)
**Location**: `src/handlers/handleExperimentDetail.tsx:18`

`handleExperimentDetail.tsx` re-imports `MiniChartData` from `../frontend/components/MiniChart` (in addition to the domain-layer violation above). Per the project's own layer rules, handlers must not import from `src/frontend/`. This import is a symptom of the `MiniChartData` being defined in the wrong place — fixing the medium finding above resolves this one for free.

**Suggested fix**: Resolve by moving `MiniChartData` to `src/schemas/` as described above.

---

## What looks good

- **`src/domain/capabilityQueries.ts`** — Genuinely pure: no I/O, no frontend imports, only schemas and sibling domain utilities.
- **`src/domain/metricAggregations.ts`** — Pure transformations, correctly typed against schema types.
- **`src/domain/experimentQueries.ts`** — Pure sort/filter queries, clean dependency profile.
- **`src/domain/metricHelpers.ts`** — Pure numeric utilities, no layer violations.
- **`src/domain/prepareInsightsData.ts`** — Correctly accepts data as arguments and returns a plain object; no frontend imports.
- **All parsers** (`src/parsers/`) — Correctly isolated: parse input, validate with Zod, throw domain error types. No frontend or handler imports.
- **All loaders** (`src/loaders/`) — Correctly import domain types and parsers only; properly use `isEnoentError` utility; no frontend imports.
- **`src/handlers/handleCapabilityDetail.tsx`, `handlePracticeCatalog.tsx`, `handleInsight.tsx`** — Thin and correct: load data, call domain functions, render page. No domain logic inline.
- **Frontend scripts** (`src/frontend/scripts/`) — Correctly scoped to schemas and their own script modules; no handler or loader imports.
- **Hono `Context` type** — Properly confined to handler files and `index.tsx`; never leaks into domain or loaders.

---

## Recommended next steps

1. **Move `MiniChartData` to `src/schemas/chartSchemas.ts`** — Fixes both medium findings (the domain import and the handler re-import) in a single change. Have `MiniChart.tsx` import from schemas instead.

2. **Remove the loader call from `prepareTeamDetailData`** — Move the `loadPracticeFromFilesystem` calls into `handleTeamDetail.tsx`, build the `practiceMap` there, and pass it as an argument. This makes `prepareTeamDetailData` genuinely pure and unit-testable.

3. **Extract `prepareExperimentDetailData` to `src/domain/`** — After resolving the `MiniChartData` and loader-call issues, move the function to `src/domain/prepareExperimentDetailData.ts` so domain logic is co-located with the domain layer.

4. **Break the domain → UI props dependency in `prepare*Data` functions** — For `prepareTeamDetailData` and `prepareOverviewData`, define standalone return types in schemas. This severs the inward-pointing UI import and makes the domain layer truly independent of the frontend.
