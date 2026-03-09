import { describe, test, expect } from 'bun:test';
import { normalizeDimensionScores } from './metricSchemas';

describe('normalizeDimensionScores', () => {
  test('converts a single-dimension array to an object', () => {
    const result = normalizeDimensionScores([{ 'new-code': 2 }]);
    expect(result.value).toEqual({ 'new-code': 2 });
    expect(result.dimensionJustifications).toBeUndefined();
  });

  test('converts multiple dimensions to a flat object', () => {
    const result = normalizeDimensionScores([{ 'new-code': 2 }, { 'old-code': 3 }]);
    expect(result.value).toEqual({ 'new-code': 2, 'old-code': 3 });
  });

  test('extracts dimensionJustifications when present', () => {
    const result = normalizeDimensionScores([
      { 'new-code': 2, justification: 'Needs work' },
      { 'old-code': 3, justification: 'Getting better' },
    ]);
    expect(result.value).toEqual({ 'new-code': 2, 'old-code': 3 });
    expect(result.dimensionJustifications).toEqual({
      'new-code': 'Needs work',
      'old-code': 'Getting better',
    });
  });

  test('omits dimensionJustifications entirely when no justifications present', () => {
    const result = normalizeDimensionScores([{ 'new-code': 2 }, { 'old-code': 3 }]);
    expect(result.dimensionJustifications).toBeUndefined();
  });

  test('only includes dimensions with justifications in dimensionJustifications', () => {
    const result = normalizeDimensionScores([
      { 'new-code': 2, justification: 'Needs work' },
      { 'old-code': 3 },
    ]);
    expect(result.dimensionJustifications).toEqual({ 'new-code': 'Needs work' });
  });

  test('silently skips items with no dimension key (only justification)', () => {
    const result = normalizeDimensionScores([{ justification: 'Orphaned' }, { 'new-code': 2 }]);
    expect(result.value).toEqual({ 'new-code': 2 });
  });

  test('silently skips items where dimension value is not a number', () => {
    const result = normalizeDimensionScores([{ 'new-code': 'not-a-number' }, { 'old-code': 3 }]);
    expect(result.value).toEqual({ 'old-code': 3 });
  });

  test('returns empty value object for an empty array', () => {
    const result = normalizeDimensionScores([]);
    expect(result.value).toEqual({});
    expect(result.dimensionJustifications).toBeUndefined();
  });
});
