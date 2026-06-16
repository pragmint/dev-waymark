import { describe, expect, it } from 'bun:test';
import {
  buildEntityUrl,
  parseFiltersFromForm,
  metaFiltersEqual,
  findMatchingPresetId,
} from './filterUrl';
import type { MetaFilter } from '../schemas/entity';
import type { PresetWithFilters } from '../schemas/preset';

describe('buildEntityUrl', () => {
  it('returns /entities for no filters', () => {
    expect(buildEntityUrl([])).toBe('/entities');
  });

  it('builds a query string for one filter', () => {
    expect(buildEntityUrl([{ key: 'entity_type', op: 'eq', value: 'jira_ticket' }])).toBe(
      '/entities?mf__entity_type__eq=jira_ticket'
    );
  });

  it('encodes special characters in values', () => {
    expect(buildEntityUrl([{ key: 'name', op: 'contains', value: 'foo bar&baz' }])).toContain(
      'foo+bar%26baz'
    );
  });

  it('preserves filter order in the output', () => {
    const url = buildEntityUrl([
      { key: 'a', op: 'eq', value: '1' },
      { key: 'b', op: 'eq', value: '2' },
    ]);
    expect(url.indexOf('mf__a__eq=1')).toBeLessThan(url.indexOf('mf__b__eq=2'));
  });
});

describe('parseFiltersFromForm', () => {
  it('extracts mf__key__op fields', () => {
    const form = new FormData();
    form.append('mf__entity_type__eq', 'jira_ticket');
    form.append('mf__status__eq', 'open');
    form.append('name', 'My Preset');
    expect(parseFiltersFromForm(form)).toEqual([
      { key: 'entity_type', op: 'eq', value: 'jira_ticket' },
      { key: 'status', op: 'eq', value: 'open' },
    ]);
  });

  it('skips empty values', () => {
    const form = new FormData();
    form.append('mf__entity_type__eq', '');
    form.append('mf__status__eq', 'open');
    expect(parseFiltersFromForm(form)).toEqual([{ key: 'status', op: 'eq', value: 'open' }]);
  });

  it('skips unknown ops', () => {
    const form = new FormData();
    form.append('mf__entity_type__BAD', 'x');
    form.append('mf__status__eq', 'open');
    expect(parseFiltersFromForm(form)).toEqual([{ key: 'status', op: 'eq', value: 'open' }]);
  });
});

describe('metaFiltersEqual', () => {
  const a: MetaFilter = { key: 'entity_type', op: 'eq', value: 'jira_ticket' };
  const b: MetaFilter = { key: 'status', op: 'eq', value: 'open' };

  it('returns true for identical lists', () => {
    expect(metaFiltersEqual([a, b], [a, b])).toBe(true);
  });

  it('is order-insensitive', () => {
    expect(metaFiltersEqual([a, b], [b, a])).toBe(true);
  });

  it('returns false for different lengths', () => {
    expect(metaFiltersEqual([a, b], [a])).toBe(false);
  });

  it('returns false for different values', () => {
    expect(metaFiltersEqual([a], [{ key: 'entity_type', op: 'eq', value: 'github_pr' }])).toBe(
      false
    );
  });

  it('returns true for two empty lists', () => {
    expect(metaFiltersEqual([], [])).toBe(true);
  });

  it('treats duplicate values correctly', () => {
    const dup: MetaFilter = { key: 'tag', op: 'eq', value: 'x' };
    expect(metaFiltersEqual([dup, dup], [dup])).toBe(false);
    expect(metaFiltersEqual([dup, dup], [dup, dup])).toBe(true);
  });
});

describe('findMatchingPresetId', () => {
  const preset1: PresetWithFilters = {
    id: 1,
    name: 'Tickets',
    filters: [{ key: 'entity_type', op: 'eq', value: 'jira_ticket' }],
  };
  const preset2: PresetWithFilters = {
    id: 2,
    name: 'Open PRs',
    filters: [
      { key: 'entity_type', op: 'eq', value: 'github_pr' },
      { key: 'status', op: 'eq', value: 'open' },
    ],
  };

  it('returns id of the matching preset', () => {
    expect(
      findMatchingPresetId(
        [{ key: 'entity_type', op: 'eq', value: 'jira_ticket' }],
        [preset1, preset2]
      )
    ).toBe(1);
  });

  it('matches regardless of order', () => {
    expect(
      findMatchingPresetId(
        [
          { key: 'status', op: 'eq', value: 'open' },
          { key: 'entity_type', op: 'eq', value: 'github_pr' },
        ],
        [preset1, preset2]
      )
    ).toBe(2);
  });

  it('returns null when nothing matches', () => {
    expect(
      findMatchingPresetId([{ key: 'entity_type', op: 'eq', value: 'other' }], [preset1, preset2])
    ).toBeNull();
  });

  it('returns null for empty filters when no empty preset exists', () => {
    expect(findMatchingPresetId([], [preset1, preset2])).toBeNull();
  });
});
