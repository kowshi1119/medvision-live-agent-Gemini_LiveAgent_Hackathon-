import { test, expect } from '@playwright/test';

/**
 * MedVision E2E smoke tests.
 * These run against the dev server (port 3000).
 * To run: npx playwright test
 */

const BASE_URL = process.env.PLAYWRIGHT_BASE_URL ?? 'http://localhost:3000';

test.describe('MedVision UI', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(BASE_URL);
  });

  test('page title is MedVision — Emergency AI', async ({ page }) => {
    await expect(page).toHaveTitle(/MedVision.*Emergency AI/i);
  });

  test('header shows MEDVISION brand text', async ({ page }) => {
    await expect(page.getByText('MEDVISION')).toBeVisible();
  });

  test('START SESSION button is visible and enabled before connect', async ({ page }) => {
    const btn = page.getByRole('button', { name: /start session/i });
    await expect(btn).toBeVisible();
    await expect(btn).toBeEnabled();
  });

  test('StatusBar is visible at bottom of page', async ({ page }) => {
    const bar = page.getByRole('status');
    await expect(bar).toBeVisible();
    await expect(bar).toContainText('WS:');
  });

  test('triage panel shows empty-state placeholder', async ({ page }) => {
    await expect(page.getByText(/Triage cards will appear here/i)).toBeVisible();
  });

  test('session log panel is present', async ({ page }) => {
    const logEl = page.locator('[role="log"]');
    await expect(logEl).toBeVisible();
  });

  test('Escape key does not throw when not connected', async ({ page }) => {
    let consoleErrors: string[] = [];
    page.on('console', msg => {
      if (msg.type() === 'error') consoleErrors.push(msg.text());
    });
    await page.keyboard.press('Escape');
    // Allow a tick
    await page.waitForTimeout(100);
    // No uncaught JS errors should appear from pressing Escape disconnected
    const jsErrors = consoleErrors.filter(e => !e.includes('favicon'));
    expect(jsErrors).toHaveLength(0);
  });

  test('language selector is present and has English default', async ({ page }) => {
    const sel = page.getByRole('combobox', { name: /language/i });
    await expect(sel).toBeVisible();
    await expect(sel).toHaveValue('en');
  });

  test('download report button is present', async ({ page }) => {
    const btn = page.getByRole('button', { name: /download report/i });
    await expect(btn).toBeVisible();
  });
});
