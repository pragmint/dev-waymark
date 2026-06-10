import { test, expect, type Page } from '@playwright/test';

// ── Helpers ───────────────────────────────────────────────────────────────────

async function createPreset(page: Page, name: string): Promise<number> {
  await page.goto('/entities');
  await page.click('#save-preset-btn');
  await page.fill('input[name="name"]', name);
  await page.locator('#save-preset-panel button[type="submit"]').click();
  await expect(page).toHaveURL('/presets');

  const row = page.locator('tr').filter({ hasText: name });
  const deleteForm = row.locator('form[action*="/presets/"]');
  const action = await deleteForm.getAttribute('action');
  const match = action?.match(/\/presets\/(\d+)\/delete/);
  if (!match) throw new Error(`Could not extract preset id from action: ${action}`);
  return parseInt(match[1], 10);
}

async function deletePreset(page: Page, id: number): Promise<void> {
  await page.goto('/presets');
  await page.locator(`form[action="/presets/${id}/delete"] button[type="submit"]`).click();
}

async function createVisualization(
  page: Page,
  presetId: number,
  name: string,
  templateId: string
): Promise<number> {
  await page.goto(`/visualizations/new/${templateId}?preset_id=${presetId}`);
  await page.fill('#name', name);

  // Fill required slots based on template
  await fillTemplateSlots(page, templateId);

  await page.locator('#template-config-form button[type="submit"]').click();
  await expect(page).toHaveURL(/\/visualizations\/\d+$/);

  const url = page.url();
  const match = url.match(/\/visualizations\/(\d+)$/);
  if (!match) throw new Error(`Could not extract viz id from URL: ${url}`);
  return parseInt(match[1], 10);
}

async function fillTemplateSlots(page: Page, templateId: string): Promise<void> {
  switch (templateId) {
    case 'duration_trend': {
      await selectFirstAvailableOption(page, '#start_date_field');
      await selectFirstAvailableOption(page, '#end_date_field');
      break;
    }
    case 'category_breakdown': {
      await selectFirstAvailableOption(page, '#category_field');
      break;
    }
    case 'phase_snapshot': {
      await selectFirstAvailableOption(page, '#category_field');
      await selectFirstAvailableOption(page, '#date_field');
      break;
    }
    case 'throughput_over_time': {
      await selectFirstAvailableOption(page, '#date_field');
      break;
    }
    case 'field_trend': {
      await selectFirstAvailableOption(page, '#date_field');
      await selectFirstAvailableOption(page, '#numeric_field');
      break;
    }
    case 'category_comparison': {
      await selectFirstAvailableOption(page, '#category_field');
      await selectFirstAvailableOption(page, '#numeric_field');
      break;
    }
  }
}

async function selectFirstAvailableOption(page: Page, selector: string): Promise<void> {
  const options = page.locator(`${selector} option`);
  const count = await options.count();
  if (count > 1) {
    const val = await options.nth(1).getAttribute('value');
    if (val) await page.selectOption(selector, val);
  }
}

async function deleteVisualization(page: Page, id: number): Promise<void> {
  await page.goto(`/visualizations/${id}`);
  await page.locator(`form[action="/visualizations/${id}/delete"] button[type="submit"]`).click();
  await expect(page).toHaveURL('/visualizations');
}

// ── Tests ─────────────────────────────────────────────────────────────────────

test('visualizations page loads', async ({ page }) => {
  await page.goto('/visualizations');
  await expect(page).toHaveTitle(/Visualizations.*Dev Waymark/);
  await expect(page.locator('h1')).toHaveText('Visualizations');
});

test('nav has a Visualizations link', async ({ page }) => {
  await page.goto('/entities');
  await page.click('a[href="/visualizations"]');
  await expect(page).toHaveURL('/visualizations');
});

test('new visualization shows template picker', async ({ page }) => {
  await page.goto('/visualizations/new');
  const hasCards = await page.locator('.template-card').count();
  const hasNoPresets = await page.locator('text=No presets yet').count();
  expect(hasCards + hasNoPresets).toBeGreaterThan(0);
});

test('template picker shows all 6 templates', async ({ page }) => {
  const dsName = `E2E DS Templates ${Date.now()}`;
  const presetId = await createPreset(page, dsName);

  await page.goto(`/visualizations/new?preset_id=${presetId}`);
  const cards = page.locator('.template-card');
  await expect(cards).toHaveCount(6);

  await deletePreset(page, presetId);
});

test('template picker preset change updates card links', async ({ page }) => {
  const dsName1 = `E2E DS Picker1 ${Date.now()}`;
  const dsName2 = `E2E DS Picker2 ${Date.now()}`;
  const ds1 = await createPreset(page, dsName1);
  const ds2 = await createPreset(page, dsName2);

  await page.goto(`/visualizations/new?preset_id=${ds1}`);
  const firstCard = page.locator('.template-card').first();
  const href1 = await firstCard.getAttribute('href');
  expect(href1).toContain(`preset_id=${ds1}`);

  await page.selectOption('#preset-picker', String(ds2));
  await expect(firstCard).toHaveAttribute('href', new RegExp(`preset_id=${ds2}`));

  await deletePreset(page, ds1);
  await deletePreset(page, ds2);
});

