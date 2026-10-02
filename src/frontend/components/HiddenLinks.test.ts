import { describe, expect, it } from 'bun:test';
import { HiddenLinks } from './HiddenLinks';

describe('HiddenLinks', () => {
  it('renders one link per href, in order, inside a hidden named container', () => {
    const html = String(HiddenLinks({ name: 'points', hrefs: ['/entities?f=a', '/entities?f=b'] }));
    expect(html).toBe(
      '<div hidden="" data-links="points"><a href="/entities?f=a"></a><a href="/entities?f=b"></a></div>'
    );
  });

  it('keeps a placeholder link without an href for a null entry', () => {
    const html = String(HiddenLinks({ name: 'points', hrefs: [null, '/entities'] }));
    expect(html).toBe('<div hidden="" data-links="points"><a></a><a href="/entities"></a></div>');
  });

  it('escapes hrefs', () => {
    const html = String(HiddenLinks({ name: 'points', hrefs: ['/entities?a=1&b="x"'] }));
    expect(html).toContain('href="/entities?a=1&amp;b=&quot;x&quot;"');
  });
});
