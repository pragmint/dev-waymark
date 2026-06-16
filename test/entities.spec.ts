import { test, expect } from '@playwright/test';

test('redirects root to /entities', async ({ page }) => {
  await page.goto('/');
  // Entities page always has an entity_type filter selected (handler redirects
  // to the first available type when none is given).
  await expect(page).toHaveURL(/\/entities(\?|$)/);
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
  await page.goto('/entities?mf__entity_type__eq=jira_ticket');
  const firstLink = page.locator('table.entity-table a.entity-link').first();
  await firstLink.click();
  await expect(page.locator('h2')).toHaveText('Metadata');
  await expect(page.locator('.back-link')).toBeVisible();
});

test('unknown entity id returns 404', async ({ page }) => {
  const response = await page.goto('/entities/does-not-exist');
  expect(response?.status()).toBe(404);
});

test('filter chip: click to edit, cancel, then × to remove', async ({ page }) => {
  // Apply a ticket_type=Story filter directly via URL so this test doesn't
  // depend on widget UI for setup.
  await page.goto('/entities?mf__entity_type__eq=jira_ticket&mf__ticket_type__eq=Story');

  const chip = page.locator('.filter-chip[data-filter-edit-key="ticket_type"]');
  await expect(chip).toBeVisible();
  await expect(chip).not.toHaveClass(/filter-chip--editing/);

  // Click chip content → enters edit mode.
  await chip.locator('.filter-chip-content').click();
  await page.waitForURL(/edit_filter=ticket_type/);
  await expect(chip).toHaveClass(/filter-chip--editing/);

  const widgetPanel = page.locator('.filter-widget-panel[data-filter-key="ticket_type"]');
  await expect(widgetPanel).toBeVisible();

  // Cancel returns to the filtered view.
  await widgetPanel.locator('.filter-widget-cancel').click();
  await page.waitForURL(/mf__ticket_type__eq=Story/);
  await expect(chip).not.toHaveClass(/filter-chip--editing/);

  // × removes the filter.
  await chip.locator('.filter-chip-x').click();
  await expect(page).not.toHaveURL(/mf__ticket_type__eq/);
  await expect(chip).not.toBeAttached();
});

test('editing a date filter prefills the date pickers with saved values', async ({ page }) => {
  // Seed has jira_created_at as a date field on jira_ticket entities.
  await page.goto(
    '/entities?mf__entity_type__eq=jira_ticket' +
      '&mf__jira_created_at__gte=2024-01-05' +
      '&mf__jira_created_at__lte=2024-01-15'
  );

  const chip = page.locator('.filter-chip[data-filter-edit-key="jira_created_at"]');
  await expect(chip).toBeVisible();

  // Click chip → edit mode opens the date panel.
  await chip.locator('.filter-chip-content').click();
  await page.waitForURL(/edit_filter=jira_created_at/);

  const panel = page.locator('.filter-widget-panel[data-filter-key="jira_created_at"]');
  await expect(panel).toBeVisible();

  // Both date inputs come back prefilled with the values from the URL.
  await expect(panel.locator(`input[name="mf__jira_created_at__gte"]`)).toHaveValue('2024-01-05');
  await expect(panel.locator(`input[name="mf__jira_created_at__lte"]`)).toHaveValue('2024-01-15');
});

test('editing a multi-select chip preselects the saved values', async ({ page }) => {
  await page.goto(
    '/entities?mf__entity_type__eq=jira_ticket' +
      '&mf__ticket_type__eq=Story' +
      '&mf__ticket_type__eq=Bug'
  );

  const chip = page.locator('.filter-chip[data-filter-edit-key="ticket_type"]');
  await chip.locator('.filter-chip-content').click();
  await page.waitForURL(/edit_filter=ticket_type/);

  const panel = page.locator('.filter-widget-panel[data-filter-key="ticket_type"]');
  const selected = await panel.locator('select[multiple] option:checked').allTextContents();
  expect(selected.sort()).toEqual(['Bug', 'Story']);
});

test('editing a regex filter prefills the regex input and opens that mode', async ({ page }) => {
  await page.goto('/entities?mf__entity_type__eq=jira_ticket&mf__ticket_type__re=Story%7CBug');

  const chip = page.locator('.filter-chip[data-filter-edit-key="ticket_type"]');
  await chip.locator('.filter-chip-content').click();
  await page.waitForURL(/edit_filter=ticket_type/);

  const panel = page.locator('.filter-widget-panel[data-filter-key="ticket_type"]');
  // Regex mode is active server-side because the saved op is `re`.
  await expect(panel.locator('[data-active-mode]')).toHaveAttribute('data-active-mode', 'regex');
  await expect(panel.locator(`input[name="mf__ticket_type__re"]`)).toHaveValue('Story|Bug');
});
