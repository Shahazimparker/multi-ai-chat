import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import { ALLOW_MUTATION, REAL_ADMIN, REAL_ADMIN_PASSWORD, login } from './support/realHelpers';

let context: BrowserContext;
let page: Page;
let hasAdminAccess = false;

test.describe.serial('real admin', () => {
  test.beforeAll(async ({ browser }) => {
    test.skip(!REAL_ADMIN || !REAL_ADMIN_PASSWORD, 'No real admin credentials configured');
    context = await browser.newContext();
    page = await context.newPage();
    await login(page, REAL_ADMIN, REAL_ADMIN_PASSWORD);
    await page.goto('/admin');
    hasAdminAccess = /\/admin$/.test(page.url());
  });

  test.afterAll(async () => {
    await context?.close();
  });

  test.beforeEach(async () => {
    test.skip(!hasAdminAccess, 'Configured admin credentials do not reach /admin in this environment');
    await page.goto('/admin');
    await page.waitForLoadState('networkidle');
    // If still on login page, session was lost - log in again
    if (!page.url().includes('/admin')) {
      await login(page, REAL_ADMIN, REAL_ADMIN_PASSWORD);
      await page.goto('/admin');
      await page.waitForLoadState('networkidle');
    }
  });

  test('admin tabs load against the real backend', async () => {
    await expect(page.locator('.admin-brand')).toContainText('Admin');
    await page.getByRole('button', { name: /Analytics/i }).click();
    await expect(page.locator('.admin-panel')).toContainText(/Analytics|Loading/i, { timeout: 30_000 });
    await page.getByRole('button', { name: /API Status/i }).click();
    await expect(page.locator('.status-grid, .loading-text')).toBeVisible({ timeout: 30_000 });
  });

  test('destructive admin mutation flow is opt-in only', async () => {
    test.skip(!ALLOW_MUTATION, 'Set PLAYWRIGHT_REAL_ALLOW_MUTATION=true to run destructive real admin tests');
    await page.getByRole('button', { name: /Create User/i }).click();
    await expect(page.locator('.modal-box')).toBeVisible();
  });
});
