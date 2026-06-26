import { test, expect } from './strictTest';
import { entitiesUrl } from './treeUrl';

test('entities page paginates results and exposes prev/next', async ({ page }) => {
  await page.goto(entitiesUrl('jira_ticket', [], { per_page: 10 }));
  await expect(page.locator('[data-pagination]')).toBeVisible();
  const firstPageCount = await page.locator('table.entity-table tbody tr').count();
  expect(firstPageCount).toBe(10);
  await expect(page.locator('[data-pagination-status]')).toHaveText(/Page 1 of \d+/);
  await expect(page.locator('a[data-pagination-prev]')).toHaveCount(0);
  await expect(page.locator('a[data-pagination-next]')).toHaveCount(1);
});

test('Next link advances to page 2 with a different result set', async ({ page }) => {
  await page.goto(entitiesUrl('jira_ticket', [], { per_page: 10 }));
  const firstPageFirstLink = await page
    .locator('table.entity-table a.entity-link')
    .first()
    .getAttribute('href');

  await page.locator('a[data-pagination-next]').click();
  await page.waitForURL(/page=2/);
  await expect(page.locator('[data-pagination-status]')).toHaveText(/Page 2 of \d+/);
  await expect(page.locator('a[data-pagination-prev]')).toHaveCount(1);

  const secondPageFirstLink = await page
    .locator('table.entity-table a.entity-link')
    .first()
    .getAttribute('href');
  expect(secondPageFirstLink).not.toBe(firstPageFirstLink);
});

test('Prev link returns to the previous page', async ({ page }) => {
  await page.goto(entitiesUrl('jira_ticket', [], { per_page: 10, page: 3 }));
  await page.locator('a[data-pagination-prev]').click();
  await page.waitForURL(/page=2/);
  await expect(page.locator('[data-pagination-status]')).toHaveText(/Page 2 of \d+/);
});

test('page param preserves the filter tree across navigation', async ({ page }) => {
  await page.goto(entitiesUrl('jira_ticket', [], { per_page: 10 }));
  // entity_type is reflected by the Type dropdown, not a chip.
  await expect(page.locator('[data-entity-type-select]')).toHaveValue('jira_ticket');

  const countText = (await page.locator('.page-header .count').textContent()) ?? '';
  const totalMatch = countText.match(/of (\d+) result/);
  expect(totalMatch).not.toBeNull();
  const total = totalMatch![1];

  await page.locator('a[data-pagination-next]').click();
  await expect(page).toHaveURL(/page=2/);
  // f= param survives so the filter tree (including entity_type) stays applied.
  await expect(page).toHaveURL(/f=/);

  await expect(page.locator('[data-entity-type-select]')).toHaveValue('jira_ticket');
  await expect(page.locator('.page-header .count')).toContainText(`of ${total} result`);
});

test('result count header shows the displayed range, not the total only', async ({ page }) => {
  await page.goto(entitiesUrl('jira_ticket', [], { per_page: 10 }));
  await expect(page.locator('.page-header .count')).toContainText(/1–10 of \d+ results/);
});
