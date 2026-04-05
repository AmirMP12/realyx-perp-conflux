import { test, expect } from '@playwright/test';

test.describe('Realyx App', () => {
  test('loads markets page', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('heading', { name: /markets/i })).toBeVisible({ timeout: 10000 });
  });

  test('navigates to trade page', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('link', { name: /trade/i }).first().click();
    await expect(page).toHaveURL(/\/trade/);
  });

  test('navigates to portfolio page', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('link', { name: /portfolio/i }).first().click();
    await expect(page).toHaveURL(/\/portfolio/);
  });

  test('shows connect wallet when not connected', async ({ page }) => {
    await page.goto('/portfolio');
    await expect(page.getByRole('heading', { name: /connect/i })).toBeVisible({ timeout: 10000 });
  });

  test('supports referral URL param', async ({ page }) => {
    await page.goto('/?ref=ABCDEF');
    await expect(page).toHaveURL('/');
  });
});
