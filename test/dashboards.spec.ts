import { type APIRequestContext, type Page } from '@playwright/test';
import { test, expect } from './strictTest';

// ── Helpers ─────────────────────────────────────────────────────────────────

function uniqueName(prefix: string): string {
  return `${prefix}_${Date.now()}_${Math.floor(Math.random() * 100000)}`;
}

async function seedPreset(request: APIRequestContext, name: string): Promise<number> {
  const res = await request.post('/test/presets', { data: { name } });
  expect(res.ok()).toBeTruthy();
  const { id } = await res.json();
  return id;
}

async function seedViz(
  request: APIRequestContext,
  presetId: number,
  name: string,
  templateId = 'category_breakdown'
): Promise<number> {
  const res = await request.post('/test/visualizations', {
    data: { name, presetId, templateId },
  });
  expect(res.ok()).toBeTruthy();
  const { id } = await res.json();
  return id;
}

async function seedDashboard(
  request: APIRequestContext,
  name: string,
  visualizationIds: number[] = []
): Promise<number> {
  const res = await request.post('/test/dashboards', { data: { name, visualizationIds } });
  expect(res.ok()).toBeTruthy();
  const { id } = await res.json();
  return id;
}

// Wait for the dashboard JS to hydrate before interacting.
async function waitForDashboardHydrated(page: Page): Promise<void> {
  await page.waitForFunction(
    () => document.getElementById('dashboard-config')?.textContent !== null
  );
}

// ── Page basics ─────────────────────────────────────────────────────────────
// Empty-state is asserted indirectly: when no dashboard is selected and at
// least one dashboard exists in the DB, the dropdown picker is rendered.
// Tests avoid wiping the dashboards table — workers run in parallel against
// a shared SQLite file, so destructive cleanup races other tests.

test.describe('dashboard page', () => {
  test('seeded dashboard appears in the no-selected dropdown', async ({ page, request }) => {
    const name = uniqueName('Alpha');
    await seedDashboard(request, name);
    await page.goto('/visualizations');
    const select = page.locator('[data-dashboard-select]');
    await expect(select).toBeVisible();
    await expect(select.locator(`option:has-text("${name}")`)).toHaveCount(1);
  });

  test('selecting a dashboard from the no-selected dropdown navigates to it', async ({
    page,
    request,
  }) => {
    const name = uniqueName('Pick');
    const id = await seedDashboard(request, name);
    await page.goto('/visualizations');
    await page.selectOption('[data-dashboard-select]', { label: name });
    await expect(page).toHaveURL(new RegExp(`/visualizations\\?dashboard=${id}`));
    await expect(page.locator('[data-dashboard-name-input]')).toHaveValue(name);
  });

  test('unknown dashboard id redirects to the bare /visualizations url', async ({ page }) => {
    const res = await page.goto('/visualizations?dashboard=999999');
    expect(res?.status()).toBeLessThan(400);
    await expect(page).toHaveURL(/\/visualizations(\?.*)?$/);
    expect(page.url()).not.toContain('dashboard=999999');
  });
});

// ── Dashboard CRUD ──────────────────────────────────────────────────────────

