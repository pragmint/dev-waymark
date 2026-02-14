import { describe, test, expect } from 'bun:test';
import {
  parseMarkdown,
  extractTitle,
  transformCapabilityLinks,
  transformPracticeLinks,
  transformResourceLinks,
} from './index';

describe('parseMarkdown', () => {
  test('converts markdown heading to HTML', async () => {
    const result = await parseMarkdown('# Hello');
    expect(result).toContain('<h1');
    expect(result).toContain('Hello');
  });

  test('converts markdown paragraph to HTML', async () => {
    const result = await parseMarkdown('Some text here');
    expect(result).toContain('<p>Some text here</p>');
  });

  test('converts bold and italic', async () => {
    const result = await parseMarkdown('**bold** and *italic*');
    expect(result).toContain('<strong>bold</strong>');
    expect(result).toContain('<em>italic</em>');
  });

  test('converts a markdown link to an anchor tag', async () => {
    const result = await parseMarkdown('[click](https://example.com)');
    expect(result).toContain('<a href="https://example.com">click</a>');
  });

  test('converts a markdown list to HTML', async () => {
    const result = await parseMarkdown('- item one\n- item two');
    expect(result).toContain('<ul>');
    expect(result).toContain('<li>item one</li>');
    expect(result).toContain('<li>item two</li>');
  });

  test('handles empty string', async () => {
    const result = await parseMarkdown('');
    expect(result).toBe('');
  });
});

describe('extractTitle', () => {
  test('extracts title from H1 heading', () => {
    const markdown = '# My Title\n\nSome content';
    expect(extractTitle(markdown, 'fallback')).toBe('My Title');
  });

  test('returns fallback when no H1 heading exists', () => {
    const markdown = 'No heading here\n\nJust paragraphs';
    expect(extractTitle(markdown, 'my-fallback-id')).toBe('my-fallback-id');
  });

  test('extracts title from H1 even when not on first line', () => {
    const markdown = 'Some preamble\n\n# Actual Title\n\nContent';
    expect(extractTitle(markdown, 'fallback')).toBe('Actual Title');
  });

  test('extracts first H1 when multiple exist', () => {
    const markdown = '# First Title\n\n# Second Title';
    expect(extractTitle(markdown, 'fallback')).toBe('First Title');
  });

  test('does not match H2 or deeper headings', () => {
    const markdown = '## Not a title\n### Also not';
    expect(extractTitle(markdown, 'fallback')).toBe('fallback');
  });
});

describe('transformCapabilityLinks', () => {
  test('transforms capability .md links to catalog URLs', () => {
    const html = '<a href="/capabilities/continuous-integration.md">CI</a>';
    const result = transformCapabilityLinks(html);
    expect(result).toBe('<a href="/catalog/capability/continuous-integration/">CI</a>');
  });

  test('transforms multiple capability links', () => {
    const html =
      '<a href="/capabilities/code-maintainability.md">CM</a> and <a href="/capabilities/continuous-delivery.md">CD</a>';
    const result = transformCapabilityLinks(html);
    expect(result).toContain('href="/catalog/capability/code-maintainability/"');
    expect(result).toContain('href="/catalog/capability/continuous-delivery/"');
  });

  test('does not transform non-capability links', () => {
    const html = '<a href="/practices/pair-programming.md">PP</a>';
    const result = transformCapabilityLinks(html);
    expect(result).toBe(html);
  });

  test('does not transform external links', () => {
    const html = '<a href="https://example.com">link</a>';
    const result = transformCapabilityLinks(html);
    expect(result).toBe(html);
  });

  test('handles HTML with no links', () => {
    const html = '<p>No links here</p>';
    expect(transformCapabilityLinks(html)).toBe(html);
  });
});

describe('transformPracticeLinks', () => {
  test('transforms practice .md links to catalog URLs', () => {
    const html = '<a href="/practices/pair-programming.md">PP</a>';
    const result = transformPracticeLinks(html);
    expect(result).toBe('<a href="/catalog/practice/pair-programming/">PP</a>');
  });

  test('transforms multiple practice links', () => {
    const html =
      '<a href="/practices/trunk-based-dev.md">TBD</a> and <a href="/practices/code-review.md">CR</a>';
    const result = transformPracticeLinks(html);
    expect(result).toContain('href="/catalog/practice/trunk-based-dev/"');
    expect(result).toContain('href="/catalog/practice/code-review/"');
  });

  test('does not transform capability links', () => {
    const html = '<a href="/capabilities/continuous-integration.md">CI</a>';
    const result = transformPracticeLinks(html);
    expect(result).toBe(html);
  });
});

describe('transformResourceLinks', () => {
  test('transforms resource .md links to GitHub URLs', () => {
    const html = '<a href="/resources/some-doc.md">Doc</a>';
    const result = transformResourceLinks(html);
    expect(result).toBe(
      '<a href="https://github.com/pragmint/open-practices/blob/main/resources/some-doc.md">Doc</a>'
    );
  });

  test('transforms multiple resource links', () => {
    const html = '<a href="/resources/a.md">A</a> <a href="/resources/b.md">B</a>';
    const result = transformResourceLinks(html);
    expect(result).toContain(
      'href="https://github.com/pragmint/open-practices/blob/main/resources/a.md"'
    );
    expect(result).toContain(
      'href="https://github.com/pragmint/open-practices/blob/main/resources/b.md"'
    );
  });

  test('handles resources in subdirectories', () => {
    const html = '<a href="/resources/guides/setup.md">Setup</a>';
    const result = transformResourceLinks(html);
    expect(result).toBe(
      '<a href="https://github.com/pragmint/open-practices/blob/main/resources/guides/setup.md">Setup</a>'
    );
  });

  test('does not transform non-resource links', () => {
    const html = '<a href="/capabilities/ci.md">CI</a>';
    const result = transformResourceLinks(html);
    expect(result).toBe(html);
  });
});
