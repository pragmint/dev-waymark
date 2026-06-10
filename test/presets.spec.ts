import { test, expect } from '@playwright/test';

test('presets page loads with correct title', async ({ page }) => {
  await page.goto('/presets');
  await expect(page).toHaveTitle(/Saved Presets.*Step Engine/);
  await expect(page.locator('h1')).toHaveText('Saved Presets');
});

test('nav has a Saved Presets link', async ({ page }) => {
  await page.goto('/entities');
  await page.click('a[href="/presets"]');
  await expect(page).toHaveURL('/presets');
});

test('save preset button reveals form, cancel hides it', async ({ page }) => {
  await page.goto('/entities');
  await expect(page.locator('#save-preset-panel')).toBeHidden();
  await page.click('#save-preset-btn');
  await expect(page.locator('#save-preset-panel')).toBeVisible();
  await expect(page.locator('input[name="name"]')).toBeFocused();
  await page.click('#save-preset-cancel');
  await expect(page.locator('#save-preset-panel')).toBeHidden();
});

test('can save a preset and it appears on /presets', async ({ page }) => {
  const name = `E2E Preset ${Date.now()}`;

  await page.goto('/entities');
  await page.click('#save-preset-btn');
  await page.fill('input[name="name"]', name);
  await page.locator('#save-preset-panel button[type="submit"]').click();

  await expect(page).toHaveURL('/presets');
  await expect(page.locator('table.entity-table')).toContainText(name);

  // cleanup
  await page.locator('tr').filter({ hasText: name }).locator('button[type="submit"]').click();
  await expect(page.locator('body')).not.toContainText(name);
});

test('preset link navigates to /entities', async ({ page }) => {
  const name = `E2E Link ${Date.now()}`;

  await page.goto('/entities');
  await page.click('#save-preset-btn');
  await page.fill('input[name="name"]', name);
  await page.locator('#save-preset-panel button[type="submit"]').click();

  await expect(page).toHaveURL('/presets');
  await page.locator('a').filter({ hasText: name }).click();
  await expect(page).toHaveURL(/\/entities/);

  // cleanup
  await page.goto('/presets');
  await page.locator('tr').filter({ hasText: name }).locator('button[type="submit"]').click();
});

test('can delete a preset', async ({ page }) => {
  const name = `E2E Delete ${Date.now()}`;

  // save
  await page.goto('/entities');
  await page.click('#save-preset-btn');
  await page.fill('input[name="name"]', name);
  await page.locator('#save-preset-panel button[type="submit"]').click();
  await expect(page).toHaveURL('/presets');
  await expect(page.locator('table.entity-table')).toContainText(name);

  // delete
  await page.locator('tr').filter({ hasText: name }).locator('button[type="submit"]').click();
  await expect(page).toHaveURL('/presets');
  await expect(page.locator('body')).not.toContainText(name);
});