test.describe('dashboard CRUD', () => {
  test('+ Create dashboard button toggles the inline panel from hidden to visible', async ({
    page,
  }) => {
    // Guards against the class of bug where the click handler runs and flips
    // the `hidden` attribute but CSS overrides the user-agent `[hidden]` rule,
    // leaving the panel either always-visible or always-hidden. Asserting
    // toBeHidden() before and toBeVisible() after catches both states.
    await page.goto('/visualizations');
    const panel = page.locator('[data-dashboard-create-panel]');
    await expect(panel).toBeHidden();
    await page.locator('[data-dashboard-create-open]').first().click();
    await expect(panel).toBeVisible();
  });

  test('create dashboard via the inline panel and arrive on its page', async ({ page }) => {
    const name = uniqueName('Created');
    await page.goto('/visualizations');
    await page.locator('[data-dashboard-create-open]').first().click();
    await page.fill('[data-dashboard-create-input]', name);
    await page.locator('[data-dashboard-create-form] button[type="submit"]').click();
    await expect(page).toHaveURL(/dashboard=\d+/);
    await expect(page.locator('[data-dashboard-name-input]')).toHaveValue(name);
  });

  test('rename dashboard inline sets dirty, save persists', async ({ page, request }) => {
    const orig = uniqueName('Orig');
    const renamed = `${orig} renamed`;
    const id = await seedDashboard(request, orig);

    await page.goto(`/visualizations?dashboard=${id}`);
    await waitForDashboardHydrated(page);
    await expect(page.locator('[data-dashboard-save-submit]')).toBeHidden();

    await page.fill('[data-dashboard-name-input]', renamed);
    await expect(page.locator('[data-dashboard-save-submit]')).toBeVisible();
    await page.click('[data-dashboard-save-submit]');

    await expect(page).toHaveURL(new RegExp(`dashboard=${id}`));
    await expect(page.locator('[data-dashboard-name-input]')).toHaveValue(renamed);
    await expect(page.locator('[data-dashboard-save-submit]')).toBeHidden();
  });

  test('combobox toggle opens dropdown and another dashboard navigates', async ({
    page,
    request,
  }) => {
    const a = uniqueName('A');
    const b = uniqueName('B');
    const aid = await seedDashboard(request, a);
    const bid = await seedDashboard(request, b);

    await page.goto(`/visualizations?dashboard=${aid}`);
    await waitForDashboardHydrated(page);

    const list = page.locator('[data-dashboard-combo-list]');
    await expect(list).toBeHidden();
    await page.click('[data-dashboard-combo-toggle]');
    await expect(list).toBeVisible();
    await page.click(`[data-dashboard-combo-list] a:has-text("${b}")`);
    await expect(page).toHaveURL(new RegExp(`dashboard=${bid}`));
  });

  test('delete dashboard via trash icon (auto-accepts confirm) clears it', async ({
    page,
    request,
  }) => {
    const name = uniqueName('Doomed');
    const id = await seedDashboard(request, name);
    page.on('dialog', d => d.accept());
    await page.goto(`/visualizations?dashboard=${id}`);
    await waitForDashboardHydrated(page);
    await page.locator('[data-dashboard-delete-form] button[type="submit"]').click();
    await expect(page).toHaveURL(/\/visualizations(\?.*)?$/);
    expect(page.url()).not.toContain(`dashboard=${id}`);
  });

  test('deleted dashboards do not remove their visualizations from the library', async ({
    page,
    request,
  }) => {
    const presetId = await seedPreset(request, uniqueName('PresetLib'));
    const vizId = await seedViz(request, presetId, uniqueName('OrphanCheck'));
    const dashId = await seedDashboard(request, uniqueName('Temp'), [vizId]);
    page.on('dialog', d => d.accept());
    await page.goto(`/visualizations?dashboard=${dashId}`);
    await waitForDashboardHydrated(page);
    await page.locator('[data-dashboard-delete-form] button[type="submit"]').click();
    await expect(page).toHaveURL(/\/visualizations(\?.*)?$/);

    // Create a fresh dashboard; the orphaned viz should appear in the picker.
    const newDashId = await seedDashboard(request, uniqueName('Fresh'));
    await page.goto(`/visualizations?dashboard=${newDashId}`);
    await expect(page.locator(`[data-add-viz] option[value="${vizId}"]`)).toHaveCount(1);
  });
});

// ── Add visualization picker ────────────────────────────────────────────────

