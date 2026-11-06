import { test, expect } from './strictTest';
import { LINEAGE_FIXTURE } from '../src/db/source/lineageFixture';

// Serves a small pipeline run through the DuckDB adapter instead of the e2e seed.
test.use({ sourceFixture: 'lineage' });

test('clicks from an entity through a derived row to the raw Jira issue', async ({ page }) => {
  const [ticketId] = LINEAGE_FIXTURE.ticketIds;
  const [jiraDltId] = LINEAGE_FIXTURE.jiraDltIds;

  await page.goto(`/entities/${ticketId}`);
  await page.getByRole('link', { name: 'Trace lineage' }).click();
  await expect(page.locator('h1')).toContainText('entities');

  // entities row → the tickets row it was built from.
  await page.locator('[data-lineage-group="tickets"] a.entity-link', { hasText: ticketId }).click();
  await expect(page.locator('h1')).toContainText(`tickets ${ticketId}`);

  // tickets row → the raw Jira record. Its dlt id holds `+` and `/`.
  const rawGroup = page.locator('[data-lineage-group="raw.jira_issues"]');
  await expect(rawGroup.locator('.badge')).toHaveText('raw');
  await rawGroup.locator('a.entity-link', { hasText: jiraDltId }).click();
  await expect(page.locator('h1')).toContainText(`raw.jira_issues ${jiraDltId}`);
  await expect(page.locator('.badge', { hasText: 'raw record' })).toBeVisible();

  const record = JSON.parse((await page.locator('[data-raw-record]').textContent()) ?? '{}');
  expect(record.key).toBe('DEMO-1');
  expect(record.fields.summary).toBe('Fix the thing');
});

test('expands an aggregate to every raw record behind it', async ({ page }) => {
  await page.goto(`/lineage/lead_time_by_issue_type/${LINEAGE_FIXTURE.leadTimeId}`);
  await expect(page.locator('[data-lineage-group="tickets"] .count')).toHaveText('2 rows');

  await page.getByRole('link', { name: 'Expand to raw' }).click();
  await expect(page.locator('h1')).toHaveText('Raw records');
  await expect(page.locator('.lineage-hop-list li')).toHaveCount(3);

  const jira = page.locator('[data-lineage-group="raw.jira_issues"] tbody tr');
  await expect(jira).toHaveCount(2);
  await expect(page.locator('[data-lineage-group="raw.github_pulls"] tbody tr')).toHaveCount(1);
});

test('returns 404 for an unknown table or row', async ({ page }) => {
  expect((await page.goto('/lineage/nope/1'))?.status()).toBe(404);
  expect((await page.goto('/lineage/tickets/404'))?.status()).toBe(404);
  expect((await page.goto('/lineage/tickets/not-a-number'))?.status()).toBe(404);
});
