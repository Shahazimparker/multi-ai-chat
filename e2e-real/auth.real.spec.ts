import { expect, test } from '@playwright/test';
import { REAL_ADMIN, REAL_ADMIN_PASSWORD, REAL_USER, REAL_PASSWORD, login, requireRealUser } from './support/realHelpers';

test.beforeEach(() => {
  requireRealUser();
});

test('redirects unauthenticated users to login', async ({ page }) => {
  await page.goto('/chat');
  await expect(page).toHaveURL(/\/login$/);
});

test('logs in as configured real user and can log out', async ({ page }) => {
  await login(page, REAL_USER, REAL_PASSWORD);
  await expect(page).toHaveURL(/\/(chat|admin)$/);

  if (page.url().includes('/chat')) {
    await expect(page.locator('.sidebar-footer')).toContainText(REAL_USER);
    await page.locator('.sidebar-footer .logout-btn').click();
  } else {
    await page.getByRole('button', { name: /Logout/i }).last().click();
  }

  await expect(page).toHaveURL(/\/login$/);
});

test('configured admin user can reach admin page', async ({ page }) => {
  test.skip(!REAL_ADMIN || !REAL_ADMIN_PASSWORD, 'No real admin credentials configured');
  await login(page, REAL_ADMIN, REAL_ADMIN_PASSWORD);
  await page.goto('/admin', { waitUntil: 'networkidle' });
  // Reaching /admin *is* the assertion of this test — a redirect away means the
  // admin role is broken, which must fail rather than skip.
  await expect(page).toHaveURL(/\/admin$/);
  await expect(page.locator('.admin-brand')).toContainText('Admin');
});
