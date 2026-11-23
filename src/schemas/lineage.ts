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
  // Columns to show first: the ones a selected field is computed from.
  highlight: z.array(z.string()),
});
export type ParentGroup = z.infer<typeof ParentGroupSchema>;

// Row ids reached at one hop, keyed by table.
export const HopSchema = z.record(z.string(), z.array(z.string()));
export type Hop = z.infer<typeof HopSchema>;

// Column lineage (pipeline/CONTRACT.md, "Column lineage"): each output column lists the input
// columns it is computed from, as `<table>.<column>` or `<table>.<column>:<json path>`, with
// `<table>[<column>=<value>]` for only the rows of the table whose column holds value. A row's
// `_fields` says this for that row alone; a table's column map, read from its Parquet metadata,
// is the union over all of its rows.
export const ColumnMapSchema = z.record(z.string(), z.array(z.string()));
export type ColumnMap = z.infer<typeof ColumnMapSchema>;

export const ColumnRefSchema = z.object({
  table: z.string(),
  column: z.string(),
  path: z.string().optional(),
  where: z.object({ column: z.string(), value: z.string() }).optional(),
});
export type ColumnRef = z.infer<typeof ColumnRefSchema>;
