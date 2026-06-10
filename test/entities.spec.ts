import { test, expect } from '@playwright/test';

test('redirects root to /entities', async ({ page }) => {
  await page.goto('/');
  await expect(page).toHaveURL('/entities');
});

test('entities page has correct title and heading', async ({ page }) => {
  await page.goto('/entities');
  await expect(page).toHaveTitle(/Entities.*Dev Waymark/);
  await expect(page.locator('h1')).toHaveText('Entities');
});

test('filter form and add-filter control are present', async ({ page }) => {
  await page.goto('/entities');
  await expect(page.locator('[data-filter-form]')).toBeAttached();
  await expect(page.locator('[data-filter-add-form]')).toBeAttached();
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

test('filter chip: clicking content opens edit panel, clicking X removes filter', async ({
  page,
}) => {
  await page.goto('/entities');

  // Use entity_type which has discrete values (multi-select)
  const addSelect = page.locator('[data-filter-add-select]');
  const entityTypeOption = addSelect.locator('option[value="entity_type"]');
  if ((await entityTypeOption.count()) === 0) {
    test.skip();
    return;
  }

  // Add a filter by selecting entity_type from the dropdown
  await addSelect.selectOption('entity_type');
  const widgetPanel = page.locator('.filter-widget-panel[data-filter-key="entity_type"]');
  await expect(widgetPanel).toBeVisible();

  // Select the first value and apply
  const multiSelect = widgetPanel.locator('select[multiple]');
  const firstValue = await multiSelect.locator('option').first().getAttribute('value');
  if (!firstValue) {
    test.skip();
    return;
  }
  await multiSelect.selectOption(firstValue);
  await widgetPanel.locator('.filter-widget-apply').click();
  await page.waitForURL(/mf__entity_type__eq=/);

  // Remember the filtered result count
  const filteredCount = await page.locator('table.entity-table tbody tr').count();

  // Verify the chip is visible and NOT in editing state
  const chip = page.locator('.filter-chip[data-filter-edit-key="entity_type"]');
  await expect(chip).toBeVisible();
  await expect(chip).not.toHaveClass(/filter-chip--editing/);

  // Test 1: Click the chip content — should navigate to edit mode
  await chip.locator('.filter-chip-content').click();
  await page.waitForURL(/edit_filter=entity_type/);

  // Chip should be in editing state
  const editingChip = page.locator('.filter-chip[data-filter-edit-key="entity_type"]');
  await expect(editingChip).toHaveClass(/filter-chip--editing/);

  // Widget panel should be open
  await expect(widgetPanel).toBeVisible();

  // Results should be unfiltered (more or equal rows than when filtered)
  const unfilteredCount = await page.locator('table.entity-table tbody tr').count();
  expect(unfilteredCount).toBeGreaterThanOrEqual(filteredCount);

  // Cancel should restore the original filtered state
  await widgetPanel.locator('.filter-widget-cancel').click();
  await page.waitForURL(/mf__entity_type__eq=/);
  await expect(editingChip).not.toHaveClass(/filter-chip--editing/);

  // Test 2: Click the X button should remove the filter
  await chip.locator('.filter-chip-x').click();
  await page.waitForURL(/\/entities\/?$/);

  // Verify the chip is gone
  await expect(chip).not.toBeAttached();
});
