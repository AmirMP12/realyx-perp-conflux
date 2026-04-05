import { test, expect } from '@playwright/test';

test.describe('Realyx Portfolio & Vault Interface', () => {
  test('should load the Vault page and exhibit deposit mechanisms', async ({ page }) => {
    // Navigate straight to vault
    await page.goto('/vault');
    
    // Check that the title and navbar load
    await expect(page).toHaveTitle(/Realyx/i);
    
    const depositFormBtn = page.locator('button', { hasText: /Deposit/i });
    await expect(depositFormBtn.first()).toBeVisible();

    // Emulate clicking deposit (no wallet connected should popup a connect modaler or do nothing natively based on your layout)
    await depositFormBtn.first().click();
    
    // Check for native "Connect Wallet" or equivalent context requirement
    const connectModal = page.locator('text=Connect Wallet').first();
    await expect(connectModal).toBeVisible();
  });

  test('should load the Portfolio Dashboard', async ({ page }) => {
    await page.goto('/portfolio'); 
    
    // Assert user stats sections
    await expect(page.locator('text=Total Balance')).toBeVisible();
    await expect(page.locator('text=Active Positions')).toBeVisible();
    await expect(page.locator('text=History')).toBeVisible();
  });
  
  test('should load the Leaderboard Interface', async ({ page }) => {
    await page.goto('/leaderboard'); 
    
    // Check that ranks and logic grid are showing
    await expect(page.locator('text=Rank')).toBeVisible();
    await expect(page.locator('text=Trader')).toBeVisible();
    await expect(page.locator('text=PnL')).toBeVisible();
  });
});
