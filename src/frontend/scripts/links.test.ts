import { describe, expect, it } from 'bun:test';
import { followLink, wireSelectToLinks } from './links';

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

describe('wireSelectToLinks', () => {
  function fakeSelect() {
    const select = {
      selectedIndex: 0,
      onChange: () => {},
      addEventListener: (_type: 'change', listener: () => void) => {
        select.onChange = listener;
      },
    };
    return select;
  }

  it('follows the link paired with the chosen option and reports it', () => {
    const select = fakeSelect();
    const links = [fakeLink(''), fakeLink(pageOrigin)];
    let followed = 0;
    wireSelectToLinks(select, links, pageOrigin, () => followed++);
    select.selectedIndex = 1;
    select.onChange();
    expect(links[1].clicks).toBe(1);
    expect(followed).toBe(1);
  });

  it('does nothing when the paired link is refused or missing', () => {
    const select = fakeSelect();
    const links = [fakeLink('null')];
    let followed = 0;
    wireSelectToLinks(select, links, pageOrigin, () => followed++);
    select.onChange();
    select.selectedIndex = 5;
    select.onChange();
    expect(links[0].clicks).toBe(0);
    expect(followed).toBe(0);
  });
});
