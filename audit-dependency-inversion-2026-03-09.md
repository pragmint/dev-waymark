# Audit: Dependency Inversion Principle

**Date**: 2026-03-09
**Scope**: Evaluate how well handlers, domain logic, and view components adhere to DIP by depending on abstractions rather than concrete filesystem loader implementations.
**Files examined**: 45

---

## Summary

The codebase makes a pragmatic architectural choice: handlers import concrete filesystem loader functions directly at the module level (top-level `await`), which loads all data once at startup and reuses it across requests. This is a deliberate performance optimisation, not accidental coupling — but it means there are zero abstractions (interfaces, types, factory functions) separating the data-loading contract from its filesystem implementation. The domain layer is generally clean (pure functions receiving data), with one notable exception: `prepareTeamDetailData` imports and calls `loadPracticeFromFilesystem` directly, crossing the loader boundary from within a domain file. The `Sidebar` component is the clearest architectural violation: a frontend view component directly invoking a filesystem loader at module level, breaking the layer dependency rule stated in CLAUDE.md.

| Severity | Count |
| -------- | ----- |
| Critical | 0     |
| High     | 2     |
| Medium   | 3     |
| Low      | 2     |
| Info     | 2     |

---

## Findings

### [HIGH] Domain function directly calls a filesystem loader — `src/domain/prepareTeamDetailData.ts`

**Category**: Domain-to-Loader coupling (DIP violation)
**Location**: `src/domain/prepareTeamDetailData.ts:4` and `src/domain/prepareTeamDetailData.ts:54,67`

`prepareTeamDetailData` is described in comments as a "pure, testable function that orchestrates data loading and transformation", but it imports and directly calls `loadPracticeFromFilesystem` twice inside its body (lines 54 and 67). This means the domain layer has a hard dependency on a concrete I/O implementation. To test this function in isolation you must mock `loadPracticeFromFilesystem`, which requires either module-level mocking (a fragile technique) or refactoring. The function's signature (`teamId`, `teams`, `capabilities`, …) accepts pre-loaded data for all other resources, making the practice loader the only inconsistency.

**Suggested fix**: Add a `loadPractice: (practiceId: string) => Promise<Practice | null>` parameter to `prepareTeamDetailData`. The handler already calls this function with all other pre-loaded data; it can pass `loadPracticeFromFilesystem` directly. Tests can then pass a stub.

---

### [HIGH] Frontend component imports and invokes a filesystem loader — `src/frontend/components/Sidebar.tsx`

**Category**: Layer boundary violation (DIP + architectural rule)
**Location**: `src/frontend/components/Sidebar.tsx:2,8`

`Sidebar` imports `loadTeamIdentitiesFromFilesystem` and calls it at the top level (`const teams = await loadTeamIdentitiesFromFilesystem()`). This violates the layer dependency rule in CLAUDE.md which states "Domain, loaders, and handlers must never import from `src/frontend/`" — this is the reciprocal problem: `src/frontend/` importing from `src/loaders/`. A view component should receive data as props, not fetch it from the filesystem. This also means the sidebar has an invisible startup-time I/O dependency that cannot be tested or substituted.

**Suggested fix**: Add a `teams: TeamIdentity[]` prop to `Sidebar`. Load the identities in each handler or in a shared middleware that attaches them to context, then pass them down through the `Layout` component.

---

### [MEDIUM] Handlers import concrete loaders with no abstraction boundary — all handler files

**Category**: High-level module depending on low-level concrete implementation
**Location**: `src/handlers/handleTeamDetail.tsx:8-12`, `src/handlers/handleOverview.tsx:8-11`, `src/handlers/handleCapabilityCatalog.tsx:8-9`, `src/handlers/handleCapabilityDetail.tsx:4,10-12`, `src/handlers/handleExperimentDetail.tsx:9-14`, `src/handlers/handleInsight.tsx:8-11`, `src/handlers/handlePracticeCatalog.tsx:3`, `src/handlers/handlePracticeDetail.tsx:3`

