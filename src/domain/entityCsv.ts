import type { EntityWithMetadata } from '../schemas/entity';
import { getEntityTitle, getMetadataValue } from './entityQueries';

// Quote a field when it contains a comma, quote, or newline; internal quotes are
// doubled per RFC 4180.
function escapeCsvField(value: string): string {
  return /[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

// Build a CSV whose columns mirror the entity table: Entity, Type, then one
// column per metadata key. Null/absent metadata renders as an empty cell.
export function entitiesToCsv(entities: EntityWithMetadata[], metadataKeys: string[]): string {
  const header = ['Entity', 'Type', ...metadataKeys];
  const rows = entities.map(e => [
    getEntityTitle(e),
    e.type,
    ...metadataKeys.map(k => getMetadataValue(e, k) ?? ''),
  ]);
  return [header, ...rows]
    .map(row => row.map(field => escapeCsvField(String(field))).join(','))
    .join('\r\n');
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
