import { test, expect } from '@playwright/test';

test('redirects root to /entities', async ({ page }) => {
  await page.goto('/');
  await expect(page).toHaveURL('/entities');
});

test('entities page has correct title and heading', async ({ page }) => {
  await page.goto('/entities');
  await expect(page).toHaveTitle(/Entities.*Step Engine/);
  await expect(page.locator('h1')).toHaveText('Entities');
});

test('filter form is present with source and type selects', async ({ page }) => {
  await page.goto('/entities');
  const form = page.locator('[data-filter-form]');
  await expect(form).toBeVisible();
  await expect(form.locator('select[name="source"]')).toBeVisible();
  await expect(form.locator('select[name="type"]')).toBeVisible();
});

test('entity detail page loads and shows metadata section', async ({ page }) => {
  await page.goto('/entities');
  const firstLink = page.locator('table.entity-table a.entity-link').first();
  const count = await firstLink.count();
  if (count === 0) {
    test.skip();
    return;
  }
  await firstLink.click();
  await expect(page.locator('h2')).toHaveText('Metadata');
  await expect(page.locator('.back-link')).toBeVisible();
});

test('unknown entity id returns 404', async ({ page }) => {
  const response = await page.goto('/entities/does-not-exist');
  expect(response?.status()).toBe(404);
});
