import { describe, expect, it } from 'bun:test';
import { isEnoentError } from './isEnoentError';

describe('isEnoentError', () => {
  it('returns true for an Error with code ENOENT', () => {
    const error = Object.assign(new Error('not found'), { code: 'ENOENT' });
    expect(isEnoentError(error)).toBe(true);
  });

  it('returns false for an Error with a different code', () => {
    const error = Object.assign(new Error('boom'), { code: 'EACCES' });
    expect(isEnoentError(error)).toBe(false);
  });

  it('returns false for non-Error values', () => {
    expect(isEnoentError('ENOENT')).toBe(false);
    expect(isEnoentError(null)).toBe(false);
    expect(isEnoentError(undefined)).toBe(false);
  });
});
