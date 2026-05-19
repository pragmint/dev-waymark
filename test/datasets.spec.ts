import { test, expect } from '@playwright/test';

test('datasets page loads with correct title', async ({ page }) => {
  await page.goto('/datasets');
  await expect(page).toHaveTitle(/Saved Datasets.*Step Engine/);
  await expect(page.locator('h1')).toHaveText('Saved Datasets');
});

test('nav has a Saved Datasets link', async ({ page }) => {
  await page.goto('/entities');
  await page.click('a[href="/datasets"]');
  await expect(page).toHaveURL('/datasets');
});

test('save dataset button reveals form, cancel hides it', async ({ page }) => {
  await page.goto('/entities');
  await expect(page.locator('#save-dataset-panel')).toBeHidden();
  await page.click('#save-dataset-btn');
  await expect(page.locator('#save-dataset-panel')).toBeVisible();
  await expect(page.locator('input[name="name"]')).toBeFocused();
  await page.click('#save-dataset-cancel');
  await expect(page.locator('#save-dataset-panel')).toBeHidden();
});

test('can save a dataset and it appears on /datasets', async ({ page }) => {
  const name = `E2E Dataset ${Date.now()}`;

  await page.goto('/entities');
  await page.click('#save-dataset-btn');
  await page.fill('input[name="name"]', name);
  await page.locator('#save-dataset-panel button[type="submit"]').click();

  await expect(page).toHaveURL('/datasets');
  await expect(page.locator('table.entity-table')).toContainText(name);

  // cleanup
  await page.locator('tr').filter({ hasText: name }).locator('button[type="submit"]').click();
  await expect(page.locator('body')).not.toContainText(name);
});

test('dataset link navigates to /entities', async ({ page }) => {
  const name = `E2E Link ${Date.now()}`;

  await page.goto('/entities');
  await page.click('#save-dataset-btn');
  await page.fill('input[name="name"]', name);
  await page.locator('#save-dataset-panel button[type="submit"]').click();

  await expect(page).toHaveURL('/datasets');
  await page.locator('a').filter({ hasText: name }).click();
  await expect(page).toHaveURL(/\/entities/);

  // cleanup
  await page.goto('/datasets');
  await page.locator('tr').filter({ hasText: name }).locator('button[type="submit"]').click();
});

test('can delete a dataset', async ({ page }) => {
  const name = `E2E Delete ${Date.now()}`;

  // save
  await page.goto('/entities');
  await page.click('#save-dataset-btn');
  await page.fill('input[name="name"]', name);
  await page.locator('#save-dataset-panel button[type="submit"]').click();
  await expect(page).toHaveURL('/datasets');
  await expect(page.locator('table.entity-table')).toContainText(name);

  // delete
  await page.locator('tr').filter({ hasText: name }).locator('button[type="submit"]').click();
  await expect(page).toHaveURL('/datasets');
  await expect(page.locator('body')).not.toContainText(name);
});