test.describe('add visualization picker', () => {
  test('existing optgroup lists viz not on the dashboard; adding one renders a card', async ({
    page,
    request,
  }) => {
    const presetId = await seedPreset(request, uniqueName('Preset'));
    const v1 = await seedViz(request, presetId, uniqueName('V1'));
    const v2 = await seedViz(request, presetId, uniqueName('V2'));
    const dashId = await seedDashboard(request, uniqueName('D'), [v1]);

    await page.goto(`/visualizations?dashboard=${dashId}`);
    await waitForDashboardHydrated(page);

    await expect(page.locator(`[data-add-viz] option[value="${v1}"]`)).toHaveCount(0);
    await expect(page.locator(`[data-add-viz] option[value="${v2}"]`)).toHaveCount(1);

    await page.selectOption('[data-add-viz]', String(v2));
    await expect(page).toHaveURL(new RegExp(`dashboard=${dashId}`));
    await expect(page.locator(`.dashboard-viz-card[data-viz-id="${v1}"]`)).toBeVisible();
    await expect(page.locator(`.dashboard-viz-card[data-viz-id="${v2}"]`)).toBeVisible();
  });
});

// ── Remove (X) branching ────────────────────────────────────────────────────

test.describe('remove visualization X-button branching', () => {
  test('viz on multiple dashboards: X unlinks silently; other dashboard still has it', async ({
    page,
    request,
  }) => {
    const presetId = await seedPreset(request, uniqueName('P'));
    const vizId = await seedViz(request, presetId, uniqueName('Shared'));
    const dashA = await seedDashboard(request, uniqueName('A'), [vizId]);
    const dashB = await seedDashboard(request, uniqueName('B'), [vizId]);

    await page.goto(`/visualizations?dashboard=${dashA}`);
    await waitForDashboardHydrated(page);
    const btn = page.locator(`[data-remove-viz="${vizId}"]`);
    await expect(btn).toHaveAttribute('data-on-multiple', 'true');
    await btn.click();
    // After unlink + redirect, dashboard A no longer has the card.
    await expect(page).toHaveURL(new RegExp(`dashboard=${dashA}`));
    await expect(page.locator(`.dashboard-viz-card[data-viz-id="${vizId}"]`)).toHaveCount(0);

    // Dashboard B still has it.
    await page.goto(`/visualizations?dashboard=${dashB}`);
    await expect(page.locator(`.dashboard-viz-card[data-viz-id="${vizId}"]`)).toBeVisible();
  });

  test('viz on one dashboard: X opens the 3-option popover', async ({ page, request }) => {
    const presetId = await seedPreset(request, uniqueName('P'));
    const vizId = await seedViz(request, presetId, uniqueName('Only'));
    const dashId = await seedDashboard(request, uniqueName('D'), [vizId]);

    await page.goto(`/visualizations?dashboard=${dashId}`);
    await waitForDashboardHydrated(page);
    const btn = page.locator(`[data-remove-viz="${vizId}"]`);
    await expect(btn).toHaveAttribute('data-on-multiple', 'false');
    await btn.click();
    const popover = page.locator('.viz-remove-confirm');
    await expect(popover).toBeVisible();
    await expect(popover.locator('button:has-text("Remove from this dashboard")')).toBeVisible();
    await expect(popover.locator('button:has-text("Remove and delete")')).toBeVisible();
    await expect(popover.locator('button:has-text("Cancel")')).toBeVisible();
  });

  test('popover "Remove from this dashboard" unlinks but keeps the viz available', async ({
    page,
    request,
  }) => {
    const presetId = await seedPreset(request, uniqueName('P'));
    const vizId = await seedViz(request, presetId, uniqueName('Orphan'));
    const dashId = await seedDashboard(request, uniqueName('D'), [vizId]);

    await page.goto(`/visualizations?dashboard=${dashId}`);
    await waitForDashboardHydrated(page);
    await page.locator(`[data-remove-viz="${vizId}"]`).click();
    await page.locator('.viz-remove-confirm button:has-text("Remove from this dashboard")').click();
    await expect(page.locator(`.dashboard-viz-card[data-viz-id="${vizId}"]`)).toHaveCount(0);

    // The viz survives — picker on a new dashboard offers it.
    const otherDash = await seedDashboard(request, uniqueName('Other'));
    await page.goto(`/visualizations?dashboard=${otherDash}`);
    await expect(page.locator(`[data-add-viz] option[value="${vizId}"]`)).toHaveCount(1);
  });

  test('popover "Remove and delete" wipes the viz from every dashboard', async ({
    page,
    request,
  }) => {
    const presetId = await seedPreset(request, uniqueName('P'));
    const vizId = await seedViz(request, presetId, uniqueName('Goner'));
    const dashId = await seedDashboard(request, uniqueName('D'), [vizId]);

    await page.goto(`/visualizations?dashboard=${dashId}`);
    await waitForDashboardHydrated(page);
    await page.locator(`[data-remove-viz="${vizId}"]`).click();
    await page
      .locator('.viz-remove-confirm button:has-text("Remove and delete visualization")')
      .click();
    await expect(page.locator(`.dashboard-viz-card[data-viz-id="${vizId}"]`)).toHaveCount(0);

    // Picker on another dashboard should not list this id any more.
    const otherDash = await seedDashboard(request, uniqueName('OtherDel'));
    await page.goto(`/visualizations?dashboard=${otherDash}`);
    await expect(page.locator(`[data-add-viz] option[value="${vizId}"]`)).toHaveCount(0);
  });

  test('popover Cancel closes without unlinking', async ({ page, request }) => {
    const presetId = await seedPreset(request, uniqueName('P'));
    const vizId = await seedViz(request, presetId, uniqueName('Stays'));
    const dashId = await seedDashboard(request, uniqueName('D'), [vizId]);

    await page.goto(`/visualizations?dashboard=${dashId}`);
    await waitForDashboardHydrated(page);
    await page.locator(`[data-remove-viz="${vizId}"]`).click();
    await page.locator('.viz-remove-confirm button:has-text("Cancel")').click();
    await expect(page.locator('.viz-remove-confirm')).toHaveCount(0);
    await expect(page.locator(`.dashboard-viz-card[data-viz-id="${vizId}"]`)).toBeVisible();
  });
});

