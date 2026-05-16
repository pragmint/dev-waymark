---
name: Entity Module Test Coverage
description: Test coverage analysis and verification for entity schema, queries, repository, and migration modules
type: project
---

## Summary

The entity data layer includes comprehensive unit tests for all pure logic. Handlers and UI components are intentionally not unit-tested (appropriate for thin orchestration and JSX rendering).

## Test Files Verified

1. **src/domain/entityQueries.test.ts** (9 tests, 100% pass)
   - Tests pure query helpers: `getMetadataValue`, `getEntityTitle`, `groupEntitiesByType`
   - Covers normal cases, edge cases (empty, missing keys), and variant inputs
   - Excellent coverage of domain logic

2. **src/db/entityRepository.test.ts** (18 tests, 100% pass)
   - Integration tests using in-memory SQLite database (no mocks)
   - Covers CRUD: insert, get by ID, list all, upsert with metadata
   - All filter operators: `eq` (single & multi-value), `contains`, `gte`, `lte`, `re`
   - Date range filtering, numeric comparison, regex with error handling
   - Available filter narrowing (reactive filtering after user filter applied)
   - Excellent coverage of all SQL building paths

3. **src/db/migrate.test.ts** (6 tests, 100% pass)
   - Verifies migration idempotency, table creation, tracking, and rollback
   - No duplication on re-run, proper cleanup on rollback
   - Covers all migration lifecycle scenarios

## Modules NOT Unit-Tested (Appropriate)

**Handlers** (`entitiesHandler.tsx`, `entityDetailHandler.tsx`):

- Thin orchestration: parse URL/params → load from DB → render JSX
- Business logic already tested in repository & domain layers
- Unit tests would require heavy mocking of Hono Context and database
- Best covered by E2E tests (Playwright)

**UI Components** (`EntitiesPage.tsx`, `EntityDetailPage.tsx`, `FilterBar.tsx`):

- Pure JSX components (no side effects)
- Component testing is typically E2E/integration (visual regression, interaction)
- Pure helper functions in FilterBar (`removeFilterUrl`, `chipLabel`, `renderWidget`)
  could be extracted and tested if they grow complex, but currently simple

**Data Fixtures** (`pipelines/fixtures/generate.ts`):

- Generates test data (Parquet files), impure I/O
- Build-time utility, not application logic

## Key Test Patterns Observed

All tests follow **Arrange → Act → Assert** pattern clearly:

```typescript
// Arrange
const entity = makeEntity({ metadata: [meta(1, 'source', 'jira')] });

// Act
const result = getMetadataValue(entity, 'source');

// Assert
expect(result).toBe('jira');
```

Test helpers (`makeEntity`, `makeMetadata`) reduce boilerplate and improve readability.

Integration tests use real in-memory SQLite database rather than mocks, catching real SQL issues.

## Coverage Philosophy Applied

- **Pure modules** (domain queries, SQL building): ~95% coverage ✓
- **Impure modules** (handlers): Not unit-tested, best covered by E2E
- **UI components**: Not unit-tested, best covered by E2E/visual regression
- No tests mock where real data structures can be used
- Focus on behavior, not implementation details

## Coverage Metrics (2026-05-16)

```
Code coverage by module:
  src/db/entityRepository.ts              100% funcs, 100% lines
  src/db/migrate.ts                       100% funcs, 96.88% lines
  src/db/migrations/index.ts              100% funcs, 100% lines
  src/db/migrations/migration-*.ts        100% funcs, 100% lines
  src/domain/entityQueries.ts             100% funcs, 100% lines
  src/schemas/entity.ts                   100% funcs, 100% lines
  ─────────────────────────────────────────────────────────────
  Overall                                 100% funcs, 99.55% lines
```

## All Checks Pass

```
bun test:    33 pass, 0 fail (coverage enabled)
bun check:   prettier ✓, eslint ✓, tsc ✓, schema validation ✓
```

Last verified: 2026-05-16
