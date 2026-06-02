import { expect, test } from '@playwright/test';
import { installMockApi, loginAs } from './support/mockApi';

const adminUser = {
  id: 'admin-1',
  username: 'admin',
  email: 'admin@example.com',
  role: 'admin' as const,
  total_tokens: 100000,
  used_tokens: 1500,
  per_query_limit: 2000,
  session_minutes: 60,
  expires_at: null,
  is_active: true,
};

const managedUsers = [
  {
    id: 'user-1',
    username: 'alice',
    email: 'alice@example.com',
    role: 'user' as const,
    total_tokens: 100000,
    used_tokens: 350,
    per_query_limit: 2000,
    session_minutes: 60,
    expires_at: null,
    is_active: true,
    is_login_locked: false,
  },
];

test('loads admin tabs and analytics', async ({ page }) => {
  await installMockApi(page, {
    loggedInUser: adminUser,
    users: [...managedUsers],
  });

  await page.goto('/admin');
  await expect(page.locator('.admin-brand')).toContainText('Admin');
  await page.getByRole('button', { name: /Analytics/i }).click();
  await expect(page.locator('.admin-panel')).toContainText('Analytics');
  await expect(page.locator('.stat-card')).toHaveCount(4);
  await page.getByRole('button', { name: /API Status/i }).click();
  await expect(page.locator('.status-card')).toHaveCount(3);
});

test('creates a user from admin', async ({ page }) => {
  await installMockApi(page, {
    loggedInUser: adminUser,
    users: [...managedUsers],
  });

  await page.goto('/admin');
  await page.getByRole('button', { name: /Create User/i }).click();
  await page.getByLabel('Username *').fill('newuser');
  await page.getByLabel('Email *').fill('newuser@example.com');
  await page.getByLabel('Password *').fill('password123');
  await page.getByRole('button', { name: /Create User/i }).last().click();
  await expect(page.locator('.admin-table')).toContainText('newuser');
});

test('edits and manages an existing user', async ({ page }) => {
  await installMockApi(page, {
    loggedInUser: adminUser,
    users: [...managedUsers],
  });

  page.on('dialog', async (dialog) => dialog.accept());

  await page.goto('/admin');
  await page.getByTitle('Edit').click();
  await page.getByLabel('Username *').fill('alice-updated');
  await page.getByRole('button', { name: /Save Changes/i }).click();
  await expect(page.locator('.admin-table')).toContainText('alice-updated');

  const userRow = page.locator('.admin-table tbody tr').first();
  await userRow.locator('button[title="Lock Login"]').click();
  await expect(page.locator('.admin-table')).toContainText('Locked');

  await userRow.locator('button[title="Unlock Login"]').click();
  await expect(page.locator('.admin-table')).not.toContainText('Locked');

  await userRow.locator('button[title="Reset Tokens"]').click();
  await expect(page.locator('.admin-table')).toContainText('0');
});

test('deletes a user from admin', async ({ page }) => {
  await installMockApi(page, {
    loggedInUser: adminUser,
    users: [...managedUsers],
  });

  page.on('dialog', async (dialog) => dialog.accept());

  await page.goto('/admin');
  await expect(page.locator('.admin-table')).toContainText('alice');
  await page.getByTitle('Delete').click();
  await expect(page.locator('.admin-table')).not.toContainText('alice');
});
