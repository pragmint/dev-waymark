import { describe, test, expect } from 'bun:test';
import {
  chunkFailureText,
  chunkPartFilename,
  singleShotFailureMessage,
  splitDownloadOutcome,
  splitOfferState,
} from './exportProgress';

describe('splitOfferState', () => {
  test('describes the offer with thousands separators and the real threshold', () => {
    const s = splitOfferState({ totalCount: 33334, chunks: 6, rowsPerChunk: 5556 }, 10);
    expect(s.message).toContain('33,334');
    expect(s.message).toContain('over 10 seconds');
    expect(s.message).toContain('6 files');
    expect(s.message).toContain('5,556');
    expect(s.confirmLabel).toBe('Download 6 files');
  });

  // Regression: the chunk-failure path sets the cancel button to 'Close' and
  // nothing reset it, so every later opening of the modal still read 'Close'.
  test('always resets the cancel label, so a prior failure does not leak "Close"', () => {
    expect(splitOfferState({ totalCount: 10, chunks: 2, rowsPerChunk: 5 }, 10).cancelLabel).toBe(
      'Cancel'
    );
  });

  test('reflects the threshold it is given rather than a baked-in 10', () => {
    expect(splitOfferState({ totalCount: 10, chunks: 2, rowsPerChunk: 5 }, 30).message).toContain(
      'over 30 seconds'
    );
  });
});

describe('splitDownloadOutcome', () => {
  // Regression: the loop reported the *planned* chunk count unconditionally, so
  // a walk that ended early (a stripped X-Next-Cursor) still claimed every file
  // had been downloaded — a silent partial export reported as a success.
  test('reports incompleteness when fewer files landed than were planned', () => {
    const o = splitDownloadOutcome(1, 6);
    expect(o.complete).toBe(false);
    expect(o.text).not.toContain('Done');
    expect(o.text).toContain('1');
    expect(o.text).toContain('6');
  });

  test('reports success only when every planned file landed', () => {
    const o = splitDownloadOutcome(6, 6);
    expect(o.complete).toBe(true);
    expect(o.text).toBe('Done — downloaded 6 files.');
  });

  test('counts the actual files, not the plan, when more landed than planned', () => {
    expect(splitDownloadOutcome(7, 6).complete).toBe(true);
  });

  test('zero files downloaded is never a success', () => {
    expect(splitDownloadOutcome(0, 6).complete).toBe(false);
  });
});

describe('chunkFailureText', () => {
  test('names the file that failed out of the planned total', () => {
    expect(chunkFailureText(2, 6)).toBe(
      'File 3 of 6 failed to download. Close this and try again.'
    );
  });
});

describe('chunkPartFilename', () => {
  test('numbers parts from one and records the planned total', () => {
    expect(chunkPartFilename('entities-github-pr', 0, 6)).toBe('entities-github-pr-part1-of-6.csv');
    expect(chunkPartFilename('entities-github-pr', 5, 6)).toBe('entities-github-pr-part6-of-6.csv');
  });
});

describe('singleShotFailureMessage', () => {
  // Regression: downloadSingleShot's 'error' result was discarded by the click
  // handler, so a 500, a network drop, or the client abort left the user with a
  // button that silently returned to 'Export CSV' and no file.
  test('produces a message for a failed export', () => {
    expect(singleShotFailureMessage('error')).toBe('Export failed — try again');
  });

  test('stays silent for success and for the split-offer path', () => {
    expect(singleShotFailureMessage('ok')).toBeNull();
    expect(singleShotFailureMessage('timeout')).toBeNull();
  });
});
