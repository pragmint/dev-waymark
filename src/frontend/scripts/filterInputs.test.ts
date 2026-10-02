import { describe, expect, it } from 'bun:test';
import { parseFilterConfig } from './filterInputs';

describe('parseFilterConfig', () => {
  it('keeps a well-formed config', () => {
    expect(
      parseFilterConfig({ selectedPresetId: 3, selectedEntityType: 'jira_ticket', isDraft: true })
    ).toEqual({ selectedPresetId: 3, selectedEntityType: 'jira_ticket', isDraft: true });
  });

  it('drops malformed fields', () => {
    expect(
      parseFilterConfig({ selectedPresetId: '3', selectedEntityType: 7, isDraft: 'true' })
    ).toEqual({ selectedPresetId: null, selectedEntityType: null, isDraft: false });
  });

  it('drops a preset id that is not a positive integer', () => {
    for (const selectedPresetId of [0, -1, 1.5, 'javascript:alert(1)']) {
      expect(parseFilterConfig({ selectedPresetId }).selectedPresetId).toBeNull();
    }
  });

  it('returns the defaults for a missing or malformed embed', () => {
    const defaults = { selectedPresetId: null, selectedEntityType: null, isDraft: false };
    expect(parseFilterConfig(null)).toEqual(defaults);
    expect(parseFilterConfig([1])).toEqual(defaults);
  });
});
