import { test, expect } from '@playwright/test';

const BASE_URL = 'http://localhost:3000';

test.describe('Sidebar Navigation', () => {
  test('Visit Overview page', async ({ page }) => {
    await page.goto(BASE_URL);
    await expect(page).toHaveTitle('Overview - Step Engine');
    await expect(page.locator('h1')).toHaveText('Overview');
  });

  test('Visit Team A page via sidebar', async ({ page }) => {
    await page.goto(BASE_URL);
    await page.getByRole('link', { name: 'Team A' }).click();
    await expect(page).toHaveTitle('Team A - Step Engine');
  });

  test('Visit Team B page via sidebar', async ({ page }) => {
    await page.goto(BASE_URL);
    await page.getByRole('link', { name: 'Team B' }).click();
    await expect(page).toHaveTitle('Team B - Step Engine');
  });

  test('Visit Team C page via sidebar', async ({ page }) => {
    await page.goto(BASE_URL);
    await page.getByRole('link', { name: 'Team C' }).click();
    await expect(page).toHaveTitle('Team C - Step Engine');
  });

  test('Visit Insights page via sidebar', async ({ page }) => {
    await page.goto(BASE_URL);
    await page.getByRole('link', { name: 'Insights' }).click();
    // Wait for URL to settle after trailing slash redirect
    await page.waitForURL('**/insight');
    await expect(page).toHaveTitle('Insights - Step Engine');
  });

  test('Visit Capabilities page via sidebar', async ({ page }) => {
    await page.goto(BASE_URL);
    await page.locator('nav.sidebar').getByRole('link', { name: 'Capabilities' }).click();
    await expect(page).toHaveTitle('Capabilities - Step Engine');
    await expect(page.locator('main.main-content > h1')).toHaveText('Capabilities');
  });

  test('Visit Practices page via sidebar', async ({ page }) => {
    await page.goto(BASE_URL);
    await page.getByRole('link', { name: 'Practices' }).click();
    await expect(page).toHaveTitle('Practices - Step Engine');
    await expect(page.locator('h1')).toHaveText('Practices');
  });
});

test.describe('Insights Page', () => {
  test('loads with expected controls', async ({ page }) => {
    // Navigate directly to avoid CDN-related load delays from sidebar click
    await page.goto(`${BASE_URL}/insight`, { waitUntil: 'domcontentloaded' });
    await expect(page).toHaveTitle('Insights - Step Engine');
    await expect(page.locator('h1')).toHaveText('Metrics Insights');

    // Verify the metric select dropdown exists
    await expect(page.locator('#metric-select')).toBeVisible();
    await expect(page.getByLabel('Select Metric:')).toBeVisible();

    // Verify date range inputs exist
    await expect(page.getByLabel('Start Date:')).toBeVisible();
    await expect(page.getByLabel('End Date:')).toBeVisible();

    // Verify initial chart message is shown
    await expect(page.locator('#chart-message')).toContainText('Select a metric');
  });
});

