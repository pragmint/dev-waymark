Codebase Audit Report

7. Naming Confusion

- enrich\* functions in src/domain/metricAggregations.ts — vague. They compute
  scores, trends, and aggregate metrics. calculateCapabilityMetrics() etc. would
  be clearer.
- Metric vs CapabilityMetric vs TeamMetric — base Metric type is ambiguous;  
  unclear whether it refers to capability or team metrics.
- ParsedCapability — only parsed schema type with "Parsed" prefix; inconsistent
  with other parsed structures.

---

9. Schema Transforms Doing Too Much

src/schemas/metricSchemas.ts:20-47 — Zod .transform() does significant data
reshaping (array→object conversion, field extraction). This logic should be a  
 pure function tested separately, not embedded in a schema validator.
