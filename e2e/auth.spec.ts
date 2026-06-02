import { expect, test } from '@playwright/test';
import { installMockApi, loginAs } from './support/mockApi';

test('redirects protected routes to login when unauthenticated', async ({ page }) => {
  await installMockApi(page);
  await page.goto('/chat');
  await expect(page).toHaveURL(/\/login$/);
});

test('shows login error for invalid credentials', async ({ page }) => {
  await installMockApi(page);
  await page.goto('/login');
  await page.getByPlaceholder('Username or Email').fill('user');
  await page.getByPlaceholder('Password').fill('wrong-password');
  await page.getByRole('button', { name: 'Sign In' }).click();
  await expect(page.locator('.login-error')).toContainText('Invalid credentials');
});

test('logs in as user and logs out back to login', async ({ page }) => {
  await installMockApi(page);
  await loginAs(page, 'user');
  await expect(page).toHaveURL(/\/chat$/);
  await expect(page.locator('.sidebar-footer')).toContainText('user');
  await page.locator('.sidebar-footer .logout-btn').click();
  await expect(page).toHaveURL(/\/login$/);
});

test('logs in as admin and lands on admin page', async ({ page }) => {
  await installMockApi(page);
  await loginAs(page, 'admin');
  await expect(page).toHaveURL(/\/admin$/);
  await expect(page.locator('.admin-brand')).toContainText('Admin');
});
