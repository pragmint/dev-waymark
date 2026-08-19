import { describe, test, expect } from 'bun:test';
import { entitiesToCsv, exportFilenameSlug, planExportChunks } from './entityCsv';
import type { EntityWithMetadata } from '../schemas/entity';

function entity(
  name: string,
  type: string,
  metadata: Record<string, string | null>
): EntityWithMetadata {
  return {
    id: 1,
    name,
    type,
    created_at: '2026-01-01T00:00:00Z',
    metadata: Object.entries(metadata).map(([key, value]) => ({
      entity_id: 1,
      key,
      value,
      value_type: 'string',
      created_at: '2026-01-01T00:00:00Z',
      updated_at: '2026-01-01T00:00:00Z',
    })),
  };
}

describe('entitiesToCsv', () => {
  test('emits Entity, Type, then a column per metadata key', () => {
    const csv = entitiesToCsv(
      [entity('PR-1', 'github_pr', { author: 'dave', size: '10' })],
      ['author', 'size']
    );
    expect(csv).toBe('Entity,Type,author,size\r\nPR-1,github_pr,dave,10');
  });

  test('renders missing/null metadata as an empty cell', () => {
    const csv = entitiesToCsv(
      [entity('PR-1', 'github_pr', { author: null })],
      ['author', 'absent']
    );
    expect(csv).toBe('Entity,Type,author,absent\r\nPR-1,github_pr,,');
  });

  test('quotes fields containing commas, quotes, or newlines (RFC 4180)', () => {
    const csv = entitiesToCsv(
      [entity('a,b', 'type', { note: 'say "hi"', multi: 'line1\nline2' })],
      ['note', 'multi']
    );
    expect(csv).toBe('Entity,Type,note,multi\r\n"a,b",type,"say ""hi""","line1\nline2"');
  });

  test('header-only output when there are no entities', () => {
    expect(entitiesToCsv([], ['author'])).toBe('Entity,Type,author');
  });
});

describe('exportFilenameSlug', () => {
  test('lowercases and dashes non-alphanumeric characters', () => {
    expect(exportFilenameSlug('GitHub PR')).toBe('github-pr');
  });

  test('falls back to "all" when no entity type is selected', () => {
    expect(exportFilenameSlug(null)).toBe('all');
  });
});

describe('planExportChunks', () => {
  test('plans enough chunks to land each one under the per-chunk target', () => {
    // 50,000 rows at 5,000 rows/sec is 10s total — comfortably over the 7s
    // per-chunk target, so it must be split into at least 2 pieces.
    const plan = planExportChunks(50_000, 5_000);
    expect(plan.chunks).toBeGreaterThanOrEqual(2);
    expect(plan.rowsPerChunk * plan.chunks).toBeGreaterThanOrEqual(50_000);
  });

  test('never returns fewer than 2 chunks once splitting is triggered', () => {
    const plan = planExportChunks(1_000, 900);
    expect(plan.chunks).toBeGreaterThanOrEqual(2);
  });

  test('caps chunk count so huge datasets do not produce absurd numbers of files', () => {
    const plan = planExportChunks(10_000_000, 100);
    expect(plan.chunks).toBeLessThanOrEqual(50);
  });

  test('enforces a minimum rows-per-chunk floor', () => {
    const plan = planExportChunks(300, 1);
    expect(plan.rowsPerChunk).toBeGreaterThanOrEqual(100);
  });

  test('handles a zero/degenerate throughput without dividing by zero', () => {
    const plan = planExportChunks(1000, 0);
    expect(Number.isFinite(plan.chunks)).toBe(true);
    expect(Number.isFinite(plan.rowsPerChunk)).toBe(true);
  });
});
