import type { EntityWithMetadata } from '../schemas/entity';
import { getEntityTitle, getMetadataValue } from './entityQueries';

// Excel and Sheets treat a leading `=` or `@` as the start of a formula or a
// DDE call, so an entity name like `=cmd|/c calc!A1` — which can arrive from a
// Jira title or a branch name — would execute when the file is opened, and this
// CSV exists to be opened in a spreadsheet. A leading apostrophe forces the
// cell to be read as literal text.
//
// `-` and `+` are deliberately NOT guarded: they lead legitimate signed numbers
// in metadata, and quoting those would corrupt real values to fix a lesser risk.
function neutralizeFormula(value: string): string {
  return /^[=@]/.test(value) ? `'${value}` : value;
}

// Quote a field when it contains a comma, quote, or newline; internal quotes are
// doubled per RFC 4180. Formula neutralization happens first so the apostrophe
// lands inside the quotes when both apply.
function escapeCsvField(value: string): string {
  const safe = neutralizeFormula(value);
  return /[",\r\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

function csvRow(fields: (string | number)[]): string {
  return fields.map(field => escapeCsvField(String(field))).join(',');
}

export function csvHeaderRow(metadataKeys: string[]): string {
  return csvRow(['Entity', 'Type', ...metadataKeys]);
}

// One serialized row per entity, without the header — split out so callers
// that stream/batch large exports (see entitiesExportHandler) can interleave
// serialization with fetching instead of paying for it all at once at the end.
export function csvDataRows(entities: EntityWithMetadata[], metadataKeys: string[]): string[] {
  return entities.map(e =>
    csvRow([getEntityTitle(e), e.type, ...metadataKeys.map(k => getMetadataValue(e, k) ?? '')])
  );
}

// Build a CSV whose columns mirror the entity table: Entity, Type, then one
// column per metadata key. Null/absent metadata renders as an empty cell.
export function entitiesToCsv(entities: EntityWithMetadata[], metadataKeys: string[]): string {
  return [csvHeaderRow(metadataKeys), ...csvDataRows(entities, metadataKeys)].join('\r\n');
}

export function exportFilenameSlug(entityType: string | null): string {
  return (entityType ?? 'all').replace(/[^a-z0-9]+/gi, '-').toLowerCase();
}

export type ExportChunkPlan = {
  chunks: number;
  rowsPerChunk: number;
};

// Per-chunk target well under the hard EXPORT_TIMEOUT_MS cap (see
// entitiesHandler.tsx) — leaves headroom for network/serialization overhead
// and for the measured throughput being a rough estimate, not a guarantee.
const TARGET_SECONDS_PER_CHUNK = 7;
const MIN_ROWS_PER_CHUNK = 100;
const MAX_CHUNKS = 50;

// Given how many rows/sec the server actually managed while timing out, plan
// how to split the full export into same-sized chunks that should each land
// comfortably inside the timeout budget.
export function planExportChunks(totalCount: number, rowsPerSecond: number): ExportChunkPlan {
  if (totalCount <= 0 || rowsPerSecond <= 0)
    return { chunks: 1, rowsPerChunk: Math.max(totalCount, 1) };
  const estimatedTotalSeconds = totalCount / rowsPerSecond;
  const rawChunks = Math.ceil(estimatedTotalSeconds / TARGET_SECONDS_PER_CHUNK);
  const chunks = Math.min(MAX_CHUNKS, Math.max(2, rawChunks));
  const rowsPerChunk = Math.max(MIN_ROWS_PER_CHUNK, Math.ceil(totalCount / chunks));
  // Recompute chunk count from the rounded-up rowsPerChunk so the two numbers
  // stay consistent (chunks * rowsPerChunk >= totalCount) for the caller.
  const actualChunks = Math.ceil(totalCount / rowsPerChunk);
  return { chunks: actualChunks, rowsPerChunk };
}

// The measured rate is discounted by this factor before planning. The timing
// comes from a single window that may have enjoyed favorable caching or low
// contention, so planning at the observed rate would leave chunks with no
// headroom against the timeout they exist to avoid.
const THROUGHPUT_SAFETY_FACTOR = 1.5;

// Turn a timed-out export's measured progress into a chunk plan. `fetched` is 0
// when the budget was blown before a single row came back (e.g. the count and
// metadata-key lookups alone took too long) — there is no throughput to
// extrapolate from, so fall back to the finest split the planner allows.
export function planFromMeasuredThroughput(
  totalCount: number,
  fetched: number,
  elapsedMs: number
): ExportChunkPlan {
  if (fetched <= 0 || elapsedMs <= 0) return finestExportChunkPlan(totalCount);
  const measuredRowsPerSecond = fetched / (elapsedMs / 1000);
  return planExportChunks(totalCount, measuredRowsPerSecond / THROUGHPUT_SAFETY_FACTOR);
}

// Fallback for when the export times out before a single row is fetched
// (e.g. the count/metadata-key lookups alone blow the budget) — there's no
// measured throughput to extrapolate from, so this hands back the finest
// split the planner allows instead of guessing a number that could still
// be too coarse.
export function finestExportChunkPlan(totalCount: number): ExportChunkPlan {
  const rowsPerChunk = Math.max(MIN_ROWS_PER_CHUNK, Math.ceil(totalCount / MAX_CHUNKS));
  return { chunks: Math.ceil(totalCount / rowsPerChunk), rowsPerChunk };
}
