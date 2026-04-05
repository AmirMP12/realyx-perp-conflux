import { test, expect } from '@playwright/test';

test.describe('Realyx Trading Interface', () => {
  test('should load the homepage and display connect wallet button', async ({ page }) => {
    await page.goto('/');
    
    // Check that the title and navbar load
    await expect(page).toHaveTitle(/Realyx/i);
    const connectBtn = page.locator('button', { hasText: /Connect Wallet/i });
    await expect(connectBtn).toBeVisible();
  });

  test('should toggle to short side on the trading form', async ({ page }) => {
    await page.goto('/trade/0x0000000000000000000000000000000000000001'); // Mock market
    
    const shortBtn = page.locator('button', { hasText: 'Short' }).first();
    await shortBtn.click();
    
    // Verify Short is active (e.g. by checking class or checking if text changed to Short [Asset])
    await expect(shortBtn).toHaveClass(/bg-red-500|text-white/);
  });
  
  test('should display market stats correctly', async ({ page }) => {
    await page.goto('/trade/0x0000000000000000000000000000000000000001'); // Mock market
    
    // Check data points like Funding, 24h Vol
    await expect(page.locator('text=24h Vol')).toBeVisible();
    await expect(page.locator('text=Funding')).toBeVisible();
  });
});
