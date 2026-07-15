import { describe, expect, it } from 'bun:test';
import { WaymarkInputSchema, WaymarkSchema } from './waymark';

function validInput(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    startDate: '2026-04-01',
    endDate: '2026-10-01',
    targetValue: 100,
    appliesTo: 'main',
    label: null,
    ...overrides,
  };
}

describe('WaymarkInputSchema', () => {
  it('accepts a valid input', () => {
    expect(WaymarkInputSchema.safeParse(validInput()).success).toBe(true);
  });

  it('accepts a valid input with a label', () => {
    const result = WaymarkInputSchema.safeParse(validInput({ label: 'Q3 goal' }));
    expect(result.success).toBe(true);
  });

  it('accepts appliesTo: smoothing', () => {
    expect(WaymarkInputSchema.safeParse(validInput({ appliesTo: 'smoothing' })).success).toBe(true);
  });

  it('rejects endDate equal to startDate', () => {
    const result = WaymarkInputSchema.safeParse(
      validInput({ startDate: '2026-04-01', endDate: '2026-04-01' })
    );
    expect(result.success).toBe(false);
  });

  it('rejects endDate before startDate', () => {
    const result = WaymarkInputSchema.safeParse(
      validInput({ startDate: '2026-10-01', endDate: '2026-04-01' })
    );
    expect(result.success).toBe(false);
  });

  it('rejects a non-finite target value', () => {
    expect(WaymarkInputSchema.safeParse(validInput({ targetValue: NaN })).success).toBe(false);
    expect(WaymarkInputSchema.safeParse(validInput({ targetValue: Infinity })).success).toBe(false);
  });

  it('rejects an empty startDate or endDate', () => {
    expect(WaymarkInputSchema.safeParse(validInput({ startDate: '' })).success).toBe(false);
    expect(WaymarkInputSchema.safeParse(validInput({ endDate: '' })).success).toBe(false);
  });

  it('rejects an invalid appliesTo value', () => {
    expect(WaymarkInputSchema.safeParse(validInput({ appliesTo: 'bogus' })).success).toBe(false);
  });

  it('rejects a missing label field', () => {
    const result = WaymarkInputSchema.safeParse({
      startDate: '2026-04-01',
      endDate: '2026-10-01',
      targetValue: 100,
      appliesTo: 'main',
    });
    expect(result.success).toBe(false);
  });
});

describe('WaymarkSchema', () => {
  it('parses a full waymark row', () => {
    const result = WaymarkSchema.safeParse({
      id: 1,
      visualizationId: 2,
      startDate: '2026-04-01',
      endDate: '2026-10-01',
      targetValue: 100,
      appliesTo: 'main',
      label: null,
      createdAt: '2026-04-01T00:00:00.000Z',
      updatedAt: '2026-04-01T00:00:00.000Z',
    });
    expect(result.success).toBe(true);
  });

  it('does not enforce endDate > startDate (unlike WaymarkInputSchema)', () => {
    // Rows already persisted are trusted as-is; the ordering guard only
    // applies to new input from the create/update handlers.
    const result = WaymarkSchema.safeParse({
      id: 1,
      visualizationId: 2,
      startDate: '2026-10-01',
      endDate: '2026-04-01',
      targetValue: 100,
      appliesTo: 'main',
      label: null,
      createdAt: '2026-04-01T00:00:00.000Z',
      updatedAt: '2026-04-01T00:00:00.000Z',
    });
    expect(result.success).toBe(true);
  });
});
