import { test, expect } from '@playwright/test';

const HOME_ROUTE = 'localhost:3000'
const TEAM_A = 'Team A'
const TEAM_B = 'Team B'
const TEAM_C = 'Team C'

const TEAMS = [TEAM_A, TEAM_B, TEAM_C]

test('Visit Overview', async ({ page }) => {
  await page.goto(HOME_ROUTE);
  await expect(page).toHaveTitle(/Overview - Step Engine/);
});

test('Visit Team Pages', async ({ page }) => {
  await page.goto(HOME_ROUTE);
  page.getByRole('link', { name: TEAM_A }).click()
  await expect(page).toHaveTitle(`${TEAM_A} - Step Engine`);
  page.getByRole('link', { name: TEAM_B }).click()
  await expect(page).toHaveTitle(`${TEAM_B} - Step Engine`);
  page.getByRole('link', { name: TEAM_C }).click()
  await expect(page).toHaveTitle(`${TEAM_C} - Step Engine`);
});

test('Visit Insights Page', async ({ page }) => {
  await page.goto(HOME_ROUTE);
  page.getByRole('link', { name: "Insights" }).click()
  await expect(page).toHaveTitle(`Insights - Step Engine`);
});

