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

const CLIENT_TIMEOUT_MS = 15_000; // above the server's 10s budget + batch/serialization overhead
const DOWNLOAD_SPACING_MS = 300; // let each triggered download start before the next

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

async function downloadSingleShot(anchor: HTMLAnchorElement): Promise<'ok' | 'timeout' | 'error'> {
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

  message.textContent =
    `Exporting all ${body.totalCount.toLocaleString()} rows took too long ` +
    `(over 10 seconds). Split it into ${body.chunks} files of about ` +
    `${body.rowsPerChunk.toLocaleString()} rows each instead?`;
  progress.hidden = true;
  progress.textContent = '';
  confirmBtn.textContent = `Download ${body.chunks} files`;
  confirmBtn.disabled = false;
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
  for (let i = 0; i < body.chunks; i++) {
    progress.textContent = `Downloading file ${i + 1} of ${body.chunks}…`;
    try {
      const params: Record<string, number> = { limit: body.rowsPerChunk };
      if (cursor !== undefined) params.afterId = Number(cursor);
      const res = await fetch(buildExportUrl(params));
      if (!res.ok) throw new Error('chunk fetch failed');
      const blob = await res.blob();
      const base = filenameFromResponse(res, 'entities.csv').replace(/\.csv$/, '');
      downloadBlob(blob, `${base}-part${i + 1}-of-${body.chunks}.csv`);
      cursor = res.headers.get('X-Next-Cursor') ?? undefined;
    } catch {
      progress.textContent = `File ${i + 1} of ${body.chunks} failed to download. Close this and try again.`;
      cancelBtn.hidden = false;
      cancelBtn.textContent = 'Close';
      return;
    }
    if (cursor === undefined) break;
    if (i < body.chunks - 1) await sleep(DOWNLOAD_SPACING_MS);
  }

  progress.textContent = `Done — downloaded ${body.chunks} files.`;
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
      downloadSingleShot(anchor).finally(() => setButtonBusy(anchor, false));
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
