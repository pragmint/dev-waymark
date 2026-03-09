---
Codebase Audit Report

3. Debug Artifacts

- src/frontend/components/MiniChart.tsx:23 — console.log(...) left in
  production code
- src/frontend/components/MiniChart.tsx:10 — // TODO: Rename to experiment
  metrics chart unresolved

---

4. Schema/Type Inconsistency

src/schemas/experimentSchemas.ts:64-89 — Experiment is defined as a manual
TypeScript interface instead of being inferred with z.infer<typeof             
  ExperimentSchema>. All other schemas use inference. Risk of schema/type
divergence.

---

5. Magic Strings Without Central Constants

- src/domain/experimentQueries.ts:5 — hardcoded status order array ['active',
  'blocked', 'backlog', 'polish', 'pitch']
- src/frontend/Pages/TeamDetailPage.tsx:14-21 — hardcoded status→color mapping
- Status constants used across multiple files with no single source of truth

---

6. Module-Level Data Loading in Handlers

Several handlers (e.g. src/handlers/handleOverview.tsx) load data via top-level
await at import time, not inside the handler function. This obscures whether  
 data is cached or fresh, makes the execution model confusing, and complicates
testing.

---

7. Naming Confusion

- enrich\* functions in src/domain/metricAggregations.ts — vague. They compute
  scores, trends, and aggregate metrics. calculateCapabilityMetrics() etc. would
  be clearer.
- Metric vs CapabilityMetric vs TeamMetric — base Metric type is ambiguous;  
  unclear whether it refers to capability or team metrics.
- ParsedCapability — only parsed schema type with "Parsed" prefix; inconsistent
  with other parsed structures.

---

8. Parsing Brittleness

src/parsers/markdown/capabilityParser.ts — brittle string matching:

- Line 241: Link regex /^\[(.+?)]\(\/practices\/(.+?)\.md\)$/
- Lines 269-270: Highly specific adjacent capability format regex
- Lines 316-345: Hardcoded expected intro text validation — fails on minor  
  markdown changes

The parseMultiDimensionalAssessment function is also a cyclomatic complexity  
 candidate (deeply nested loops + conditionals).

---

9. Schema Transforms Doing Too Much

src/schemas/metricSchemas.ts:20-47 — Zod .transform() does significant data
reshaping (array→object conversion, field extraction). This logic should be a  
 pure function tested separately, not embedded in a schema validator.

---

Priority Summary

┌──────────┬────────────────────────────────────────────────────────────────┐
│ Priority │ Issue │  
 ├──────────┼────────────────────────────────────────────────────────────────┤  
 │ High │ Cross-layer import (CapabilityMetric in frontend) │  
 ├──────────┼────────────────────────────────────────────────────────────────┤  
 │ High │ Remove console.log and resolve TODO in MiniChart.tsx │  
 ├──────────┼────────────────────────────────────────────────────────────────┤  
 │ High │ Extract isEnoentError() to eliminate 7 copies of ENOENT │  
 │ │ pattern │  
 ├──────────┼────────────────────────────────────────────────────────────────┤
│ High │ Consolidate date parsing to single utility │  
 ├──────────┼────────────────────────────────────────────────────────────────┤
│ Medium │ Fix Experiment type to use z.infer │
├──────────┼────────────────────────────────────────────────────────────────┤  
 │ Medium │ Centralize status order/color constants │
├──────────┼────────────────────────────────────────────────────────────────┤  
 │ Medium │ Clarify handler data loading model (module-level vs │
│ │ per-request) │  
 ├──────────┼────────────────────────────────────────────────────────────────┤
│ Low │ Rename enrich\* functions │  
 ├──────────┼────────────────────────────────────────────────────────────────┤  
 │ Low │ Extract metric value conversion to shared utility │
├──────────┼────────────────────────────────────────────────────────────────┤  
 │ Low │ Refactor parseMultiDimensionalAssessment into smaller │
│ │ functions │  
 └──────────┴────────────────────────────────────────────────────────────────┘
