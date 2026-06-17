import { test, expect, type APIRequestContext, type Page } from '@playwright/test';

// ── Setup helpers (seed endpoints — NOT exercising production POST handlers) ──

async function seedPreset(request: APIRequestContext, name: string): Promise<number> {
  const res = await request.post('/test/presets', { data: { name } });
  expect(res.ok()).toBeTruthy();
  const { id } = await res.json();
  return id;
}

async function seedVisualization(
  request: APIRequestContext,
  presetId: number,
  name: string,
  templateId: string
): Promise<number> {
  const res = await request.post('/test/visualizations', {
    data: { name, presetId, templateId },
  });
  expect(res.ok()).toBeTruthy();
  const { id } = await res.json();
  return id;
}

// ── UI helpers (exercise production code paths under test) ───────────────────

async function fillTemplateSlots(page: Page, templateId: string): Promise<void> {
  switch (templateId) {
    case 'duration_trend':
      await selectFirstOption(page, '#start_date_field');
      await selectFirstOption(page, '#end_date_field');
      break;
    case 'category_breakdown':
      await selectFirstOption(page, '#category_field');
      break;
    case 'phase_snapshot':
      await selectFirstOption(page, '#category_field');
      await selectFirstOption(page, '#date_field');
      break;
    case 'throughput_over_time':
      await selectFirstOption(page, '#date_field');
      break;
    case 'field_trend':
      await selectFirstOption(page, '#date_field');
      await selectFirstOption(page, '#numeric_field');
      break;
    case 'category_comparison':
      await selectFirstOption(page, '#category_field');
      await selectFirstOption(page, '#numeric_field');
      break;
  }
}

async function selectFirstOption(page: Page, selector: string): Promise<void> {
  const options = page.locator(`${selector} option`);
  const optionValue = await options.nth(1).getAttribute('value');
  if (!optionValue) throw new Error(`no selectable option for ${selector}`);
  await page.selectOption(selector, optionValue);
}

async function createVisualizationViaUI(
  page: Page,
  presetId: number,
  name: string,
  templateId: string
): Promise<number> {
  await page.goto(`/visualizations/new/${templateId}?preset_id=${presetId}`);
  await page.fill('#name', name);
  await fillTemplateSlots(page, templateId);
  await page.locator('#template-config-form button[type="submit"]').click();
  await expect(page).toHaveURL(/\/visualizations\/\d+$/);
  const match = page.url().match(/\/visualizations\/(\d+)$/);
  if (!match) throw new Error(`could not parse viz id from ${page.url()}`);
  return parseInt(match[1], 10);
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
  const cardCount = await page.locator('.template-card').count();
  const emptyStateCount = await page.locator('text=No presets yet').count();
  expect(cardCount + emptyStateCount).toBeGreaterThan(0);
});

test('template picker shows all 6 templates', async ({ page, request }) => {
  const presetId = await seedPreset(request, `E2E Preset Templates ${Date.now()}`);

  await page.goto(`/visualizations/new?preset_id=${presetId}`);
  await expect(page.locator('.template-card')).toHaveCount(6);
});

test('template picker preset change updates card links', async ({ page, request }) => {
  const firstPresetId = await seedPreset(request, `E2E Preset Picker1 ${Date.now()}`);
  const secondPresetId = await seedPreset(request, `E2E Preset Picker2 ${Date.now()}`);

  await page.goto(`/visualizations/new?preset_id=${firstPresetId}`);
  const firstCard = page.locator('.template-card').first();
  expect(await firstCard.getAttribute('href')).toContain(`preset_id=${firstPresetId}`);

  await page.selectOption('#preset-picker', String(secondPresetId));
  await expect(firstCard).toHaveAttribute('href', new RegExp(`preset_id=${secondPresetId}`));
});

test('template picker starts with no preset selected when preset_id is absent', async ({
  page,
  request,
}) => {
  await seedPreset(request, `E2E Preset Unselected ${Date.now()}`);

  await page.goto('/visualizations/new');

  await expect(page.locator('#preset-picker')).toHaveValue('');

  const cards = page.locator('.template-card');
  await expect(cards.first()).toHaveClass(/template-card--disabled/);
  await expect(cards.first()).toHaveAttribute('aria-disabled', 'true');
  await expect(cards.first()).toHaveAttribute('href', '#');
});

test('template picker enables cards once a preset is chosen, and re-disables on placeholder', async ({
  page,
  request,
}) => {
  const presetId = await seedPreset(request, `E2E Preset Toggle ${Date.now()}`);

  await page.goto('/visualizations/new');
  const firstCard = page.locator('.template-card').first();
  await expect(firstCard).toHaveClass(/template-card--disabled/);

  await page.selectOption('#preset-picker', String(presetId));
  await expect(firstCard).not.toHaveClass(/template-card--disabled/);
  await expect(firstCard).toHaveAttribute('aria-disabled', 'false');
  await expect(firstCard).toHaveAttribute('href', new RegExp(`preset_id=${presetId}`));

  await page.selectOption('#preset-picker', '');
  await expect(firstCard).toHaveClass(/template-card--disabled/);
  await expect(firstCard).toHaveAttribute('aria-disabled', 'true');
  await expect(firstCard).toHaveAttribute('href', '#');
});

