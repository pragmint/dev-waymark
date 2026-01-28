import { describe, test, expect } from 'bun:test';
import { filenameToTitle } from './stringUtils';

describe('filenameToTitle', () => {
  test('converts basic kebab-case to Title Case', () => {
    expect(filenameToTitle('code-maintainability')).toBe('Code Maintainability');
  });

  test('converts single word', () => {
    expect(filenameToTitle('testing')).toBe('Testing');
  });

  test('handles special case for "ai" - converts to uppercase', () => {
    expect(filenameToTitle('ai-powered-testing')).toBe('AI Powered Testing');
    expect(filenameToTitle('testing-with-ai')).toBe('Testing With AI');
    expect(filenameToTitle('ai')).toBe('AI');
  });

  test('keeps articles and prepositions lowercase (except at start)', () => {
    expect(filenameToTitle('the-art-of-testing')).toBe('The Art of Testing');
    expect(filenameToTitle('code-and-tests')).toBe('Code and Tests');
    expect(filenameToTitle('path-to-success')).toBe('Path to Success');
    expect(filenameToTitle('testing-in-production')).toBe('Testing in Production');
  });

  test('capitalizes first word even if it is an article/preposition', () => {
    expect(filenameToTitle('the-beginning')).toBe('The Beginning');
    expect(filenameToTitle('and-another-thing')).toBe('And Another Thing');
  });

  test('handles real experiment filename', () => {
    expect(filenameToTitle('enforce-types-with-a-linter')).toBe('Enforce Types With a Linter');
  });

  test('handles multiple consecutive lowercase words', () => {
    expect(filenameToTitle('journey-to-the-center-of-the-earth')).toBe(
      'Journey to the Center of the Earth'
    );
  });

  test('handles mixed special cases', () => {
    expect(filenameToTitle('ai-and-the-future-of-testing')).toBe('AI and the Future of Testing');
  });
});