// ── Create-viz modal ────────────────────────────────────────────────────────

test.describe('create-viz modal', () => {
  test('all three sections render together and update each other as the user picks dataset + template', async ({
    page,
    request,
  }) => {
    const presetName = uniqueName('PresetModal');
    await seedPreset(request, presetName);
    const dashId = await seedDashboard(request, uniqueName('ForModal'));

    await page.goto(`/visualizations?dashboard=${dashId}`);
    await waitForDashboardHydrated(page);
    await page.selectOption('[data-add-viz]', '__new__');

    // All three sections render together from the start.
    await expect(page.locator('.viz-modal')).toBeVisible();
    await expect(page.locator('text=Choose a dataset')).toBeVisible();
    await expect(page.locator('.viz-modal-template-card')).toHaveCount(6);
    await expect(page.locator('.viz-modal-section-placeholder')).toBeVisible();

    // Pick our preset → config section advances to "pick a template".
    await page.selectOption('.viz-modal-body select', { label: presetName });
    await expect(page.locator('.viz-modal-section-placeholder')).toBeVisible();

    // Pick a template → config form appears with name + slot select.
    await page.locator('.viz-modal-template-card:has-text("Category breakdown")').click();
    await expect(page.locator('#viz-modal-form input[name="name"]')).toBeVisible();
    await expect(page.locator('#viz-modal-form select[name="category_field"]')).toBeVisible();
    // Template card stays highlighted while the configure section is visible.
    await expect(
      page.locator('.viz-modal-template-card.is-selected:has-text("Category breakdown")')
    ).toBeVisible();
  });

  test('ESC closes the modal', async ({ page, request }) => {
    const dashId = await seedDashboard(request, uniqueName('Esc'));
    await page.goto(`/visualizations?dashboard=${dashId}`);
    await waitForDashboardHydrated(page);
    await page.selectOption('[data-add-viz]', '__new__');
    await expect(page.locator('.viz-modal')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.locator('.viz-modal')).not.toBeVisible();
  });

  test('switching template after selecting one swaps slot fields in place; dataset stays selected', async ({
    page,
    request,
  }) => {
    const presetName = uniqueName('PresetSwap');
    await seedPreset(request, presetName);
    const dashId = await seedDashboard(request, uniqueName('SwapD'));

    await page.goto(`/visualizations?dashboard=${dashId}`);
    await waitForDashboardHydrated(page);
    await page.selectOption('[data-add-viz]', '__new__');

    const datasetSelect = page.locator('.viz-modal-body select').first();
    await datasetSelect.selectOption({ label: presetName });
    const presetValue = await datasetSelect.inputValue();

    // First template — category_breakdown — exposes a category_field slot.
    await page.locator('.viz-modal-template-card:has-text("Category breakdown")').click();
    await expect(page.locator('#viz-modal-form select[name="category_field"]')).toBeVisible();
    await expect(page.locator('#viz-modal-form select[name="date_field"]')).toHaveCount(0);

    // Switch to a different template — slot fields swap with no walk-back step.
    await page.locator('.viz-modal-template-card:has-text("Throughput over time")').click();
    await expect(page.locator('#viz-modal-form select[name="date_field"]')).toBeVisible();
    await expect(page.locator('#viz-modal-form select[name="time_bucket"]')).toBeVisible();
    await expect(page.locator('#viz-modal-form select[name="category_field"]')).toHaveCount(0);

    // Dataset selection persists across the template switch.
    await expect(page.locator('.viz-modal-body select').first()).toHaveValue(presetValue);

    // Only the newly-clicked template is highlighted.
    await expect(page.locator('.viz-modal-template-card.is-selected')).toHaveCount(1);
    await expect(
      page.locator('.viz-modal-template-card.is-selected:has-text("Throughput over time")')
    ).toBeVisible();
  });
});

