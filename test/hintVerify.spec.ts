import { type APIRequestContext, type Page } from '@playwright/test';
import { test, expect } from './strictTest';

function uniqueName(prefix: string): string {
  return `${prefix}_${Date.now()}_${Math.floor(Math.random() * 100000)}`;
}

async function seedPreset(request: APIRequestContext, name: string): Promise<number> {
  const res = await request.post('/test/presets', { data: { name } });
  expect(res.ok()).toBeTruthy();
  const { id } = await res.json();
  return id;
}

async function seedDashboard(request: APIRequestContext, name: string): Promise<number> {
  const res = await request.post('/test/dashboards', { data: { name, visualizationIds: [] } });
  expect(res.ok()).toBeTruthy();
  const { id } = await res.json();
  return id;
}

async function waitForDashboardHydrated(page: Page): Promise<void> {
  await page.waitForFunction(
    () => document.getElementById('dashboard-config')?.textContent !== null
  );
}

test('slot hint text renders above the field, combined with the label', async ({
  page,
  request,
}) => {
  const presetName = uniqueName('PresetHint');
  await seedPreset(request, presetName);
  const dashId = await seedDashboard(request, uniqueName('HintD'));

  await page.goto(`/visualizations?dashboard=${dashId}`);
  await waitForDashboardHydrated(page);
  await page.selectOption('[data-add-viz]', '__new__');
  await page.selectOption('.viz-modal-body select', { label: presetName });

  await page.locator('.viz-modal-template-card:has-text("Field trend")').click();
  const dateSelect = page.locator('#viz-modal-form select[name="date_field"]');
  await expect(dateSelect).toBeVisible();

  const dateWrap = dateSelect.locator('..');
  const labelText = await dateWrap.locator('label').innerText();
  expect(labelText).toContain('Date field');
  expect(labelText).toContain('Sets the x-axis');
});