Every handler file contains direct `import { loadXFromFilesystem }` statements and calls the concrete loader functions. There are no loader interfaces (e.g. `type TeamRepository = { getAll(): Promise<Team[]> }`), no injection points, and no way to swap implementations (e.g. an in-memory loader for tests, or a future database-backed loader) without modifying the handler source. The top-level `await` pattern locks in the filesystem implementation at module load time.

**Suggested fix**: Define loader type signatures in a shared module (e.g. `src/loaders/types.ts`). Handlers already receive loaded data as pre-computed module-level constants, so the coupling surface is at the module boundary rather than inside request handlers — this partially mitigates the issue. Introducing named types for loader function signatures would allow substitution in tests without full DI infrastructure.

---

### [MEDIUM] `prepareExperimentDetailData` is marked "pure" but calls a filesystem loader — `src/handlers/handleExperimentDetail.tsx`

**Category**: Misleading purity claim; hidden I/O in a nominally testable function
**Location**: `src/handlers/handleExperimentDetail.tsx:45,58`

The JSDoc on `prepareExperimentDetailData` (line 44) says "Pure, testable function that orchestrates data loading", but it calls `loadPracticeFromFilesystem(experiment.intervention.practiceUnderTest)` on line 58. This is the same pattern as `prepareTeamDetailData` — the function accepts all other resources as parameters but hardcodes one loader call internally. Testing it requires module-level mocking of `loadPracticeFromFilesystem`.

**Suggested fix**: Add `loadPractice: (id: string) => Promise<Practice | null>` as a parameter. The outer `handleExperimentDetail` passes `loadPracticeFromFilesystem` as the default. Tests pass a stub. This is the same fix as the `prepareTeamDetailData` finding above and could be implemented together.

---

### [MEDIUM] No handler or integration tests exist — tight coupling is invisible but painful

**Category**: Testability gap caused by coupling
**Location**: `src/handlers/` (no `*.test.ts` files present)

There are zero unit or integration tests for any handler. The only tests that exist for data-fetching paths test the individual loader functions by mocking `node:fs/promises` and `Bun.file` at the module level — a fragile technique. Because handlers hardcode their loader imports, writing a test for `handleTeamDetail` would require the same module-level mock infrastructure. The absence of handler tests is a consequence of the coupling: there is no seam to inject test doubles, so test authors have skipped them entirely.

**Suggested fix**: In the short term, extract the data-preparation logic from handlers into pure functions that accept all data as parameters (similar to `prepareOverviewData` and `prepareInsightsData`, which are already testable). In the longer term, see the recommended next steps.

---

### [LOW] `handlePracticeDetail` calls a loader per-request with no caching — `src/handlers/handlePracticeDetail.tsx`

**Category**: Inconsistent data-loading strategy
**Location**: `src/handlers/handlePracticeDetail.tsx:8`

All other handlers cache their loaded data at module level (top-level `await`). `handlePracticeDetail` calls `loadPracticeFromFilesystem(practiceId)` inside the request handler function on every request. This is the most DIP-friendly pattern (the function is not coupled to startup state) but it is inconsistent with the rest of the codebase and means the filesystem is hit on every page view.

**Suggested fix**: Either adopt the same module-level caching pattern used by other handlers (load all practices at startup), or document the intentional difference. If per-request loading is desired, introducing a loader type abstraction here would make swapping to a caching wrapper straightforward.

---

### [LOW] `loadCapabilityMarkdown` is called per-request inside a handler — `src/handlers/handleCapabilityDetail.tsx`

**Category**: Inconsistent data-loading strategy
**Location**: `src/handlers/handleCapabilityDetail.tsx:34`

`handleCapabilityDetail` calls `loadCapabilityMarkdown(capabilityId)` inside the request handler function (line 34), hitting the filesystem on every request for a capability detail page. All other data (capabilities, metrics, teams) is pre-loaded. Similar to `handlePracticeDetail` above, this is inconsistent.

**Suggested fix**: Pre-load all capability markdown at startup into a `Map<string, string>` alongside the other module-level constants, or accept the per-request load as intentional and document it.

---

### [INFO] `src/repositories/` directory exists but is empty — placeholder for a planned abstraction