// ── Edit modal (pencil) ─────────────────────────────────────────────────────

test.describe('edit-viz modal', () => {
  test('pencil opens edit modal with all sections visible and name pre-filled', async ({
    page,
    request,
  }) => {
    const presetId = await seedPreset(request, uniqueName('PEdit'));
    const vizName = uniqueName('Editable');
    const vizId = await seedViz(request, presetId, vizName);
    const dashId = await seedDashboard(request, uniqueName('EditD'), [vizId]);

    await page.goto(`/visualizations?dashboard=${dashId}`);
    await waitForDashboardHydrated(page);
    await page.locator(`[data-edit-viz="${vizId}"]`).click();

    await expect(page.locator('.viz-modal')).toBeVisible();
    await expect(page.locator('.viz-modal-title')).toHaveText('Edit visualization');
    // All three sections are visible; the form is pre-filled and the selected
    // template card is highlighted.
    await expect(page.locator('.viz-modal-section')).toHaveCount(3);
    await expect(page.locator('#viz-modal-form input[name="name"]')).toHaveValue(vizName);
    await expect(page.locator('.viz-modal-template-card.is-selected')).toHaveCount(1);
    // Footer shows the save-mode chooser.
    await expect(page.locator('.viz-modal-footer button:has-text("Save changes")')).toBeVisible();
    await expect(page.locator('.viz-modal-footer button:has-text("Save as new")')).toBeVisible();
  });
});

// ── Cross-dashboard integrity ───────────────────────────────────────────────

test('a viz on two dashboards stays in sync via direct unlink', async ({ page, request }) => {
  const presetId = await seedPreset(request, uniqueName('Sync'));
  const vizId = await seedViz(request, presetId, uniqueName('SharedX'));
  const d1 = await seedDashboard(request, uniqueName('D1'), [vizId]);
  const d2 = await seedDashboard(request, uniqueName('D2'), [vizId]);

  // Sanity check both have the card before unlink.
  await page.goto(`/visualizations?dashboard=${d1}`);
  await expect(page.locator(`.dashboard-viz-card[data-viz-id="${vizId}"]`)).toBeVisible();
  await page.goto(`/visualizations?dashboard=${d2}`);
  await expect(page.locator(`.dashboard-viz-card[data-viz-id="${vizId}"]`)).toBeVisible();
});
