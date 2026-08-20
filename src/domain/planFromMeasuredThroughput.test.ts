import { describe, test, expect } from 'bun:test';
import { finestExportChunkPlan, planExportChunks, planFromMeasuredThroughput } from './entityCsv';

describe('planFromMeasuredThroughput', () => {
  // Before this lived in src/domain/, the 1.5x discount was inline in
  // entitiesHandler.tsx and could not be asserted without driving HTTP.
  test('discounts the measured rate, planning more chunks than the raw rate would', () => {
    // 1,000 rows in 1,000ms = 1,000 rows/sec measured.
    const discounted = planFromMeasuredThroughput(50_000, 1_000, 1_000);
    const undiscounted = planExportChunks(50_000, 1_000);
    expect(discounted.chunks).toBeGreaterThan(undiscounted.chunks);
    expect(discounted.rowsPerChunk).toBeLessThan(undiscounted.rowsPerChunk);
  });

  test('plans from the discounted rate exactly', () => {
    expect(planFromMeasuredThroughput(50_000, 1_000, 1_000)).toEqual(
      planExportChunks(50_000, 1_000 / 1.5)
    );
  });

  test('falls back to the finest split when no rows were fetched', () => {
    expect(planFromMeasuredThroughput(50_000, 0, 12_000)).toEqual(finestExportChunkPlan(50_000));
  });

  test('falls back to the finest split rather than dividing by a zero elapsed time', () => {
    const plan = planFromMeasuredThroughput(50_000, 100, 0);
    expect(plan).toEqual(finestExportChunkPlan(50_000));
    expect(Number.isFinite(plan.rowsPerChunk)).toBe(true);
  });
});
