import { test, expect } from '@playwright/test';

test.describe('Cart-to-Purchase Prediction Dashboard', () => {
  
  test.beforeEach(async ({ page }) => {
    await page.goto('http://localhost:5173');
  });

  test('should load main page without errors', async ({ page }) => {
    await expect(page.getByRole('heading', { name: /Cart-to-Purchase Prediction/i })).toBeVisible();
    await expect(page.getByText('Total Predictions')).toBeVisible();
    await expect(page.getByText('Success Rate')).toBeVisible();
    await expect(page.getByText('Models Active')).toBeVisible();
    await expect(page.getByText('Recent (5m)')).toBeVisible();
    await expect(page.getByRole('button', { name: /Raw Features/i })).toBeVisible();
    await expect(page.getByRole('button', { name: /Batch CSV/i })).toBeVisible();
    await expect(page.getByRole('button', { name: /Feast Lookup/i })).toBeVisible();
  });

  test('should switch between tabs', async ({ page }) => {
    await expect(page.getByText('Raw Features Prediction')).toBeVisible();
    await page.getByRole('button', { name: /Batch CSV/i }).click();
    await expect(page.getByText('Batch CSV Prediction')).toBeVisible();
    await page.getByRole('button', { name: /Feast Lookup/i }).click();
    await expect(page.getByText('Feast Lookup Prediction', { exact: true })).toBeVisible();
  });

  test('should display API status indicator', async ({ page }) => {
    await expect(page.getByText('Connected')).toBeVisible();
  });

  test('should show footer', async ({ page }) => {
    await expect(page.getByText('Cart-to-Purchase Conversion Prediction System')).toBeVisible();
    await expect(page.getByText('v1.0.0')).toBeVisible();
  });

  test('should have no critical console errors', async ({ page }) => {
    const errors: string[] = [];
    page.on('console', msg => {
      if (msg.type() === 'error') {
        errors.push(msg.text());
      }
    });
    
    await page.reload();
    await page.waitForLoadState('networkidle');
    
    const criticalErrors = errors.filter(e => 
      !e.includes('favicon') && 
      !e.includes('button') &&
      !e.includes('descendant') &&
      !e.includes('Failed to fetch') &&
      !e.includes('ERR_CONNECTION_REFUSED') &&
      !e.includes('stats')
    );
    expect(criticalErrors).toHaveLength(0);
  });
});

test.describe('Raw Features Form', () => {
  
  test.beforeEach(async ({ page }) => {
    await page.goto('http://localhost:5173');
  });

  test('should display form fields', async ({ page }) => {
    await expect(page.getByText('Raw Features Prediction')).toBeVisible();
    await expect(page.getByRole('button', { name: /Event/ })).toBeVisible();
    await expect(page.getByRole('button', { name: /User/ })).toBeVisible();
  });

  test('should have predict button', async ({ page }) => {
    await expect(page.locator('form').getByRole('button', { name: 'Predict' })).toBeVisible();
  });
});
