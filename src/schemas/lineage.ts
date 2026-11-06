import { z } from 'zod';

// One `_sources` entry, as pipeline/CONTRACT.md defines it: a row one hop up.
export const SourceRefSchema = z.object({
  table: z.string(),
  row_id: z.string(),
});
export type SourceRef = z.infer<typeof SourceRefSchema>;

export const SourceRefsSchema = z.array(SourceRefSchema);

// A row of a pipeline table. Values are JSON (DuckDB's to_json), so nested
// lists, structs and maps survive as-is; long text may be truncated to a preview.
export const LineageRowSchema = z.object({
  rowId: z.string(),
  values: z.record(z.string(), z.unknown()),
});
export type LineageRow = z.infer<typeof LineageRowSchema>;

// The rows of one table that a row (or a set of rows) was built from.
export const ParentGroupSchema = z.object({
  table: z.string(),
  isRaw: z.boolean(),
  // False when the run has no such table to fetch rows from.
  available: z.boolean(),
  total: z.number(),
  rows: z.array(LineageRowSchema),
});
export type ParentGroup = z.infer<typeof ParentGroupSchema>;

// Row ids reached at one hop, keyed by table.
export const HopSchema = z.record(z.string(), z.array(z.string()));
export type Hop = z.infer<typeof HopSchema>;
