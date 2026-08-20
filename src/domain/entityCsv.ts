import type { EntityWithMetadata } from '../schemas/entity';
import { getEntityTitle, getMetadataValue } from './entityQueries';

// Quote a field when it contains a comma, quote, or newline; internal quotes are
// doubled per RFC 4180.
function escapeCsvField(value: string): string {
  return /[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
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

// Fallback for when the export times out before a single row is fetched
// (e.g. the count/metadata-key lookups alone blow the budget) — there's no
// measured throughput to extrapolate from, so this hands back the finest
// split the planner allows instead of guessing a number that could still
// be too coarse.
export function finestExportChunkPlan(totalCount: number): ExportChunkPlan {
  const rowsPerChunk = Math.max(MIN_ROWS_PER_CHUNK, Math.ceil(totalCount / MAX_CHUNKS));
  return { chunks: Math.ceil(totalCount / rowsPerChunk), rowsPerChunk };
}
