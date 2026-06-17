import { describe, expect, it } from 'bun:test';
import { templateCardState } from './templateCardState';

describe('templateCardState', () => {
  it('returns a disabled state with href "#" when preset is unselected', () => {
    expect(templateCardState('category_breakdown', '')).toEqual({
      href: '#',
      disabled: true,
    });
  });

  it('builds the new-visualization href when a preset is selected', () => {
    expect(templateCardState('category_breakdown', '42')).toEqual({
      href: '/visualizations/new/category_breakdown?preset_id=42',
      disabled: false,
    });
  });
});
