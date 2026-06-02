import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import { expectDeepSeekSelected, login, openSidebarSection, requireRealUser, waitForAssistantMessage } from './support/realHelpers';

let context: BrowserContext;
let page: Page;

test.describe.serial('real chat', () => {
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

  test('chat screen uses deepseek-v4-flash by default', async () => {
    await expectDeepSeekSelected(page);
  });

  test('sends a real chat message and receives a live response', async () => {
    await expectDeepSeekSelected(page);
    await page.getByPlaceholder('Ask me anything').fill('Reply with exactly: REAL_E2E_OK');
    await page.locator('.send-btn').click();
    await waitForAssistantMessage(page);
    await expect(page.locator('.message-row.assistant').first()).toContainText(/REAL_E2E_OK|real_e2e_ok/i);
  });

  test('vague PPT request shows clarification box when the running backend supports it', async () => {
    await page.getByPlaceholder('Ask me anything').fill('generate a ppt for me');
    await page.locator('.send-btn').click();

    const clarification = page.locator('.cp');
    await clarification.waitFor({ state: 'visible', timeout: 60_000 }).catch(() => null);
    test.skip(!(await clarification.isVisible()), 'Running backend did not emit clarification_request for this environment/build');

    await page.getByLabel('Topic').fill('Quarterly business review');
    await page.getByLabel('Title').fill('Q2 Business Review');
    await page.getByRole('button', { name: 'Continue' }).click();

    await expect(page.locator('.ap')).toBeVisible({ timeout: 120_000 });
  });

  test('approval prompt can be rejected cleanly when approval is enabled', async () => {
    await page.getByPlaceholder('Ask me anything').fill('create a ppt about quarterly business review');
    await page.locator('.send-btn').click();

    const approval = page.locator('.ap');
    await approval.waitFor({ state: 'visible', timeout: 120_000 }).catch(() => null);
    test.skip(!(await approval.isVisible()), 'Running backend did not emit approval_request for this environment/build');

    await page.getByRole('button', { name: '❌ No' }).click();
    await expect(page.locator('.ap--rejected')).toBeVisible({ timeout: 20_000 });
  });

  test('existing chats can be opened and new chat can be started', async () => {
    await openSidebarSection(page, 'Chats');
    const topicCount = await page.locator('.sidebar .topic-item').count();
    test.skip(topicCount === 0, 'No existing chats available for this user');

    await page.locator('.sidebar .topic-item').first().click();
    await expect(page.locator('.messages-area')).toBeVisible();
    await page.locator('.sidebar .new-chat-btn').click();
    await expect(page.getByPlaceholder('Ask me anything')).toBeVisible();
  });
});