test('can create visualization with category_breakdown template', async ({ page }) => {
  const dsName = `E2E DS CatBreak ${Date.now()}`;
  const vizName = `E2E Viz CatBreak ${Date.now()}`;

  const presetId = await createPreset(page, dsName);
  const vizId = await createVisualization(page, presetId, vizName, 'category_breakdown');

  await expect(page.locator('h1')).toContainText(vizName);

  await deleteVisualization(page, vizId);
  await deletePreset(page, presetId);
});

test('can create visualization with throughput_over_time template', async ({ page }) => {
  const dsName = `E2E DS Throughput ${Date.now()}`;
  const vizName = `E2E Viz Throughput ${Date.now()}`;

  const presetId = await createPreset(page, dsName);
  const vizId = await createVisualization(page, presetId, vizName, 'throughput_over_time');

  await expect(page.locator('h1')).toContainText(vizName);

  await deleteVisualization(page, vizId);
  await deletePreset(page, presetId);
});

test('can create visualization with duration_trend template', async ({ page }) => {
  const dsName = `E2E DS Duration ${Date.now()}`;
  const vizName = `E2E Viz Duration ${Date.now()}`;

  const presetId = await createPreset(page, dsName);
  const vizId = await createVisualization(page, presetId, vizName, 'duration_trend');

  await expect(page.locator('h1')).toContainText(vizName);

  await deleteVisualization(page, vizId);
  await deletePreset(page, presetId);
});

test('can create visualization with phase_snapshot template', async ({ page }) => {
  const dsName = `E2E DS Phase ${Date.now()}`;
  const vizName = `E2E Viz Phase ${Date.now()}`;

  const presetId = await createPreset(page, dsName);
  const vizId = await createVisualization(page, presetId, vizName, 'phase_snapshot');

  await expect(page.locator('h1')).toContainText(vizName);

  await deleteVisualization(page, vizId);
  await deletePreset(page, presetId);
});

test('can create visualization with field_trend template', async ({ page }) => {
  const dsName = `E2E DS FieldTrend ${Date.now()}`;
  const vizName = `E2E Viz FieldTrend ${Date.now()}`;

  const presetId = await createPreset(page, dsName);
  const vizId = await createVisualization(page, presetId, vizName, 'field_trend');

  await expect(page.locator('h1')).toContainText(vizName);

  await deleteVisualization(page, vizId);
  await deletePreset(page, presetId);
});

test('can create visualization with category_comparison template', async ({ page }) => {
  const dsName = `E2E DS CatComp ${Date.now()}`;
  const vizName = `E2E Viz CatComp ${Date.now()}`;

  const presetId = await createPreset(page, dsName);
  const vizId = await createVisualization(page, presetId, vizName, 'category_comparison');

  await expect(page.locator('h1')).toContainText(vizName);

  await deleteVisualization(page, vizId);
  await deletePreset(page, presetId);
});

test('can edit a visualization', async ({ page }) => {
  const dsName = `E2E DS Edit ${Date.now()}`;
  const vizName = `E2E Viz Edit ${Date.now()}`;
  const newName = `${vizName} Updated`;

  const presetId = await createPreset(page, dsName);
  const vizId = await createVisualization(page, presetId, vizName, 'category_breakdown');

  await page.goto(`/visualizations/${vizId}/edit`);
  await page.fill('#name', newName);
  await page.locator('#template-config-form button[type="submit"]').click();

  await expect(page).toHaveURL(`/visualizations/${vizId}`);
  await expect(page.locator('h1')).toContainText(newName);

  await deleteVisualization(page, vizId);
  await deletePreset(page, presetId);
});

test('can delete a visualization', async ({ page }) => {
  const dsName = `E2E DS Del ${Date.now()}`;
  const vizName = `E2E Viz Del ${Date.now()}`;

  const presetId = await createPreset(page, dsName);
  const vizId = await createVisualization(page, presetId, vizName, 'category_breakdown');

  await deleteVisualization(page, vizId);

  await expect(page).toHaveURL('/visualizations');
  await expect(page.locator('body')).not.toContainText(vizName);

  await deletePreset(page, presetId);
});

test('detail page preset link goes to entities', async ({ page }) => {
  const dsName = `E2E DS Link ${Date.now()}`;
  const vizName = `E2E Viz Link ${Date.now()}`;

  const presetId = await createPreset(page, dsName);
  const vizId = await createVisualization(page, presetId, vizName, 'category_breakdown');

  await page.goto(`/visualizations/${vizId}`);
  const presetLink = page.locator('a[href*="/entities"]').first();
  const href = await presetLink.getAttribute('href');
  expect(href).toContain('/entities');

  await deleteVisualization(page, vizId);
  await deletePreset(page, presetId);
});