**Category**: Architectural intention signal
**Location**: `src/repositories/`

The presence of an empty `repositories/` directory suggests awareness of the Repository pattern (a common DIP implementation) but it has not yet been populated. This is an existing seam where abstractions could be introduced.

---

### [INFO] Module-level top-level `await` in handlers prevents runtime dependency injection

**Category**: Architectural constraint
**Location**: All handler files (e.g. `src/handlers/handleTeamDetail.tsx:14-21`)

The pattern of executing loaders at module top-level (`const capabilityMetrics = await loadCapabilityMetricsFromFilesystem()`) is an effective startup-time caching approach for a filesystem-backed app, but it is incompatible with runtime dependency injection. There is no application-level composition root (no DI container, no factory, no context object) where alternative implementations could be substituted. The `index.tsx` comment "Imperative Shell — All I/O wiring happens here" sets that expectation, but the wiring happens implicitly via module imports rather than explicit injection.

---

## What looks good

- **Domain layer is largely pure.** `metricAggregations.ts`, `capabilityQueries.ts`, `experimentQueries.ts`, `prepareOverviewData.ts`, `prepareInsightsData.ts`, `experimentMetricsData.ts`, and `metricHelpers.ts` contain zero I/O. They receive data as arguments and return transformed data, making them straightforwardly unit-testable — and they have tests.
- **Handlers act as a thin shell for most routes.** For routes like `/`, `/insight`, `/catalog/capability`, the handler's only job is to pass pre-loaded data to a prepare function and render a page. The business logic is not inside the handler.
- **`prepareOverviewData` and `prepareInsightsData` are exemplary.** Both functions are pure, accept all their inputs as parameters, have no loader imports, and could be swapped with stubs trivially. These are the model pattern for domain prepare functions.
- **`userDataPaths.ts` is environment-variable-driven.** The `STEP_ENGINE_USER_DATA` env var makes the filesystem root configurable at process startup without code changes. This is a lightweight form of the Strategy pattern for data sources.
- **`isEnoentError` utility prevents inline coupling to Node error shapes.** Its use across all loaders keeps error-handling logic DRY and encapsulated.
- **Loader tests use module-level mocking consistently.** Each loader test mocks `node:fs/promises` and `Bun.file`, providing confidence in loader logic even without a loader abstraction.
- **Schemas and types live in `src/schemas/` separate from loaders.** Loader return types are defined in schemas, not inside loader files — this means the contract between loaders and consumers could be preserved if implementations were swapped.

---

## Recommended next steps

1. **Eliminate the domain-to-loader call in `prepareTeamDetailData` and `prepareExperimentDetailData`.** Add a `loadPractice` function parameter to both. This is the only place domain logic calls I/O, and fixing it restores the purity of the domain layer. Effort: low — one parameter change each, one call site each in the corresponding handler.

2. **Receive `teams` as a prop in `Sidebar` rather than loading them internally.** Pass team identities through the `Layout` component (which wraps every page). This removes the only `src/frontend` → `src/loaders` import and enforces the layer rule stated in CLAUDE.md. The data is already loaded by every handler; passing it down costs nothing. Effort: medium — requires touching Layout, all page components, and each handler.

3. **Populate `src/repositories/` with loader type definitions.** Define types such as `type TeamLoader = () => Promise<Team[]>` for each data source. These become the abstractions that handlers depend on. No runtime change is needed yet — simply naming the contracts makes future substitution (e.g. for tests or database migration) possible. Effort: low.

4. **Add at least one handler integration test using in-memory stubs.** After fixing items 1 and 2, the data-preparation functions (`prepareTeamDetailData`, `prepareExperimentDetailData`) will be fully injectable. Write tests for the error paths (team not found, experiment not found) and for correct data shaping. This will surface any remaining coupling. Effort: medium.

5. **Standardise the per-request loader calls in `handlePracticeDetail` and `handleCapabilityDetail`.** Either pre-load at startup (matching the other handlers) or explicitly document why these two routes use per-request loading. If per-request loading is kept, consider a simple `Map`-based cache wrapper — this is easier to introduce once loader type signatures exist (see item 3). Effort: low.
