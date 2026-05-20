import { test, expect, type Page } from '@playwright/test';

// ── Helpers ───────────────────────────────────────────────────────────────────

async function createDataset(page: Page, name: string): Promise<number> {
  await page.goto('/entities');
  await page.click('#save-dataset-btn');
  await page.fill('input[name="name"]', name);
  await page.locator('#save-dataset-panel button[type="submit"]').click();
  await expect(page).toHaveURL('/datasets');

  // Extract dataset id from the delete form action
  const row = page.locator('tr').filter({ hasText: name });
  const deleteForm = row.locator('form[action*="/datasets/"]');
  const action = await deleteForm.getAttribute('action');
  const match = action?.match(/\/datasets\/(\d+)\/delete/);
  if (!match) throw new Error(`Could not extract dataset id from action: ${action}`);
  return parseInt(match[1], 10);
}

async function deleteDataset(page: Page, id: number): Promise<void> {
  await page.goto('/datasets');
  await page.locator(`form[action="/datasets/${id}/delete"] button[type="submit"]`).click();
}

async function createVisualization(page: Page, datasetId: number, name: string): Promise<number> {
  await page.goto(`/visualizations/new?dataset_id=${datasetId}`);
  await page.fill('#name', name);

  // Select the first available (non-empty) option in #category_key
  const firstOption = page.locator('#category_key option').nth(1);
  const optionCount = await page.locator('#category_key option').count();
  if (optionCount > 1) {
    const val = await firstOption.getAttribute('value');
    if (val) await page.selectOption('#category_key', val);
  }

  await page.locator('#viz-builder-form button[type="submit"]').click();
  await expect(page).toHaveURL(/\/visualizations\/\d+$/);

  const url = page.url();
  const match = url.match(/\/visualizations\/(\d+)$/);
  if (!match) throw new Error(`Could not extract viz id from URL: ${url}`);
  return parseInt(match[1], 10);
}

async function deleteVisualization(page: Page, id: number): Promise<void> {
  await page.goto(`/visualizations/${id}`);
  await page.locator(`form[action="/visualizations/${id}/delete"] button[type="submit"]`).click();
  await expect(page).toHaveURL('/visualizations');
}

// ── Tests ─────────────────────────────────────────────────────────────────────

test('visualizations page loads', async ({ page }) => {
  await page.goto('/visualizations');
  await expect(page).toHaveTitle(/Visualizations.*Step Engine/);
  await expect(page.locator('h1')).toHaveText('Visualizations');
});

test('nav has a Visualizations link', async ({ page }) => {
  await page.goto('/entities');
  await page.click('a[href="/visualizations"]');
  await expect(page).toHaveURL('/visualizations');
});

test('new visualization page loads with dataset picker', async ({ page }) => {
  await page.goto('/visualizations/new');
  // Should always show ChartBuilderPage (either the form or the "no datasets" message)
  const hasForm = await page.locator('#viz-builder-form').count();
  const hasNoDatasets = await page.locator('text=No datasets yet').count();
  expect(hasForm + hasNoDatasets).toBeGreaterThan(0);
});

test('can create and view a visualization', async ({ page }) => {
  const dsName = `E2E DS ${Date.now()}`;
  const vizName = `E2E Viz ${Date.now()}`;

  const datasetId = await createDataset(page, dsName);
  const vizId = await createVisualization(page, datasetId, vizName);

  await expect(page.locator('h1')).toContainText(vizName);

  // cleanup
  await deleteVisualization(page, vizId);
  await deleteDataset(page, datasetId);
});

test('detail page dataset link goes to entities', async ({ page }) => {
  const dsName = `E2E DS Link ${Date.now()}`;
  const vizName = `E2E Viz Link ${Date.now()}`;

  const datasetId = await createDataset(page, dsName);
  const vizId = await createVisualization(page, datasetId, vizName);

  await page.goto(`/visualizations/${vizId}`);
  const datasetLink = page.locator('a[href*="/entities"]').first();
  const href = await datasetLink.getAttribute('href');
  expect(href).toContain('/entities');

  // cleanup
  await deleteVisualization(page, vizId);
  await deleteDataset(page, datasetId);
});

test('can edit a visualization', async ({ page }) => {
  const dsName = `E2E DS Edit ${Date.now()}`;
  const vizName = `E2E Viz Edit ${Date.now()}`;
  const newName = `${vizName} Updated`;

  const datasetId = await createDataset(page, dsName);
  const vizId = await createVisualization(page, datasetId, vizName);

  await page.goto(`/visualizations/${vizId}/edit`);
  await page.fill('#name', newName);
  await page.locator('#viz-builder-form button[type="submit"]').click();

  await expect(page).toHaveURL(`/visualizations/${vizId}`);
  await expect(page.locator('h1')).toContainText(newName);

  // cleanup
  await deleteVisualization(page, vizId);
  await deleteDataset(page, datasetId);
});

test('can delete a visualization', async ({ page }) => {
  const dsName = `E2E DS Del ${Date.now()}`;
  const vizName = `E2E Viz Del ${Date.now()}`;

  const datasetId = await createDataset(page, dsName);
  const vizId = await createVisualization(page, datasetId, vizName);

  await deleteVisualization(page, vizId);

  await expect(page).toHaveURL('/visualizations');
  await expect(page.locator('body')).not.toContainText(vizName);

  // cleanup
  await deleteDataset(page, datasetId);
});
