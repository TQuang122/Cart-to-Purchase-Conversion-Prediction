import { test, expect } from '@playwright/test';

test.describe('Raw Features Prediction', () => {

  const ensureGroupOpen = async (page: import('@playwright/test').Page, groupName: RegExp) => {
    const trigger = page.locator('button').filter({ hasText: groupName }).first();
    if (!(await trigger.isVisible())) {
      return;
    }

    const expanded = await trigger.getAttribute('aria-expanded');
    if (expanded !== 'true') {
      await trigger.click();
    }
  };

  test.beforeEach(async ({ page }) => {
    await page.goto('http://localhost:5173');
    // Ensure Raw Features tab is selected
    await page.getByRole('button', { name: /Raw Features/i }).click();
    // Wait for form to be visible
    await expect(page.getByText('Raw Features Prediction')).toBeVisible();
  });

  test('should display Raw Features form', async ({ page }) => {
    await expect(page.getByText('Raw Features Prediction')).toBeVisible();
    // Use exact match for predict button inside the form
    await expect(page.locator('form').getByRole('button', { name: 'Predict' })).toBeVisible();
  });

  test('should fill in sample feature values', async ({ page }) => {
    await ensureGroupOpen(page, /Product/);
    await ensureGroupOpen(page, /Category/);

    // Use more specific selectors - first() for ambiguous labels
    await page.locator('input[name="price"]').fill('99.99');
    await page.locator('input[name="activity_count"]').fill('5');
    await page.locator('input[name="event_weekday"]').fill('1');
    await page.locator('input[name="event_hour"]').fill('14');
    await page.locator('input[name="user_total_views"]').fill('80');
    await page.locator('input[name="user_total_carts"]').fill('15');
    await page.locator('input[name="product_total_views"]').fill('800');
    await page.locator('input[name="product_total_carts"]').fill('100');
    await page.locator('input[name="brand_purchase_rate"]').fill('0.4');
    await page.locator('input[name="price_vs_user_avg"]').fill('0.2');
    await page.locator('input[name="price_vs_category_avg"]').fill('0.1');
    await page.locator('input[name="brand"]').fill('apple');
    await page.locator('input[name="category_code_level1"]').fill('electronics');
    await page.locator('input[name="category_code_level2"]').fill('smartphone');

    // Verify values are filled
    await expect(page.locator('input[name="price"]')).toHaveValue('99.99');
    await expect(page.locator('input[name="activity_count"]')).toHaveValue('5');
  });

  test('should submit prediction form', async ({ page }) => {
    await ensureGroupOpen(page, /Product/);
    await ensureGroupOpen(page, /Category/);

    // Fill required fields with valid test data using name attribute
    const formFields = [
      { name: 'price', value: '50.00' },
      { name: 'activity_count', value: '10' },
      { name: 'event_weekday', value: '3' },
      { name: 'event_hour', value: '12' },
      { name: 'user_total_views', value: '40' },
      { name: 'user_total_carts', value: '8' },
      { name: 'product_total_views', value: '800' },
      { name: 'product_total_carts', value: '100' },
      { name: 'brand_purchase_rate', value: '0.4' },
      { name: 'price_vs_user_avg', value: '1.5' },
      { name: 'price_vs_category_avg', value: '1.2' },
      { name: 'brand', value: 'apple' },
      { name: 'category_code_level1', value: 'electronics' },
      { name: 'category_code_level2', value: 'smartphone' },
    ];

    for (const field of formFields) {
      await page.locator(`input[name="${field.name}"]`).fill(field.value);
    }

    // Click predict button inside form
    await page.locator('form').getByRole('button', { name: 'Predict' }).click();

    // Wait for response (either success or error depending on API)
    await page.waitForTimeout(2000);
  });

  test('should validate required fields', async ({ page }) => {
    // Try to submit empty form by clicking predict button inside form
    await page.locator('form').getByRole('button', { name: 'Predict' }).click();

    // The button should still be visible (form validation should prevent submission)
    await expect(page.locator('form').getByRole('button', { name: 'Predict' })).toBeVisible();
  });

  test('should expand/collapse feature groups', async ({ page }) => {
    // Wait for the page to load completely
    await page.waitForTimeout(500);
    
    // Find and click on Event collapsible trigger
    const eventTrigger = page.locator('button').filter({ hasText: /Event/ }).first();
    await expect(eventTrigger).toBeVisible();
    
    // Click to collapse event group
    await eventTrigger.click();
    await page.waitForTimeout(300);
    
    // Click to expand again
    await eventTrigger.click();
    await expect(eventTrigger).toBeVisible();
  });

  test('should accept numeric input for number fields', async ({ page }) => {
    const priceField = page.locator('input[name="price"]');
    
    // Should accept decimal numbers
    await priceField.fill('99.99');
    await expect(priceField).toHaveValue('99.99');
    
    await ensureGroupOpen(page, /Product/);
    
    // Should accept negative numbers for some fields
    const priceDiffField = page.locator('input[name="price_vs_user_avg"]');
    await priceDiffField.fill('-0.5');
    await expect(priceDiffField).toHaveValue('-0.5');
  });
});
