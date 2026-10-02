import { describe, expect, it } from 'bun:test';
import { followLink } from './links';

const pageOrigin = 'https://waymark.example.com';

function fakeLink(origin: string) {
  const link = { origin, clicks: 0, click: () => void link.clicks++ };
  return link;
}

describe('followLink', () => {
  it('clicks a same-origin link', () => {
    const link = fakeLink(pageOrigin);
    expect(followLink(link, pageOrigin)).toBe(true);
    expect(link.clicks).toBe(1);
  });

  it('refuses a link on another origin', () => {
    const link = fakeLink('https://evil.example.net');
    expect(followLink(link, pageOrigin)).toBe(false);
    expect(link.clicks).toBe(0);
  });

  it('refuses a javascript: or data: link, whose origin is opaque', () => {
    const link = fakeLink('null');
    expect(followLink(link, pageOrigin)).toBe(false);
    expect(link.clicks).toBe(0);
  });

  it('refuses a link with no href, whose origin is empty', () => {
    const link = fakeLink('');
    expect(followLink(link, pageOrigin)).toBe(false);
    expect(link.clicks).toBe(0);
  });

  it('refuses a missing link', () => {
    expect(followLink(undefined, pageOrigin)).toBe(false);
    expect(followLink(null, pageOrigin)).toBe(false);
  });
});
