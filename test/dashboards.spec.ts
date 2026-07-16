import { type APIRequestContext, type Page } from '@playwright/test';
import { test, expect } from './strictTest';
import { decodeTreeHex } from '../src/domain/filterTreeCodec';
import { isGroup, isLeaf } from '../src/schemas/filterTree';
import type { FilterNode } from '../src/schemas/filterTree';

// ── Helpers ─────────────────────────────────────────────────────────────────

function uniqueName(prefix: string): string {
  return `${prefix}_${Date.now()}_${Math.floor(Math.random() * 100000)}`;
}

// Pulls the gte/lte bounds for `key` out of an /entities?f=... click-through
// URL's encoded filter tree, to assert on the date window it targets without
// depending on entity-type defaulting or seeded row counts.
function dateRangeFromEntityUrl(url: string, key: string): { gte?: string; lte?: string } {
  const f = new URL(url, 'http://localhost').searchParams.get('f');
  const tree = f ? decodeTreeHex(f) : null;
  const result: { gte?: string; lte?: string } = {};
  const walk = (node: FilterNode): void => {
    if (isLeaf(node) && node.key === key) {
      if (node.op === 'gte') result.gte = String(node.value);
      if (node.op === 'lte') result.lte = String(node.value);
    } else if (isGroup(node)) {
      node.children.forEach(walk);
    }
  };
  if (tree) walk(tree);
  return result;
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

// seedViz's `/test/visualizations` auto-picker grabs the first date field and
// first numeric field it finds, which can land on two fields with almost no
// overlapping entities (e.g. a github_pr-only numeric field paired with the
// entity table's own created_at). That's fine for tests that only check
// dataset *count*, but waymark anchor resolution needs a viz with real,
// overlapping history — so this seeds a field_trend viz with explicit,
// known-compatible jira_ticket fields via the real create API instead.
async function seedFieldTrendViz(
  request: APIRequestContext,
  presetId: number,
  name: string
): Promise<number> {
  const res = await request.post('/api/visualizations', {
    data: {
      name,
      presetId,
      templateConfig: {
        templateId: 'field_trend',
        slots: {
          dateField: 'jira_created_at',
          numericFields: ['total_lead_time_seconds'],
          timeBucket: 'week',
          aggregation: 'avg',
        },
      },
    },
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

  test('duplicate dashboard via the copy icon creates a "copy1 - " named clone', async ({
    page,
    request,
  }) => {
    const presetId = await seedPreset(request, uniqueName('PresetDup'));
    const vizId = await seedViz(request, presetId, uniqueName('DupViz'));
    const name = uniqueName('Original');
    const id = await seedDashboard(request, name, [vizId]);

    await page.goto(`/visualizations?dashboard=${id}`);
    await waitForDashboardHydrated(page);
    await page.locator('[data-dashboard-duplicate-form] button[type="submit"]').click();

    await expect(page).toHaveURL(/dashboard=\d+/);
    expect(page.url()).not.toContain(`dashboard=${id}`);
    await expect(page.locator('[data-dashboard-name-input]')).toHaveValue(`copy1 - ${name}`);

    // The duplicate shares the same visualization(s) as the source.
    await expect(page.locator(`[data-viz-id="${vizId}"]`)).toHaveCount(1);
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

  test('a slot dropdown only lists fields matching its required type', async ({
    page,
    request,
  }) => {
    const presetName = uniqueName('PresetTyped');
    await seedPreset(request, presetName);
    const dashId = await seedDashboard(request, uniqueName('TypedD'));

    await page.goto(`/visualizations?dashboard=${dashId}`);
    await waitForDashboardHydrated(page);
    await page.selectOption('[data-add-viz]', '__new__');
    await page.selectOption('.viz-modal-body select', { label: presetName });

    // Field trend has both a date_field and a numeric_fields slot on the same
    // template, so it exercises both filters at once.
    await page.locator('.viz-modal-template-card:has-text("Field trend")').click();

    const dateSelect = page.locator('#viz-modal-form select[name="date_field"]');
    const numericSelect = page.locator('#viz-modal-form select[name="numeric_fields"]');

    // The date dropdown must contain only date fields — no string/number fields.
    await expect(dateSelect.locator('option[value="jira_created_at"]')).toHaveCount(1);
    await expect(dateSelect.locator('option[value="ticket_type"]')).toHaveCount(0);
    await expect(dateSelect.locator('option[value="total_lead_time_seconds"]')).toHaveCount(0);

    // The numeric dropdown must contain only number fields — no string/date fields.
    await expect(numericSelect.locator('option[value="total_lead_time_seconds"]')).toHaveCount(1);
    await expect(numericSelect.locator('option[value="ticket_type"]')).toHaveCount(0);
    await expect(numericSelect.locator('option[value="jira_created_at"]')).toHaveCount(0);
  });

  test('the category field dropdown on category breakdown only lists string fields', async ({
    page,
    request,
  }) => {
    const presetName = uniqueName('PresetCatTyped');
    await seedPreset(request, presetName);
    const dashId = await seedDashboard(request, uniqueName('CatTypedD'));

    await page.goto(`/visualizations?dashboard=${dashId}`);
    await waitForDashboardHydrated(page);
    await page.selectOption('[data-add-viz]', '__new__');
    await page.selectOption('.viz-modal-body select', { label: presetName });
    await page.locator('.viz-modal-template-card:has-text("Category breakdown")').click();

    const categorySelect = page.locator('#viz-modal-form select[name="category_field"]');

    await expect(categorySelect.locator('option[value="ticket_type"]')).toHaveCount(1);
    await expect(categorySelect.locator('option[value="total_lead_time_seconds"]')).toHaveCount(0);
    await expect(categorySelect.locator('option[value="jira_created_at"]')).toHaveCount(0);
  });
});

// ── Extra-wide viz layout ───────────────────────────────────────────────────

test.describe('extra-wide viz layout', () => {
  test('setting "Double wide" in the create modal renders a wide card and persists via the API', async ({
    page,
    request,
  }) => {
    const presetName = uniqueName('PresetWide');
    await seedPreset(request, presetName);
    const dashId = await seedDashboard(request, uniqueName('WideD'));
    const vizName = uniqueName('WideViz');

    await page.goto(`/visualizations?dashboard=${dashId}`);
    await waitForDashboardHydrated(page);
    await page.selectOption('[data-add-viz]', '__new__');
    await page.selectOption('.viz-modal-body select', { label: presetName });
    await page.locator('.viz-modal-template-card:has-text("Category breakdown")').click();

    await page.fill('#viz-modal-form input[name="name"]', vizName);
    await page.selectOption('#viz-modal-form select[name="category_field"]', { index: 1 });
    await page.selectOption('#viz-modal-form select[name="layout"]', 'wide');
    await page.locator('.viz-modal-footer button:has-text("Save")').click();

    const card = page.locator(`.dashboard-viz-card:has-text("${vizName}")`);
    await expect(card).toBeVisible();
    await expect(card).toHaveClass(/dashboard-viz-card--wide/);

    const vizId = await card.getAttribute('data-viz-id');
    const res = await request.get(`/api/visualizations/${vizId}`);
    expect((await res.json()).layout).toBe('wide');
  });

  test('a wide card keeps its wide class after an AJAX date-range refresh', async ({
    page,
    request,
  }) => {
    // applyCardUpdate() re-toggles dashboard-viz-card--wide on every range-driven
    // card refresh; this guards against that toggle being dropped or inverted.
    const presetName = uniqueName('PresetWideRange');
    await seedPreset(request, presetName);
    const dashId = await seedDashboard(request, uniqueName('WideRangeD'));
    const vizName = uniqueName('WideRangeViz');

    await page.goto(`/visualizations?dashboard=${dashId}`);
    await waitForDashboardHydrated(page);
    await page.selectOption('[data-add-viz]', '__new__');
    await page.selectOption('.viz-modal-body select', { label: presetName });
    await page.locator('.viz-modal-template-card:has-text("Category breakdown")').click();
    await page.fill('#viz-modal-form input[name="name"]', vizName);
    await page.selectOption('#viz-modal-form select[name="category_field"]', { index: 1 });
    await page.selectOption('#viz-modal-form select[name="layout"]', 'wide');
    await page.locator('.viz-modal-footer button:has-text("Save")').click();

    const card = page.locator(`.dashboard-viz-card:has-text("${vizName}")`);
    await expect(card).toHaveClass(/dashboard-viz-card--wide/);

    await waitForDashboardHydrated(page);
    await page.selectOption('[data-date-range-period]', 'week');
    await expect(page.locator('[data-date-range-label]')).toBeVisible();
    await expect(card).toHaveClass(/dashboard-viz-card--wide/);
  });

  test('editing a viz from Normal to "Double wide" adds the wide class after save', async ({
    page,
    request,
  }) => {
    const presetId = await seedPreset(request, uniqueName('PresetWideEdit'));
    const vizId = await seedViz(request, presetId, uniqueName('WideEditViz'));
    const dashId = await seedDashboard(request, uniqueName('WideEditD'), [vizId]);

    await page.goto(`/visualizations?dashboard=${dashId}`);
    await waitForDashboardHydrated(page);
    const card = page.locator(`.dashboard-viz-card[data-viz-id="${vizId}"]`);
    await expect(card).not.toHaveClass(/dashboard-viz-card--wide/);

    await page.locator(`[data-edit-viz="${vizId}"]`).click();
    await expect(page.locator('.viz-modal')).toBeVisible();
    await page.selectOption('#viz-modal-form select[name="layout"]', 'wide');
    await page.locator('.viz-modal-footer button:has-text("Save changes")').click();

    await expect(card).toHaveClass(/dashboard-viz-card--wide/);
    const res = await request.get(`/api/visualizations/${vizId}`);
    expect((await res.json()).layout).toBe('wide');
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

  test('switching dataset then clicking "Save changes" persists the new preset', async ({
    page,
    request,
  }) => {
    const presetAId = await seedPreset(request, uniqueName('EditPresetA'));
    const presetBName = uniqueName('EditPresetB');
    const presetBId = await seedPreset(request, presetBName);
    const vizId = await seedViz(request, presetAId, uniqueName('SwapDataset'));
    const dashId = await seedDashboard(request, uniqueName('SwapDatasetD'), [vizId]);

    await page.goto(`/visualizations?dashboard=${dashId}`);
    await waitForDashboardHydrated(page);
    await page.locator(`[data-edit-viz="${vizId}"]`).click();
    await expect(page.locator('.viz-modal')).toBeVisible();

    await page.locator('.viz-modal-body select').first().selectOption({ label: presetBName });
    await page.locator('.viz-modal-footer button:has-text("Save changes")').click();
    await expect(page.locator('.viz-modal')).not.toBeVisible();

    const res = await request.get(`/api/visualizations/${vizId}`);
    const detail = await res.json();
    expect(detail.presetId).toBe(presetBId);
  });
});

// ── Unit transform slots (measureTransform) ─────────────────────────────────
// category_comparison and field_trend expose an optional unit divisor + label
// pair so a raw numeric field (e.g. seconds) can be displayed in a
// user-chosen unit consistently on the axis and in tooltips.

test.describe('unit transform slots', () => {
  test('category_comparison and field_trend both expose optional divisor/label inputs', async ({
    page,
    request,
  }) => {
    const presetName = uniqueName('PresetUnit');
    await seedPreset(request, presetName);
    const dashId = await seedDashboard(request, uniqueName('UnitD'));

    await page.goto(`/visualizations?dashboard=${dashId}`);
    await waitForDashboardHydrated(page);
    await page.selectOption('[data-add-viz]', '__new__');
    await page.selectOption('.viz-modal-body select', { label: presetName });

    await page.locator('.viz-modal-template-card:has-text("Category comparison")').click();
    await expect(page.locator('#viz-modal-form input[name="unit_divisor"]')).toBeVisible();
    await expect(page.locator('#viz-modal-form input[name="unit_label"]')).toBeVisible();

    await page.locator('.viz-modal-template-card:has-text("Field trend")').click();
    await expect(page.locator('#viz-modal-form input[name="unit_divisor"]')).toBeVisible();
    await expect(page.locator('#viz-modal-form input[name="unit_label"]')).toBeVisible();
  });

  test('leaving the unit divisor/label blank does not block saving', async ({ page, request }) => {
    const presetName = uniqueName('PresetUnitBlank');
    await seedPreset(request, presetName);
    const dashId = await seedDashboard(request, uniqueName('UnitBlankD'));
    const vizName = uniqueName('UnitBlankViz');

    await page.goto(`/visualizations?dashboard=${dashId}`);
    await waitForDashboardHydrated(page);
    await page.selectOption('[data-add-viz]', '__new__');
    await page.selectOption('.viz-modal-body select', { label: presetName });
    await page.locator('.viz-modal-template-card:has-text("Category comparison")').click();

    await page.fill('#viz-modal-form input[name="name"]', vizName);
    await page.selectOption('#viz-modal-form select[name="category_field"]', 'ticket_type');
    await page.selectOption(
      '#viz-modal-form select[name="numeric_field"]',
      'total_lead_time_seconds'
    );
    // unit_divisor / unit_label left blank on purpose.
    await page.locator('.viz-modal-footer button:has-text("Save")').click();

    await expect(page.locator(`.dashboard-viz-card:has-text("${vizName}")`)).toBeVisible();
  });

  test('a filled divisor/label scales the saved chart values and labels the axis + tooltip', async ({
    page,
    request,
  }) => {
    const presetName = uniqueName('PresetUnitFilled');
    await seedPreset(request, presetName);
    const dashId = await seedDashboard(request, uniqueName('UnitFilledD'));
    const vizName = uniqueName('UnitFilledViz');

    await page.goto(`/visualizations?dashboard=${dashId}`);
    await waitForDashboardHydrated(page);
    await page.selectOption('[data-add-viz]', '__new__');
    await page.selectOption('.viz-modal-body select', { label: presetName });
    await page.locator('.viz-modal-template-card:has-text("Category comparison")').click();

    await page.fill('#viz-modal-form input[name="name"]', vizName);
    await page.selectOption('#viz-modal-form select[name="category_field"]', 'ticket_type');
    await page.selectOption(
      '#viz-modal-form select[name="numeric_field"]',
      'total_lead_time_seconds'
    );
    await page.selectOption('#viz-modal-form select[name="aggregation"]', 'avg');
    await page.fill('#viz-modal-form input[name="unit_divisor"]', '86400');
    await page.fill('#viz-modal-form input[name="unit_label"]', 'days');
    await page.locator('.viz-modal-footer button:has-text("Save")').click();

    const card = page.locator(`.dashboard-viz-card:has-text("${vizName}")`);
    await expect(card).toBeVisible();
    const vizId = await card.getAttribute('data-viz-id');

    const res = await request.get(`/api/chart-data/${vizId}`);
    expect(res.ok()).toBeTruthy();
    const { chartJsConfig } = await res.json();
    expect(chartJsConfig.options.scales.y.title.text).toContain('days');
    expect(chartJsConfig.options.plugins.tooltip.unitLabel).toBe('days');
    // total_lead_time_seconds values are on the order of millions of seconds —
    // divided by 86400 they land well under 1000 (days), proving the raw
    // value was actually scaled and not just relabeled.
    const value = chartJsConfig.data.datasets[0].data[0];
    expect(value).toBeGreaterThan(0);
    expect(value).toBeLessThan(1000);
  });

  test('editing a saved viz to change the divisor/label updates the displayed chart', async ({
    page,
    request,
  }) => {
    const presetId = await seedPreset(request, uniqueName('PresetUnitEdit'));
    const vizId = await seedViz(
      request,
      presetId,
      uniqueName('UnitEditViz'),
      'category_comparison'
    );
    const dashId = await seedDashboard(request, uniqueName('UnitEditD'), [vizId]);

    await page.goto(`/visualizations?dashboard=${dashId}`);
    await waitForDashboardHydrated(page);
    await page.locator(`[data-edit-viz="${vizId}"]`).click();
    await expect(page.locator('.viz-modal')).toBeVisible();

    await page.fill('#viz-modal-form input[name="unit_divisor"]', '3600');
    await page.fill('#viz-modal-form input[name="unit_label"]', 'hours');
    await page.locator('.viz-modal-footer button:has-text("Save changes")').click();
    await expect(page.locator('.viz-modal')).not.toBeVisible();

    const res = await request.get(`/api/chart-data/${vizId}`);
    const { chartJsConfig } = await res.json();
    expect(chartJsConfig.options.scales.y.title.text).toContain('hours');
    expect(chartJsConfig.options.plugins.tooltip.unitLabel).toBe('hours');

    // Now clear the label — the transform should switch back off.
    await page.locator(`[data-edit-viz="${vizId}"]`).click();
    await expect(page.locator('.viz-modal')).toBeVisible();
    await page.fill('#viz-modal-form input[name="unit_label"]', '');
    await page.locator('.viz-modal-footer button:has-text("Save changes")').click();
    await expect(page.locator('.viz-modal')).not.toBeVisible();

    const res2 = await request.get(`/api/chart-data/${vizId}`);
    const { chartJsConfig: cleared } = await res2.json();
    expect(cleared.options.plugins.tooltip.unitLabel).toBeUndefined();
  });
});

// field_trend exposes an optional smoothing window slot that adds a second,
// solid rolling-average line alongside the main series.

test.describe('field trend smoothing slot', () => {
  test('field trend exposes an optional smoothing window input', async ({ page, request }) => {
    const presetName = uniqueName('PresetSmooth');
    await seedPreset(request, presetName);
    const dashId = await seedDashboard(request, uniqueName('SmoothD'));

    await page.goto(`/visualizations?dashboard=${dashId}`);
    await waitForDashboardHydrated(page);
    await page.selectOption('[data-add-viz]', '__new__');
    await page.selectOption('.viz-modal-body select', { label: presetName });
    await page.locator('.viz-modal-template-card:has-text("Field trend")').click();

    await expect(page.locator('#viz-modal-form input[name="smoothing_window"]')).toBeVisible();
  });

  test('leaving the smoothing window blank does not block saving and adds no extra line', async ({
    page,
    request,
  }) => {
    const presetName = uniqueName('PresetSmoothBlank');
    await seedPreset(request, presetName);
    const dashId = await seedDashboard(request, uniqueName('SmoothBlankD'));
    const vizName = uniqueName('SmoothBlankViz');

    await page.goto(`/visualizations?dashboard=${dashId}`);
    await waitForDashboardHydrated(page);
    await page.selectOption('[data-add-viz]', '__new__');
    await page.selectOption('.viz-modal-body select', { label: presetName });
    await page.locator('.viz-modal-template-card:has-text("Field trend")').click();

    await page.fill('#viz-modal-form input[name="name"]', vizName);
    await page.selectOption('#viz-modal-form select[name="date_field"]', 'jira_created_at');
    await page.selectOption(
      '#viz-modal-form select[name="numeric_fields"]',
      'total_lead_time_seconds'
    );
    // smoothing_window left blank on purpose.
    await page.locator('.viz-modal-footer button:has-text("Save")').click();

    const card = page.locator(`.dashboard-viz-card:has-text("${vizName}")`);
    await expect(card).toBeVisible();
    const vizId = await card.getAttribute('data-viz-id');

    const res = await request.get(`/api/chart-data/${vizId}`);
    const { chartJsConfig } = await res.json();
    expect(chartJsConfig.data.datasets.length).toBe(1);
  });

  test('a filled smoothing window adds a solid rolling-average line', async ({ page, request }) => {
    const presetName = uniqueName('PresetSmoothFilled');
    await seedPreset(request, presetName);
    const dashId = await seedDashboard(request, uniqueName('SmoothFilledD'));
    const vizName = uniqueName('SmoothFilledViz');

    await page.goto(`/visualizations?dashboard=${dashId}`);
    await waitForDashboardHydrated(page);
    await page.selectOption('[data-add-viz]', '__new__');
    await page.selectOption('.viz-modal-body select', { label: presetName });
    await page.locator('.viz-modal-template-card:has-text("Field trend")').click();

    await page.fill('#viz-modal-form input[name="name"]', vizName);
    await page.selectOption('#viz-modal-form select[name="date_field"]', 'jira_created_at');
    await page.selectOption(
      '#viz-modal-form select[name="numeric_fields"]',
      'total_lead_time_seconds'
    );
    await page.fill('#viz-modal-form input[name="smoothing_window"]', '4');
    await page.locator('.viz-modal-footer button:has-text("Save")').click();

    const card = page.locator(`.dashboard-viz-card:has-text("${vizName}")`);
    await expect(card).toBeVisible();
    const vizId = await card.getAttribute('data-viz-id');

    const res = await request.get(`/api/chart-data/${vizId}`);
    expect(res.ok()).toBeTruthy();
    const { chartJsConfig } = await res.json();
    expect(chartJsConfig.data.datasets.length).toBe(2);
    const smoothingDs = chartJsConfig.data.datasets[1];
    expect(smoothingDs.label).toContain('4-point avg');
    // The line reads as a first-class series, not a dashed reference line.
    expect(smoothingDs.borderDash).toBeUndefined();
    expect(smoothingDs.pointRadius).toBeGreaterThan(0);
  });

  test('a smoothing-line point click-through targets the entities across its whole window', async ({
    page,
    request,
  }) => {
    const presetName = uniqueName('PresetSmoothWindow');
    await seedPreset(request, presetName);
    const dashId = await seedDashboard(request, uniqueName('SmoothWindowD'));
    const vizName = uniqueName('SmoothWindowViz');

    await page.goto(`/visualizations?dashboard=${dashId}`);
    await waitForDashboardHydrated(page);
    await page.selectOption('[data-add-viz]', '__new__');
    await page.selectOption('.viz-modal-body select', { label: presetName });
    await page.locator('.viz-modal-template-card:has-text("Field trend")').click();

    await page.fill('#viz-modal-form input[name="name"]', vizName);
    await page.selectOption('#viz-modal-form select[name="date_field"]', 'jira_created_at');
    await page.selectOption(
      '#viz-modal-form select[name="numeric_fields"]',
      'total_lead_time_seconds'
    );
    await page.fill('#viz-modal-form input[name="smoothing_window"]', '4');
    await page.locator('.viz-modal-footer button:has-text("Save")').click();

    const card = page.locator(`.dashboard-viz-card:has-text("${vizName}")`);
    await expect(card).toBeVisible();
    const canvas = card.locator('canvas');

    const smoothingDatasetIndex = await canvas.getAttribute('data-smoothing-dataset-index');
    expect(smoothingDatasetIndex).toBe('1');

    const pointUrls = JSON.parse((await canvas.getAttribute('data-point-urls')) ?? '[]');
    const smoothingPointUrls = JSON.parse(
      (await canvas.getAttribute('data-smoothing-point-urls')) ?? '[]'
    );
    expect(smoothingPointUrls.length).toBe(pointUrls.length);

    // The very first bucket has no history, so its window collapses to just
    // that bucket — main and smoothing point-through URLs should match.
    expect(smoothingPointUrls[0]).toBe(pointUrls[0]);

    // A later point's smoothing window spans multiple buckets: its filter's
    // gte should reach further back than the main point's, while both share
    // the same lte (the window's most recent bucket, same as the main point).
    const lastIndex = pointUrls.length - 1;
    const mainRange = dateRangeFromEntityUrl(pointUrls[lastIndex], 'jira_created_at');
    const smoothingRange = dateRangeFromEntityUrl(smoothingPointUrls[lastIndex], 'jira_created_at');
    expect(mainRange.gte).toBeTruthy();
    expect(smoothingRange.gte).toBeTruthy();
    expect(new Date(smoothingRange.gte!).getTime()).toBeLessThan(
      new Date(mainRange.gte!).getTime()
    );
    expect(smoothingRange.lte).toBe(mainRange.lte);
  });

  test('editing a saved viz to add a smoothing window updates the displayed chart', async ({
    page,
    request,
  }) => {
    const presetId = await seedPreset(request, uniqueName('PresetSmoothEdit'));
    const vizId = await seedViz(request, presetId, uniqueName('SmoothEditViz'), 'field_trend');
    const dashId = await seedDashboard(request, uniqueName('SmoothEditD'), [vizId]);

    await page.goto(`/visualizations?dashboard=${dashId}`);
    await waitForDashboardHydrated(page);
    await page.locator(`[data-edit-viz="${vizId}"]`).click();
    await expect(page.locator('.viz-modal')).toBeVisible();

    await page.fill('#viz-modal-form input[name="smoothing_window"]', '3');
    await page.locator('.viz-modal-footer button:has-text("Save changes")').click();
    await expect(page.locator('.viz-modal')).not.toBeVisible();

    const res = await request.get(`/api/chart-data/${vizId}`);
    const { chartJsConfig } = await res.json();
    expect(chartJsConfig.data.datasets.length).toBe(2);
    expect(chartJsConfig.data.datasets[1].label).toContain('3-point avg');

    // Now clear the window — smoothing should switch back off.
    await page.locator(`[data-edit-viz="${vizId}"]`).click();
    await expect(page.locator('.viz-modal')).toBeVisible();
    await page.fill('#viz-modal-form input[name="smoothing_window"]', '');
    await page.locator('.viz-modal-footer button:has-text("Save changes")').click();
    await expect(page.locator('.viz-modal')).not.toBeVisible();

    const res2 = await request.get(`/api/chart-data/${vizId}`);
    const { chartJsConfig: cleared } = await res2.json();
    expect(cleared.data.datasets.length).toBe(1);
  });

  test('a bounded dashboard date range still produces a TRUE rolling average, not one clipped to the range', async ({
    page,
    request,
  }) => {
    const presetName = uniqueName('PresetSmoothRange');
    await seedPreset(request, presetName);
    const dashId = await seedDashboard(request, uniqueName('SmoothRangeD'));
    const vizName = uniqueName('SmoothRangeViz');

    await page.goto(`/visualizations?dashboard=${dashId}`);
    await waitForDashboardHydrated(page);
    await page.selectOption('[data-add-viz]', '__new__');
    await page.selectOption('.viz-modal-body select', { label: presetName });
    await page.locator('.viz-modal-template-card:has-text("Field trend")').click();

    await page.fill('#viz-modal-form input[name="name"]', vizName);
    await page.selectOption('#viz-modal-form select[name="date_field"]', 'jira_created_at');
    await page.selectOption(
      '#viz-modal-form select[name="numeric_fields"]',
      'total_lead_time_seconds'
    );
    await page.fill('#viz-modal-form input[name="smoothing_window"]', '4');
    await page.locator('.viz-modal-footer button:has-text("Save")').click();
    await expect(page.locator(`.dashboard-viz-card:has-text("${vizName}")`)).toBeVisible();

    const unboundedRes = await request.get(`/api/dashboards/${dashId}/cards`);
    const { cards: unboundedCards } = await unboundedRes.json();
    const unboundedCard = unboundedCards[0];
    const smoothIdx: number = unboundedCard.smoothingDatasetIndex;
    expect(smoothIdx).not.toBeNull();
    const labels: string[] = unboundedCard.chartJsConfig.data.labels;
    expect(labels.length).toBeGreaterThanOrEqual(2);

    // Bounding the range to start at the last bucket should still average
    // over the same history as the unbounded chart, not just that one point.
    const pivot = labels.length - 1;
    const pivotLabel = labels[pivot];
    const rs = pivotLabel.match(/\d{4}-\d{2}-\d{2}/)?.[0];
    expect(rs).toBeTruthy();

    const boundedRes = await request.get(`/api/dashboards/${dashId}/cards?range=custom&rs=${rs}`);
    const { cards: boundedCards } = await boundedRes.json();
    const boundedCard = boundedCards[0];
    const boundedLabels: string[] = boundedCard.chartJsConfig.data.labels;
    expect(boundedLabels[0]).toBe(pivotLabel);

    const unboundedSmoothValue = unboundedCard.chartJsConfig.data.datasets[smoothIdx].data[pivot];
    const boundedSmoothValue = boundedCard.chartJsConfig.data.datasets[smoothIdx].data[0];
    expect(boundedSmoothValue).toBeCloseTo(unboundedSmoothValue, 5);

    // Sanity check this isn't trivially true because averaging collapsed to a
    // single point: the smoothed value should differ from the raw main value.
    const boundedMainValue = boundedCard.chartJsConfig.data.datasets[0].data[0];
    expect(boundedSmoothValue).not.toBeCloseTo(boundedMainValue, 5);
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

// ── Drag-and-drop reorder ───────────────────────────────────────────────────
// Chromium headless doesn't promote raw mouse events to HTML5 drag events,
// so these tests drive the flow by dispatching synthetic DragEvent objects
// with a shared DataTransfer. That verifies the JS handler logic and DOM
// updates, but not the browser's own drag machinery (e.g. removing
// `draggable="true"` from the JSX would still slip through).

async function orderedVizIds(page: Page): Promise<number[]> {
  return page.evaluate(() =>
    Array.from(document.querySelectorAll('.dashboard-viz-card')).map(el =>
      parseInt((el as HTMLElement).dataset.vizId ?? '', 10)
    )
  );
}

test.describe('drag-and-drop reorder', () => {
  test('grip icon renders in every card header', async ({ page, request }) => {
    const presetId = await seedPreset(request, uniqueName('GripP'));
    const v1 = await seedViz(request, presetId, uniqueName('V1'));
    const v2 = await seedViz(request, presetId, uniqueName('V2'));
    const dashId = await seedDashboard(request, uniqueName('GripD'), [v1, v2]);

    await page.goto(`/visualizations?dashboard=${dashId}`);
    await waitForDashboardHydrated(page);

    const grips = page.locator('.dashboard-viz-card .dashboard-viz-card-grip');
    await expect(grips).toHaveCount(2);
    await expect(grips.first()).toHaveText('⋮⋮');
  });

  test('dragging past a card reorders the DOM and auto-saves the layout', async ({
    page,
    request,
  }) => {
    const presetId = await seedPreset(request, uniqueName('DragP'));
    const v1 = await seedViz(request, presetId, uniqueName('V1'));
    const v2 = await seedViz(request, presetId, uniqueName('V2'));
    const v3 = await seedViz(request, presetId, uniqueName('V3'));
    const dashId = await seedDashboard(request, uniqueName('DragD'), [v1, v2, v3]);

    await page.goto(`/visualizations?dashboard=${dashId}`);
    await waitForDashboardHydrated(page);

    expect(await orderedVizIds(page)).toEqual([v1, v2, v3]);
    await expect(page.locator('[data-dashboard-save-submit]')).toBeHidden();

    const source = page.locator(`.dashboard-viz-card[data-viz-id="${v1}"]`);
    const target = page.locator(`.dashboard-viz-card[data-viz-id="${v3}"]`);

    await page.evaluate(
      ({ srcId, tgtId }) => {
        const src = document.querySelector<HTMLElement>(
          `.dashboard-viz-card[data-viz-id="${srcId}"]`
        );
        const tgt = document.querySelector<HTMLElement>(
          `.dashboard-viz-card[data-viz-id="${tgtId}"]`
        );
        if (!src || !tgt) throw new Error('missing card');
        const dt = new DataTransfer();
        src.dispatchEvent(
          new DragEvent('dragstart', { bubbles: true, cancelable: true, dataTransfer: dt })
        );
        const rect = tgt.getBoundingClientRect();
        const clientX = rect.left + rect.width * 0.75;
        const clientY = rect.top + rect.height / 2;
        tgt.dispatchEvent(
          new DragEvent('dragover', {
            bubbles: true,
            cancelable: true,
            dataTransfer: dt,
            clientX,
            clientY,
          })
        );
        const w = window as unknown as { __dt: DataTransfer; __clientX: number; __clientY: number };
        w.__dt = dt;
        w.__clientX = clientX;
        w.__clientY = clientY;
      },
      { srcId: v1, tgtId: v3 }
    );

    await expect(source).toHaveClass(/is-dragging/);
    await expect(target).toHaveClass(/drop-after/);

    // Cursor in the left half should swap to .drop-before and clear .drop-after.
    await page.evaluate(tgtId => {
      const tgt = document.querySelector<HTMLElement>(
        `.dashboard-viz-card[data-viz-id="${tgtId}"]`
      );
      if (!tgt) throw new Error('missing target');
      const rect = tgt.getBoundingClientRect();
      const w = window as unknown as { __dt: DataTransfer };
      tgt.dispatchEvent(
        new DragEvent('dragover', {
          bubbles: true,
          cancelable: true,
          dataTransfer: w.__dt,
          clientX: rect.left + rect.width * 0.25,
          clientY: rect.top + rect.height / 2,
        })
      );
    }, v3);
    await expect(target).toHaveClass(/drop-before/);
    await expect(target).not.toHaveClass(/drop-after/);

    // Drop on the right half → v1 moves past v3.
    await page.evaluate(tgtId => {
      const tgt = document.querySelector<HTMLElement>(
        `.dashboard-viz-card[data-viz-id="${tgtId}"]`
      );
      if (!tgt) throw new Error('missing target');
      const rect = tgt.getBoundingClientRect();
      const w = window as unknown as { __dt: DataTransfer };
      const clientX = rect.left + rect.width * 0.75;
      const clientY = rect.top + rect.height / 2;
      tgt.dispatchEvent(
        new DragEvent('drop', {
          bubbles: true,
          cancelable: true,
          dataTransfer: w.__dt,
          clientX,
          clientY,
        })
      );
    }, v3);

    await expect.poll(async () => await orderedVizIds(page)).toEqual([v2, v3, v1]);
    // Reordering auto-saves — it must never require the (name-only) Save
    // Changes button, which drives from name-dirty state alone.
    await expect(page.locator('[data-dashboard-save-submit]')).toBeHidden();

    // Confirm the new order was actually persisted server-side, not just in the DOM.
    await page.reload();
    await waitForDashboardHydrated(page);
    expect(await orderedVizIds(page)).toEqual([v2, v3, v1]);
  });
});

// ── Waymarks ─────────────────────────────────────────────────────────────────
// A waymark is a goal-line overlay: a straight line from the visualization's
// actual value at a start date to a user-entered target at an end date. They
// require a time-bucketed x-axis, so every test here seeds a "Field trend"
// viz (seedViz auto-picks a date + numeric field for that template).

test.describe('waymarks', () => {
  type DashboardCardPayload = {
    id: number;
    chartJsConfig: { data: { datasets: { label: string }[] } };
  };

  async function openWaymarkModal(page: Page, vizId: number): Promise<void> {
    await page.locator(`[data-waymark-viz="${vizId}"]`).click();
    await expect(page.locator('.waymark-dialog')).toBeVisible();
  }

  async function fillWaymarkForm(
    page: Page,
    opts: { startDate: string; endDate: string; targetValue: string; label?: string }
  ): Promise<void> {
    await page.locator('.waymark-dialog input[name="start_date"]').fill(opts.startDate);
    await page.locator('.waymark-dialog input[name="end_date"]').fill(opts.endDate);
    await page.locator('.waymark-dialog input[name="target_value"]').fill(opts.targetValue);
    if (opts.label != null) {
      await page.locator('.waymark-dialog input[name="label"]').fill(opts.label);
    }
  }

  async function getCard(request: APIRequestContext, dashId: number, vizId: number) {
    const res = await request.get(`/api/dashboards/${dashId}/cards`);
    expect(res.ok()).toBeTruthy();
    const { cards } = (await res.json()) as { cards: DashboardCardPayload[] };
    const card = cards.find(c => c.id === vizId);
    expect(card).toBeDefined();
    return card!;
  }

  test('waymark button opens the modal with an empty state', async ({ page, request }) => {
    const presetId = await seedPreset(request, uniqueName('PresetWaymark'));
    const vizId = await seedFieldTrendViz(request, presetId, uniqueName('WaymarkViz'));
    const dashId = await seedDashboard(request, uniqueName('WaymarkD'), [vizId]);

    await page.goto(`/visualizations?dashboard=${dashId}`);
    await waitForDashboardHydrated(page);
    await openWaymarkModal(page, vizId);

    await expect(page.locator('.waymark-dialog .viz-modal-title')).toHaveText('Waymarks');
    await expect(page.locator('.waymark-dialog .viz-modal-section-placeholder')).toHaveText(
      'No waymarks yet.'
    );
    await expect(page.locator('.waymark-dialog h3:has-text("Add waymark")')).toBeVisible();
    // No smoothing configured on this viz, so the applies-to picker is absent.
    await expect(page.locator('.waymark-dialog select[name="applies_to"]')).toHaveCount(0);
  });

  test('adding a waymark renders it in the list and adds a dataset to the chart', async ({
    page,
    request,
  }) => {
    const presetId = await seedPreset(request, uniqueName('PresetWaymarkAdd'));
    const vizId = await seedFieldTrendViz(request, presetId, uniqueName('WaymarkAddViz'));
    const dashId = await seedDashboard(request, uniqueName('WaymarkAddD'), [vizId]);

    await page.goto(`/visualizations?dashboard=${dashId}`);
    await waitForDashboardHydrated(page);
    await openWaymarkModal(page, vizId);

    await fillWaymarkForm(page, {
      startDate: '2024-02-01',
      endDate: '2027-01-01',
      targetValue: '42',
      label: 'Goal',
    });
    await page.locator('.waymark-dialog button:has-text("Add waymark")').click();

    await expect(page.locator('.waymark-dialog .waymark-list-item')).toHaveCount(1);
    await expect(page.locator('.waymark-dialog .waymark-list-summary')).toContainText('Goal');
    await expect(page.locator('.waymark-dialog .waymark-list-summary')).toContainText('main line');
    // The form resets back to "Add waymark" mode after a successful save.
    await expect(page.locator('.waymark-dialog h3:has-text("Add waymark")')).toBeVisible();

    const card = await getCard(request, dashId, vizId);
    expect(card.chartJsConfig.data.datasets.length).toBe(2);
    expect(card.chartJsConfig.data.datasets[1].label).toBe('Goal');
  });

  test('editing a waymark updates the list and the chart', async ({ page, request }) => {
    const presetId = await seedPreset(request, uniqueName('PresetWaymarkEdit'));
    const vizId = await seedFieldTrendViz(request, presetId, uniqueName('WaymarkEditViz'));
    const dashId = await seedDashboard(request, uniqueName('WaymarkEditD'), [vizId]);

    await page.goto(`/visualizations?dashboard=${dashId}`);
    await waitForDashboardHydrated(page);
    await openWaymarkModal(page, vizId);
    await fillWaymarkForm(page, {
      startDate: '2024-02-01',
      endDate: '2027-01-01',
      targetValue: '10',
    });
    await page.locator('.waymark-dialog button:has-text("Add waymark")').click();
    await expect(page.locator('.waymark-dialog .waymark-list-item')).toHaveCount(1);

    await page.locator('.waymark-dialog [title="Edit waymark"]').click();
    await expect(page.locator('.waymark-dialog h3:has-text("Edit waymark")')).toBeVisible();
    // Existing values are pre-filled.
    await expect(page.locator('.waymark-dialog input[name="target_value"]')).toHaveValue('10');

    await page.locator('.waymark-dialog input[name="target_value"]').fill('99');
    await page.locator('.waymark-dialog button:has-text("Save changes")').click();

    await expect(page.locator('.waymark-dialog .waymark-list-summary')).toContainText('99');
    const card = await getCard(request, dashId, vizId);
    expect(card.chartJsConfig.data.datasets.length).toBe(2);
  });

  test('cancelling an edit reverts the form to "Add waymark" without changing the list', async ({
    page,
    request,
  }) => {
    const presetId = await seedPreset(request, uniqueName('PresetWaymarkCancel'));
    const vizId = await seedFieldTrendViz(request, presetId, uniqueName('WaymarkCancelViz'));
    const dashId = await seedDashboard(request, uniqueName('WaymarkCancelD'), [vizId]);

    await page.goto(`/visualizations?dashboard=${dashId}`);
    await waitForDashboardHydrated(page);
    await openWaymarkModal(page, vizId);
    await fillWaymarkForm(page, {
      startDate: '2024-02-01',
      endDate: '2027-01-01',
      targetValue: '10',
    });
    await page.locator('.waymark-dialog button:has-text("Add waymark")').click();
    await expect(page.locator('.waymark-dialog .waymark-list-item')).toHaveCount(1);

    await page.locator('.waymark-dialog [title="Edit waymark"]').click();
    await expect(page.locator('.waymark-dialog h3:has-text("Edit waymark")')).toBeVisible();
    await page.locator('.waymark-dialog button:has-text("Cancel")').click();

    await expect(page.locator('.waymark-dialog h3:has-text("Add waymark")')).toBeVisible();
    await expect(page.locator('.waymark-dialog .waymark-list-summary')).toContainText('10');
  });

  test('deleting a waymark (auto-accepts confirm) removes it from the list and the chart', async ({
    page,
    request,
  }) => {
    const presetId = await seedPreset(request, uniqueName('PresetWaymarkDelete'));
    const vizId = await seedFieldTrendViz(request, presetId, uniqueName('WaymarkDeleteViz'));
    const dashId = await seedDashboard(request, uniqueName('WaymarkDeleteD'), [vizId]);

    await page.goto(`/visualizations?dashboard=${dashId}`);
    await waitForDashboardHydrated(page);
    await openWaymarkModal(page, vizId);
    await fillWaymarkForm(page, {
      startDate: '2024-02-01',
      endDate: '2027-01-01',
      targetValue: '10',
    });
    await page.locator('.waymark-dialog button:has-text("Add waymark")').click();
    await expect(page.locator('.waymark-dialog .waymark-list-item')).toHaveCount(1);

    page.on('dialog', d => d.accept());
    await page.locator('.waymark-dialog [title="Delete waymark"]').click();

    await expect(page.locator('.waymark-dialog .viz-modal-section-placeholder')).toHaveText(
      'No waymarks yet.'
    );
    const card = await getCard(request, dashId, vizId);
    expect(card.chartJsConfig.data.datasets.length).toBe(1);
  });

  test('applies-to selector is hidden until smoothing is configured, then offers both lines', async ({
    page,
    request,
  }) => {
    const presetId = await seedPreset(request, uniqueName('PresetWaymarkApplies'));
    const vizId = await seedFieldTrendViz(request, presetId, uniqueName('WaymarkAppliesViz'));
    const dashId = await seedDashboard(request, uniqueName('WaymarkAppliesD'), [vizId]);

    await page.goto(`/visualizations?dashboard=${dashId}`);
    await waitForDashboardHydrated(page);
    await openWaymarkModal(page, vizId);
    await expect(page.locator('.waymark-dialog select[name="applies_to"]')).toHaveCount(0);
    await page.locator('.waymark-dialog button:has-text("Close")').click();
    await expect(page.locator('.waymark-dialog')).not.toBeVisible();

    // Add a smoothing window to the visualization via the edit modal.
    await page.locator(`[data-edit-viz="${vizId}"]`).click();
    await expect(page.locator('.viz-modal')).toBeVisible();
    await page.fill('#viz-modal-form input[name="smoothing_window"]', '3');
    await page.locator('.viz-modal-footer button:has-text("Save changes")').click();
    await expect(page.locator('.viz-modal')).not.toBeVisible();

    await openWaymarkModal(page, vizId);
    const appliesSelect = page.locator('.waymark-dialog select[name="applies_to"]');
    await expect(appliesSelect).toBeVisible();
    await expect(appliesSelect.locator('option')).toHaveCount(2);

    await appliesSelect.selectOption('smoothing');
    await fillWaymarkForm(page, {
      startDate: '2024-02-01',
      endDate: '2027-01-01',
      targetValue: '10',
    });
    await page.locator('.waymark-dialog button:has-text("Add waymark")').click();
    await expect(page.locator('.waymark-dialog .waymark-list-summary')).toContainText(
      'smoothing avg'
    );
  });

  test('leaving required fields blank is rejected client-side without creating a waymark', async ({
    page,
    request,
  }) => {
    const presetId = await seedPreset(request, uniqueName('PresetWaymarkInvalid'));
    const vizId = await seedFieldTrendViz(request, presetId, uniqueName('WaymarkInvalidViz'));
    const dashId = await seedDashboard(request, uniqueName('WaymarkInvalidD'), [vizId]);

    await page.goto(`/visualizations?dashboard=${dashId}`);
    await waitForDashboardHydrated(page);
    await openWaymarkModal(page, vizId);

    let alertMessage = '';
    page.on('dialog', d => {
      alertMessage = d.message();
      void d.accept();
    });
    // Only the target value is filled in; both dates are left blank.
    await page.locator('.waymark-dialog input[name="target_value"]').fill('10');
    await page.locator('.waymark-dialog button:has-text("Add waymark")').click();

    await expect.poll(() => alertMessage).toContain('required');
    await expect(page.locator('.waymark-dialog .waymark-list-item')).toHaveCount(0);

    const res = await request.get(`/api/visualizations/${vizId}/waymarks`);
    const { waymarks } = await res.json();
    expect(waymarks).toHaveLength(0);
  });

  test('the waymark modal is independent of the create/edit viz modal', async ({
    page,
    request,
  }) => {
    // Regression guard: both dialogs used to share the `.viz-modal` class,
    // which made `.viz-modal` an ambiguous locator once the waymark dialog
    // existed on the page at all (even closed/empty).
    const presetId = await seedPreset(request, uniqueName('PresetWaymarkIsolation'));
    const vizId = await seedViz(
      request,
      presetId,
      uniqueName('WaymarkIsolationViz'),
      'field_trend'
    );
    const dashId = await seedDashboard(request, uniqueName('WaymarkIsolationD'), [vizId]);

    await page.goto(`/visualizations?dashboard=${dashId}`);
    await waitForDashboardHydrated(page);

    await expect(page.locator('.viz-modal')).toHaveCount(1);
    await expect(page.locator('.waymark-dialog')).toHaveCount(1);

    await page.locator(`[data-edit-viz="${vizId}"]`).click();
    await expect(page.locator('.viz-modal')).toBeVisible();
    await expect(page.locator('.waymark-dialog')).not.toBeVisible();
  });
});
