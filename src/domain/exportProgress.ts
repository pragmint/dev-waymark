// State and messaging decisions for the client-side CSV export flow, driven by
// src/frontend/scripts/exportCsv.ts. They live here rather than inline in that
// script because the script cannot be imported under `bun test` — it wires DOM
// listeners at module load — so anything left inline is unreachable by a unit
// test. Keeping the decisions pure lets the script stay a thin DOM adapter.

export type SplitOffer = {
  totalCount: number;
  chunks: number;
  rowsPerChunk: number;
};

export type SplitModalState = {
  message: string;
  confirmLabel: string;
  cancelLabel: string;
};

// Every label is returned on every call, including the ones that rarely change:
// the modal is a single reused element, so a state left behind by an earlier
// run (the chunk-failure path relabels Cancel to 'Close') has to be overwritten
// rather than assumed clean.
export function splitOfferState(offer: SplitOffer, thresholdSeconds: number): SplitModalState {
  return {
    message:
      `Exporting all ${offer.totalCount.toLocaleString()} rows took too long ` +
      `(over ${thresholdSeconds} seconds). Split it into ${offer.chunks} files of about ` +
      `${offer.rowsPerChunk.toLocaleString()} rows each instead?`,
    confirmLabel: `Download ${offer.chunks} files`,
    cancelLabel: 'Cancel',
  };
}

export type SplitDownloadOutcome = {
  complete: boolean;
  text: string;
};

// Judged on the number of files that actually downloaded, never on the plan.
// The keyset walk can stop early — most plausibly because X-Next-Cursor went
// missing in transit — and reporting the planned count in that case would tell
// the user a partial export had succeeded.
export function splitDownloadOutcome(downloaded: number, planned: number): SplitDownloadOutcome {
  if (downloaded >= planned && downloaded > 0) {
    return { complete: true, text: `Done — downloaded ${downloaded} files.` };
  }
  return {
    complete: false,
    text:
      `Only ${downloaded} of ${planned} files downloaded, so the export is incomplete. ` +
      `Close this and try again.`,
  };
}

export function chunkFailureText(failedIndex: number, planned: number): string {
  return `File ${failedIndex + 1} of ${planned} failed to download. Close this and try again.`;
}

export function chunkPartFilename(base: string, index: number, planned: number): string {
  return `${base}-part${index + 1}-of-${planned}.csv`;
}

export type SingleShotResult = 'ok' | 'timeout' | 'error';

// 'timeout' is not a failure from the user's point of view — it hands off to the
// split-download offer, which does its own reporting.
export function singleShotFailureMessage(result: SingleShotResult): string | null {
  return result === 'error' ? 'Export failed — try again' : null;
}
