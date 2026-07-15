import { describe, expect, it } from 'bun:test';
import { parseOtherWorktreeIgnoreArgs } from './worktreeIgnores';

describe('parseOtherWorktreeIgnoreArgs', () => {
  it('ignores the main worktree (matches cwd)', () => {
    const output = 'worktree /repo\nHEAD abc123\nbranch refs/heads/main\n';
    expect(parseOtherWorktreeIgnoreArgs(output, '/repo')).toEqual([]);
  });

  it('returns a negated pattern for a worktree nested under the repo', () => {
    const output = [
      'worktree /repo',
      'HEAD abc123',
      'branch refs/heads/main',
      '',
      'worktree /repo/extra-wide-viz',
      'HEAD def456',
      'branch refs/heads/extra-wide-viz',
      '',
    ].join('\n');
    expect(parseOtherWorktreeIgnoreArgs(output, '/repo')).toEqual(['!extra-wide-viz']);
  });

  it('returns one pattern per additional worktree', () => {
    const output = [
      'worktree /repo',
      'HEAD abc123',
      'branch refs/heads/main',
      '',
      'worktree /repo/feature-a',
      'HEAD def456',
      'branch refs/heads/feature-a',
      '',
      'worktree /repo/feature-b',
      'HEAD ghi789',
      'branch refs/heads/feature-b',
      '',
    ].join('\n');
    expect(parseOtherWorktreeIgnoreArgs(output, '/repo')).toEqual(['!feature-a', '!feature-b']);
  });

  it('excludes a worktree that lives outside the repo directory', () => {
    const output = [
      'worktree /repo',
      'HEAD abc123',
      'branch refs/heads/main',
      '',
      'worktree /sibling-dir/other-worktree',
      'HEAD def456',
      'branch refs/heads/other',
      '',
    ].join('\n');
    expect(parseOtherWorktreeIgnoreArgs(output, '/repo')).toEqual([]);
  });

  it('handles a nested worktree path with multiple path segments', () => {
    const output = [
      'worktree /repo',
      'HEAD abc123',
      'branch refs/heads/main',
      '',
      'worktree /repo/worktrees/deep/nested-branch',
      'HEAD def456',
      'branch refs/heads/nested-branch',
      '',
    ].join('\n');
    expect(parseOtherWorktreeIgnoreArgs(output, '/repo')).toEqual([
      '!worktrees/deep/nested-branch',
    ]);
  });

  it('returns an empty array when there are no other worktrees', () => {
    const output = 'worktree /repo\nHEAD abc123\nbranch refs/heads/main\n';
    expect(parseOtherWorktreeIgnoreArgs(output, '/repo')).toEqual([]);
  });

  it('returns an empty array for empty input', () => {
    expect(parseOtherWorktreeIgnoreArgs('', '/repo')).toEqual([]);
  });
});
