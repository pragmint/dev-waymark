import { z } from 'zod';

// The files a pipeline snapshot is made of, as pipeline/snapshot.py writes them. Keys are paths
// relative to the bucket root; `..`, absolute paths and quotes are rejected so a manifest can
// only name files under its own root.
const FileKeySchema = z
  .string()
  .regex(/^[A-Za-z0-9_][A-Za-z0-9_.+=-]*(\/[A-Za-z0-9_][A-Za-z0-9_.+=-]*)*$/)
  .refine(key => !key.split('/').includes('..'), 'File key leaves the bucket root');

// `latest.json`: which snapshot is published. Waymark reads whatever this names.
export const LatestSnapshotSchema = z.object({
  snapshot: z.string(),
  manifest: FileKeySchema,
});
export type LatestSnapshot = z.infer<typeof LatestSnapshotSchema>;

// `snapshots/<id>.json`: every table's exact files, `raw.<table>` for raw. Waymark needs only
// the files; the rest (row counts, job versions, verification) is for the pipeline.
export const SnapshotManifestSchema = z.object({
  version: z.literal(1),
  snapshot: z.string(),
  extract: z.string(),
  tables: z.record(z.string(), z.object({ files: z.array(FileKeySchema).min(1) })),
});
export type SnapshotManifest = z.infer<typeof SnapshotManifestSchema>;
