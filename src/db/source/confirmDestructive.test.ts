import { describe, expect, it } from 'bun:test';
import { maskConnectionTarget } from './confirmDestructive';

describe('maskConnectionTarget', () => {
  it('strips credentials from a postgres URL', () => {
    expect(maskConnectionTarget('postgresql://waymark:waymark@localhost:5433/waymark_source')).toBe(
      'postgresql://localhost:5433/waymark_source'
    );
  });

  it('strips credentials from a redshift URL', () => {
    expect(maskConnectionTarget('redshift://user:password@redshift-host:5439/warehouse')).toBe(
      'redshift://redshift-host:5439/warehouse'
    );
  });

  it('handles URLs with no credentials', () => {
    expect(maskConnectionTarget('postgresql://localhost:5433/mydb')).toBe(
      'postgresql://localhost:5433/mydb'
    );
  });

  it('returns the original string for an unparseable URL', () => {
    expect(maskConnectionTarget('not a url')).toBe('not a url');
  });
});
