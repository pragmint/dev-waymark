import { describe, expect, it } from 'bun:test';
import { JsonEmbed, serializeJsonForScript } from './JsonEmbed';

describe('serializeJsonForScript', () => {
  it('escapes characters that could end the script element', () => {
    const out = serializeJsonForScript({ value: '</script><img src=x onerror=alert(1)>' });
    expect(out).not.toContain('<');
    expect(out).not.toContain('>');
  });

  it('round-trips through JSON.parse unchanged', () => {
    const value = { a: '</script>&<!--', b: 'line\u2028sep\u2029', n: [1, null, true] };
    expect(JSON.parse(serializeJsonForScript(value))).toEqual(value);
  });

  it('serializes undefined as null', () => {
    expect(serializeJsonForScript(undefined)).toBe('null');
  });
});

describe('JsonEmbed', () => {
  it('renders an inert JSON script with the escaped payload', () => {
    const html = String(JsonEmbed({ id: 'filter-tree-initial', value: { v: '</script>' } }));
    expect(html).toBe(
      '<script type="application/json" id="filter-tree-initial">{"v":"\\u003c/script\\u003e"}</script>'
    );
  });
});