test.describe('Capabilities Catalog', () => {
  test('displays capability tiles', async ({ page }) => {
    await page.goto(`${BASE_URL}/catalog/capability`);
    await expect(page).toHaveTitle('Capabilities - Step Engine');

    // Verify tiles are rendered
    const tiles = page.locator('.capability-tile');
    await expect(tiles.first()).toBeVisible();
    expect(await tiles.count()).toBeGreaterThan(0);
  });

  test('navigate to Code Maintainability detail page', async ({ page }) => {
    await page.goto(`${BASE_URL}/catalog/capability`);
    await page.getByRole('link', { name: 'Code Maintainability' }).click();
    await expect(page).toHaveTitle('Code Maintainability - Step Engine');
    await expect(page.locator('.capability-page-header h1')).toHaveText('Code Maintainability');

    // Verify detail page content
    await expect(page.locator('.capability-score-large')).toBeVisible();
    await expect(page.locator('.capability-actions')).toBeVisible();
  });

  test('navigate to Test Automation detail page', async ({ page }) => {
    await page.goto(`${BASE_URL}/catalog/capability`);
    await page.getByRole('link', { name: 'Test Automation' }).click();
    await expect(page).toHaveTitle('Test Automation - Step Engine');
    await expect(page.locator('.capability-page-header h1')).toHaveText('Test Automation');
  });

  test('navigate to Continuous Integration detail page', async ({ page }) => {
    await page.goto(`${BASE_URL}/catalog/capability`);
    await page.getByRole('link', { name: 'Continuous Integration' }).click();
    await expect(page).toHaveTitle('Continuous Integration - Step Engine');
    await expect(page.locator('.capability-page-header h1')).toHaveText('Continuous Integration');
  });

  test('capability detail page has back navigation links', async ({ page }) => {
    await page.goto(`${BASE_URL}/catalog/capability/code-maintainability`);
    await expect(page).toHaveTitle('Code Maintainability - Step Engine');

    // Verify "Back to Overview" link
    const backLink = page.getByRole('link', { name: /Back to Overview/ });
    await expect(backLink).toBeVisible();

    // Verify "View All Capabilities" link
    const allCapabilitiesLink = page
      .locator('.capability-actions')
      .getByRole('link', { name: 'View All Capabilities' });
    await expect(allCapabilitiesLink).toBeVisible();

    // Click "View All Capabilities" and verify navigation
    await allCapabilitiesLink.click();
    await expect(page).toHaveTitle('Capabilities - Step Engine');
  });
});

test.describe('Practices Catalog', () => {
  test('displays practice list', async ({ page }) => {
    await page.goto(`${BASE_URL}/catalog/practice`);
    await expect(page).toHaveTitle('Practices - Step Engine');

    // Verify practices are listed
    const practiceItems = page.locator('.practice-list-item');
    await expect(practiceItems.first()).toBeVisible();
    expect(await practiceItems.count()).toBeGreaterThan(0);
  });

  test('navigate to Implement TDD detail page', async ({ page }) => {
    await page.goto(`${BASE_URL}/catalog/practice`);
    await page.getByRole('link', { name: 'Implement TDD' }).click();
    await expect(page).toHaveTitle('Implement TDD - Step Engine');
    await expect(page.locator('main.main-content > h1')).toHaveText('Implement TDD');

    // Verify practice detail content
    await expect(page.locator('.practice-content')).toBeVisible();
    await expect(page.locator('.practice-actions')).toBeVisible();
  });

  test('navigate to Conduct Code Reviews detail page', async ({ page }) => {
    await page.goto(`${BASE_URL}/catalog/practice`);
    await page.getByRole('link', { name: 'Conduct Code Reviews' }).click();
    await expect(page).toHaveTitle('Conduct Code Reviews - Step Engine');
    await expect(page.locator('main.main-content > h1')).toHaveText('Conduct Code Reviews');
  });

  test('navigate to Refactor detail page', async ({ page }) => {
    await page.goto(`${BASE_URL}/catalog/practice`);
    await page.locator('a[href="/catalog/practice/refactor/"]').click();
    await expect(page).toHaveTitle('Refactor - Step Engine');
    await expect(page.locator('main.main-content > h1')).toHaveText('Refactor');
  });

  test('practice detail page has back navigation links', async ({ page }) => {
    await page.goto(`${BASE_URL}/catalog/practice/implement-tdd`);
    await expect(page).toHaveTitle('Implement TDD - Step Engine');

    // Verify "Back to Overview" link
    const backLink = page.getByRole('link', { name: /Back to Overview/ });
    await expect(backLink).toBeVisible();

    // Verify "View All Practices" link
    const allPracticesLink = page.getByRole('link', { name: 'View All Practices' });
    await expect(allPracticesLink).toBeVisible();

    // Click "View All Practices" and verify navigation
    await allPracticesLink.click();
    await expect(page).toHaveTitle('Practices - Step Engine');
  });
});
