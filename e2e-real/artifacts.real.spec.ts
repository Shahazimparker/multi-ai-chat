import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import { login, openSidebarSection, requireRealUser, waitForAssistantMessage } from './support/realHelpers';

let context: BrowserContext;
let page: Page;

test.describe.serial('real artifacts', () => {
  test.beforeAll(async ({ browser }) => {
    requireRealUser();
    context = await browser.newContext();
    page = await context.newPage();
    await login(page);
    await expect(page).toHaveURL(/\/(chat|admin)$/);
    if (/\/admin$/.test(page.url())) {
      await page.goto('/chat');
    }
    await expect(page).toHaveURL(/\/chat$/);
  });

  test.afterAll(async () => {
    await context?.close();
  });

  test.beforeEach(async () => {
    await page.goto('/chat');
    await expect(page).toHaveURL(/\/chat$/);
  });

  test('uploads a real text file and receives a non-error assistant response', async () => {
    await page.getByTitle('Attach files').click();
    await page.locator('#file-input').setInputFiles({
      name: 'playwright-real-upload.txt',
      mimeType: 'text/plain',
      buffer: Buffer.from('This file was uploaded by real Playwright E2E.'),
    });

    await expect(page.locator('.pending-file-tag')).toContainText('playwright-real-upload.txt');
    await page.getByPlaceholder('Ask me anything').fill('Summarize the uploaded file in one line.');
    await page.locator('.send-btn').click();
    await waitForAssistantMessage(page);
    await expect(page.locator('.message-row.assistant').first()).not.toContainText(/^❌ Error:/);
  });

  test('artifacts sidebar opens and search input is usable', async () => {
    await openSidebarSection(page, 'Artifacts');
    const search = page.getByPlaceholder('Search docs...');
    await expect(search).toBeVisible();
    await search.fill('ppt');
    await expect(search).toHaveValue('ppt');
  });
});
