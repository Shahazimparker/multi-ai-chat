// Rule for this suite: `test.skip` may only gate on *configuration* the runner
// cannot supply — missing credentials, or the explicit destructive-test opt-in.
// It must never gate on application behaviour (e.g. "the approval prompt did not
// appear"), because that turns the exact defect the test exists to catch into a
// green run. Assert behaviour; skip only on environment.
import fs from 'node:fs';
import path from 'node:path';
import { expect, type Browser, type Page } from '@playwright/test';

export const REAL_USER = process.env.REAL_TEST_USERNAME || process.env.TEST_USERNAME || '';
export const REAL_PASSWORD = process.env.REAL_TEST_PASSWORD || process.env.TEST_PASSWORD || '';
export const REAL_ADMIN = process.env.REAL_TEST_ADMIN_USERNAME || process.env.ADMIN_TEST_USERNAME || REAL_USER;
export const REAL_ADMIN_PASSWORD = process.env.REAL_TEST_ADMIN_PASSWORD || process.env.ADMIN_TEST_PASSWORD || REAL_PASSWORD;
export const ALLOW_MUTATION = String(process.env.PLAYWRIGHT_REAL_ALLOW_MUTATION || '').toLowerCase() === 'true';

export const requireRealUser = () => {
  if (!REAL_USER || !REAL_PASSWORD) {
    throw new Error('Set REAL_TEST_USERNAME/REAL_TEST_PASSWORD or TEST_USERNAME/TEST_PASSWORD for real Playwright E2E.');
  }
};

export async function login(page: Page, username = REAL_USER, password = REAL_PASSWORD) {
  requireRealUser();
  await page.goto('/login');
  await page.getByPlaceholder('Username or Email').fill(username);
  await page.getByPlaceholder('Password').fill(password);
  await page.getByRole('button', { name: 'Sign In' }).click();
  // Wait for auth to complete and redirect away from login
  await page.waitForURL(/\/(chat|admin|login)$/, { timeout: 15000 });
}

export async function createStorageState(browser: Browser, fileName: string, username = REAL_USER, password = REAL_PASSWORD) {
  requireRealUser();
  const dir = path.join(process.cwd(), 'test-results', '.auth');
  fs.mkdirSync(dir, { recursive: true });
  const filePath = path.join(dir, fileName);
  const page = await browser.newPage();
  await login(page, username, password);
  await page.context().storageState({ path: filePath });
  await page.close();
  return filePath;
}

export async function expectDefaultModelSelected(page: Page) {
  // The code default is mistral-medium (ModelSelector.jsx). Assert it exactly —
  // an alternation here would also pass if the default regressed to another model.
  await expect(page.locator('.model-trigger')).toContainText('Mistral Medium');
}

export async function waitForAssistantMessage(page: Page) {
  await expect(page.locator('.message-row.assistant').first()).toBeVisible({ timeout: 60_000 });
  await expect(page.locator('.message-row.assistant').first().locator('.cursor')).toHaveCount(0, { timeout: 120_000 });
}

export async function openSidebarSection(page: Page, label: 'Chats' | 'Artifacts') {
  await page.locator('.sidebar .sidebar-section-label.collapsible').filter({ hasText: label }).click();
}
