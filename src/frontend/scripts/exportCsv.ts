// Drives the "Export CSV" button on the entities page. A plain click would
// just navigate to the download URL, but we want three things a bare <a>
// can't give us:
//  - a loading state while the (possibly large) export is generated
//  - detection of the server's 503 "this would take too long" response
//  - a follow-up UI offering to split the export into several smaller files
//
// The request URL is rebuilt from the current page's query string rather
// than the anchor's static `href` — filters.ts updates the address bar via
// history.replaceState() on every auto-apply, without touching this button,
// so `location.search` is the only source that's guaranteed current.

import {
  chunkFailureText,
  chunkPartFilename,
  singleShotFailureMessage,
  splitDownloadOutcome,
  splitOfferState,
} from '../../domain/exportProgress';
import type { SingleShotResult } from '../../domain/exportProgress';

const CLIENT_TIMEOUT_MS = 15_000; // above the server's 10s budget + batch/serialization overhead
const SERVER_TIMEOUT_SECONDS = 10; // mirrors EXPORT_TIMEOUT_MS in entitiesHandler.tsx
const DOWNLOAD_SPACING_MS = 300; // let each triggered download start before the next
const ERROR_FLASH_MS = 4_000; // how long a failure stays legible on the button

type TimeoutBody = {
  error: string;
  totalCount: number;
  rowsPerChunk: number;
  chunks: number;
};

function buildExportUrl(extraParams: Record<string, number> = {}): string {
  const params = new URLSearchParams(location.search);
  for (const [key, value] of Object.entries(extraParams)) params.set(key, String(value));
  return `/entities/export?${params.toString()}`;
}

function filenameFromResponse(res: Response, fallback: string): string {
  const disposition = res.headers.get('Content-Disposition') ?? '';
  const match = disposition.match(/filename="([^"]+)"/);
  return match ? match[1] : fallback;
}

function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function setButtonBusy(anchor: HTMLAnchorElement, busy: boolean): void {
  anchor.classList.toggle('export-btn--busy', busy);
  anchor.setAttribute('aria-disabled', busy ? 'true' : 'false');
  anchor.textContent = busy ? 'Exporting…' : 'Export CSV';
}

// An anchor has no native failure state and the app has no toast surface, so
// the button briefly carries the message itself — the same surface already used
// for the 'Exporting\u2026' busy state.
function flashButtonError(anchor: HTMLAnchorElement, text: string): void {
  anchor.textContent = text;
  anchor.classList.add('export-btn--error');
  setTimeout(() => {
    anchor.classList.remove('export-btn--error');
    anchor.textContent = 'Export CSV';
  }, ERROR_FLASH_MS);
}

function getSplitModal() {
  const dialog = document.getElementById('export-split-modal') as HTMLDialogElement | null;
  if (!dialog) return null;
  return {
    dialog,
    message: dialog.querySelector<HTMLElement>('[data-export-split-message]'),
    progress: dialog.querySelector<HTMLElement>('[data-export-split-progress]'),
    cancelBtn: dialog.querySelector<HTMLButtonElement>('[data-export-split-cancel]'),
    confirmBtn: dialog.querySelector<HTMLButtonElement>('[data-export-split-confirm]'),
  };
}

async function downloadSingleShot(anchor: HTMLAnchorElement): Promise<SingleShotResult> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), CLIENT_TIMEOUT_MS);
  try {
    const res = await fetch(buildExportUrl(), { signal: controller.signal });
    if (res.status === 503) {
      const body = (await res.json()) as TimeoutBody;
      if (body.error === 'timeout') {
        showSplitOffer(anchor, body);
        return 'timeout';
      }
      return 'error';
    }
    if (!res.ok) return 'error';
    const blob = await res.blob();
    downloadBlob(blob, filenameFromResponse(res, 'entities.csv'));
    return 'ok';
  } catch {
    return 'error';
  } finally {
    clearTimeout(timeoutId);
  }
}

