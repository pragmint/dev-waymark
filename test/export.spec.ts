import { test, expect } from './strictTest';
import { entitiesUrl } from './treeUrl';

// The decisions behind these two flows are unit-tested in
// src/domain/exportProgress.test.ts. What can only be checked in a browser is
// the wiring: that exportCsv.ts actually puts those decisions on screen. Keep
// this file to wiring only — new cases about *what* the message says belong in
// the domain test, which is far cheaper to run.

test('a failed single-shot export reports the failure on the button', async ({ page }) => {
  await page.goto(entitiesUrl('jira_ticket'));

  // Only the unlimited (single-shot) request is failed; chunk requests carry a
  // `limit` and are left alone.
  await page.route('**/entities/export?**', async route => {
    if (new URL(route.request().url()).searchParams.has('limit')) return route.fallback();
    await route.fulfill({ status: 500, body: 'boom' });
  });

  const button = page.locator('[data-export-csv]');
  await expect(button).toBeVisible();
  await button.click();

  // Regression: the click handler discarded downloadSingleShot's result, so a
  // failed export silently reset the button and the user got no file and no
  // explanation.
  await expect(button).toHaveText('Export failed — try again');
  await expect(button).toHaveClass(/export-btn--error/);
});

test('a split download that loses its cursor reports an incomplete export', async ({ page }) => {
  await page.goto(entitiesUrl('jira_ticket'));

  await page.route('**/entities/export?**', async route => {
    const url = new URL(route.request().url());
    if (!url.searchParams.has('limit')) {
      // Stand in for the server's timeout response so the modal opens without
      // waiting out the real 10s budget.
      return route.fulfill({
        status: 503,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'timeout', totalCount: 300, rowsPerChunk: 100, chunks: 3 }),
      });
    }
    // Serve a real chunk but drop X-Next-Cursor, standing in for an
    // intermediary that strips the non-standard header. The walk then stops
    // after one file even though three were planned.
    return route.fulfill({
      status: 200,
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': 'attachment; filename="entities-jira-ticket.csv"',
      },
      body: 'Entity,Type\r\nJ-1,jira_ticket',
    });
  });

  await page.locator('[data-export-csv]').click();

  const dialog = page.locator('#export-split-modal');
  await expect(dialog).toBeVisible();
  await expect(dialog.locator('[data-export-split-cancel]')).toHaveText('Cancel');

  await dialog.locator('[data-export-split-confirm]').click();

  // Regression: this used to read "Done — downloaded 3 files." after a single
  // file landed, reporting a truncated export as a success.
  const progress = dialog.locator('[data-export-split-progress]');
  await expect(progress).toContainText('incomplete');
  await expect(progress).not.toContainText('Done');
  await expect(dialog).toBeVisible();
});
