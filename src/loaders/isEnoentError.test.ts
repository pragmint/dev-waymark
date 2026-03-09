import { describe, expect, it } from 'bun:test';
import { isEnoentError } from './isEnoentError';

describe('isEnoentError', () => {
  it('returns true for an error with code ENOENT', () => {
    const error = Object.assign(new Error('ENOENT: no such file'), { code: 'ENOENT' });
    expect(isEnoentError(error)).toBe(true);
  });

  it('returns false for an error with a different code', () => {
    const error = Object.assign(new Error('EACCES: permission denied'), { code: 'EACCES' });
    expect(isEnoentError(error)).toBe(false);
  });

  it('returns false for a plain Error with no code', () => {
    expect(isEnoentError(new Error('something went wrong'))).toBe(false);
  });

  it('returns false for a plain object with no code', () => {
    expect(isEnoentError({ message: 'oops' })).toBe(false);
  });

  it('returns false for null', () => {
    expect(isEnoentError(null)).toBe(false);
  });

  it('returns false for a string', () => {
    expect(isEnoentError('ENOENT')).toBe(false);
  });

  it('returns false for undefined', () => {
    expect(isEnoentError(undefined)).toBe(false);
  });
});