function showSplitOffer(anchor: HTMLAnchorElement, body: TimeoutBody): void {
  const modal = getSplitModal();
  if (!modal || !modal.message || !modal.progress || !modal.cancelBtn || !modal.confirmBtn) return;
  const { dialog, message, progress, cancelBtn, confirmBtn } = modal;

  const state = splitOfferState(body, SERVER_TIMEOUT_SECONDS);
  message.textContent = state.message;
  progress.hidden = true;
  progress.textContent = '';
  confirmBtn.textContent = state.confirmLabel;
  confirmBtn.disabled = false;
  // Relabelled explicitly, not just re-shown: the chunk-failure path below
  // rewrites this button to 'Close', and the modal element is reused.
  cancelBtn.textContent = state.cancelLabel;
  cancelBtn.disabled = false;
  cancelBtn.hidden = false;

  const onCancel = () => dialog.close();
  const onConfirm = () => runSplitDownload(body, modal);
  cancelBtn.addEventListener('click', onCancel, { once: true });
  confirmBtn.addEventListener('click', onConfirm, { once: true });
  dialog.addEventListener(
    'close',
    () => {
      cancelBtn.removeEventListener('click', onCancel);
      confirmBtn.removeEventListener('click', onConfirm);
    },
    { once: true }
  );

  dialog.showModal();
}

async function runSplitDownload(
  body: TimeoutBody,
  modal: NonNullable<ReturnType<typeof getSplitModal>>
): Promise<void> {
  const { progress, cancelBtn, confirmBtn, dialog } = modal;
  if (!progress || !cancelBtn || !confirmBtn) return;

  confirmBtn.disabled = true;
  cancelBtn.hidden = true;
  progress.hidden = false;

  // Chunks are fetched by keyset cursor, not offset — each response carries
  // the next chunk's starting point in X-Next-Cursor, so chunks must be
  // requested in order (the server can't jump to "chunk 3" without having
  // walked chunks 1 and 2 first).
  let cursor: string | undefined;
  let downloaded = 0;
  for (let i = 0; i < body.chunks; i++) {
    progress.textContent = `Downloading file ${i + 1} of ${body.chunks}…`;
    try {
      const params: Record<string, number> = { limit: body.rowsPerChunk };
      if (cursor !== undefined) params.afterId = Number(cursor);
      const res = await fetch(buildExportUrl(params));
      if (!res.ok) throw new Error('chunk fetch failed');
      const blob = await res.blob();
      const base = filenameFromResponse(res, 'entities.csv').replace(/\.csv$/, '');
      downloadBlob(blob, chunkPartFilename(base, i, body.chunks));
      downloaded += 1;
      cursor = res.headers.get('X-Next-Cursor') ?? undefined;
    } catch {
      progress.textContent = chunkFailureText(i, body.chunks);
      cancelBtn.hidden = false;
      cancelBtn.textContent = 'Close';
      return;
    }
    if (cursor === undefined) break;
    if (i < body.chunks - 1) await sleep(DOWNLOAD_SPACING_MS);
  }

  // Reported from what actually downloaded: the walk can stop early if
  // X-Next-Cursor goes missing, and the planned count would then overstate it.
  const outcome = splitDownloadOutcome(downloaded, body.chunks);
  progress.textContent = outcome.text;
  if (!outcome.complete) {
    cancelBtn.hidden = false;
    cancelBtn.textContent = 'Close';
    return;
  }
  setTimeout(() => dialog.close(), 1200);
}

function initExportButtons(root: ParentNode = document): void {
  root.querySelectorAll<HTMLAnchorElement>('[data-export-csv]').forEach(anchor => {
    if (anchor.dataset.exportCsvWired === '1') return;
    anchor.dataset.exportCsvWired = '1';

    anchor.addEventListener('click', event => {
      event.preventDefault();
      if (anchor.classList.contains('export-btn--busy')) return;
      setButtonBusy(anchor, true);
      void downloadSingleShot(anchor)
        .catch((): SingleShotResult => 'error')
        .then(result => {
          setButtonBusy(anchor, false);
          const failure = singleShotFailureMessage(result);
          if (failure) flashButtonError(anchor, failure);
        });
    });
  });
}

// The export button lives in .page-header-actions, which auto-apply filtering
// (filters.ts) never re-renders — only [data-results-region] gets swapped. So
// whether there are any results has to be read off that swapped region's
// [data-has-results] marker and reflected onto the button by hand.
function syncExportButtonVisibility(): void {
  const region = document.querySelector<HTMLElement>('[data-results-region]');
  const hasResults = region?.dataset.hasResults === 'true';
  document
    .querySelectorAll<HTMLAnchorElement>('[data-export-csv]')
    .forEach(anchor => (anchor.hidden = !hasResults));
}

document.addEventListener('DOMContentLoaded', () => {
  initExportButtons();
  syncExportButtonVisibility();
});
document.addEventListener('entities:results-swapped', () => syncExportButtonVisibility());