test('disabled template card is not clickable (pointer-events: none)', async ({
  page,
  request,
}) => {
  await seedPreset(request, `E2E Preset PointerEvents ${Date.now()}`);

  await page.goto('/visualizations/new');
  const firstCard = page.locator('.template-card').first();
  await expect(firstCard).toHaveClass(/template-card--disabled/);

  const pointerEvents = await firstCard.evaluate(el => getComputedStyle(el).pointerEvents);
  expect(pointerEvents).toBe('none');
});

// Each template gets a full UI create test — exercises TemplateConfigPage form
// rendering for that template's slot set, parseTemplateForm parsing for the
// template's discriminator, resolveTemplate output, save, redirect, and detail
// page render. A break in any template-specific branch shows up here.

test('can create visualization with category_breakdown template', async ({ page, request }) => {
  const vizName = `E2E Viz CatBreak ${Date.now()}`;
  const presetId = await seedPreset(request, `E2E Preset CatBreak ${Date.now()}`);
  await createVisualizationViaUI(page, presetId, vizName, 'category_breakdown');
  await expect(page.locator('h1')).toContainText(vizName);
});

test('can create visualization with throughput_over_time template', async ({ page, request }) => {
  const vizName = `E2E Viz Throughput ${Date.now()}`;
  const presetId = await seedPreset(request, `E2E Preset Throughput ${Date.now()}`);
  await createVisualizationViaUI(page, presetId, vizName, 'throughput_over_time');
  await expect(page.locator('h1')).toContainText(vizName);
});

test('can create visualization with duration_trend template', async ({ page, request }) => {
  const vizName = `E2E Viz Duration ${Date.now()}`;
  const presetId = await seedPreset(request, `E2E Preset Duration ${Date.now()}`);
  await createVisualizationViaUI(page, presetId, vizName, 'duration_trend');
  await expect(page.locator('h1')).toContainText(vizName);
});

test('can create visualization with phase_snapshot template', async ({ page, request }) => {
  const vizName = `E2E Viz Phase ${Date.now()}`;
  const presetId = await seedPreset(request, `E2E Preset Phase ${Date.now()}`);
  await createVisualizationViaUI(page, presetId, vizName, 'phase_snapshot');
  await expect(page.locator('h1')).toContainText(vizName);
});

test('can create visualization with field_trend template', async ({ page, request }) => {
  const vizName = `E2E Viz FieldTrend ${Date.now()}`;
  const presetId = await seedPreset(request, `E2E Preset FieldTrend ${Date.now()}`);
  await createVisualizationViaUI(page, presetId, vizName, 'field_trend');
  await expect(page.locator('h1')).toContainText(vizName);
});

test('can create visualization with category_comparison template', async ({ page, request }) => {
  const vizName = `E2E Viz CatComp ${Date.now()}`;
  const presetId = await seedPreset(request, `E2E Preset CatComp ${Date.now()}`);
  await createVisualizationViaUI(page, presetId, vizName, 'category_comparison');
  await expect(page.locator('h1')).toContainText(vizName);
});

// Edit/delete/link tests use seed setup so the test stays focused on the
// operation under test (the create flow is already covered above).

test('can edit a visualization', async ({ page, request }) => {
  const vizName = `E2E Viz Edit ${Date.now()}`;
  const newName = `${vizName} Updated`;
  const presetId = await seedPreset(request, `E2E Preset Edit ${Date.now()}`);
  const vizId = await seedVisualization(request, presetId, vizName, 'category_breakdown');

  await page.goto(`/visualizations/${vizId}/edit`);
  await page.fill('#name', newName);
  await page.locator('#template-config-form button[type="submit"]').click();

  await expect(page).toHaveURL(`/visualizations/${vizId}`);
  await expect(page.locator('h1')).toContainText(newName);
});

test('can delete a visualization', async ({ page, request }) => {
  const vizName = `E2E Viz Del ${Date.now()}`;
  const presetId = await seedPreset(request, `E2E Preset Del ${Date.now()}`);
  const vizId = await seedVisualization(request, presetId, vizName, 'category_breakdown');

  await page.goto(`/visualizations/${vizId}`);
  await page
    .locator(`form[action="/visualizations/${vizId}/delete"] button[type="submit"]`)
    .click();

  await expect(page).toHaveURL('/visualizations');
  await expect(page.locator('body')).not.toContainText(vizName);
});

test('detail page preset link goes to entities', async ({ page, request }) => {
  const vizName = `E2E Viz Link ${Date.now()}`;
  const presetId = await seedPreset(request, `E2E Preset Link ${Date.now()}`);
  const vizId = await seedVisualization(request, presetId, vizName, 'category_breakdown');

  await page.goto(`/visualizations/${vizId}`);
  const presetLink = page.locator('a[href*="/entities"]').first();
  const href = await presetLink.getAttribute('href');
  expect(href).toContain('/entities');
});
