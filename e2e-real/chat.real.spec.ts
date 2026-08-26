import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import { expectDefaultModelSelected, login, openSidebarSection, requireRealUser, waitForAssistantMessage } from './support/realHelpers';

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

  test('chat screen uses default model (mistral-medium) by default', async () => {
    await expectDefaultModelSelected(page);
  });

  test('sends a real chat message and receives a live response', async () => {
    await expectDefaultModelSelected(page);
    await page.getByPlaceholder('Ask me anything').fill('Reply with exactly: REAL_E2E_OK');
    await page.locator('.send-btn').click();
    await waitForAssistantMessage(page);
    await expect(page.locator('.message-row.assistant').first()).toContainText(/REAL_E2E_OK|real_e2e_ok/i);
  });

  test('vague PPT request shows clarification box', async () => {
    await page.getByPlaceholder('Ask me anything').fill('generate a ppt for me');
    await page.locator('.send-btn').click();

    // This is the behaviour under test — assert it. Skipping when the box does
    // not appear would turn the exact failure this test exists to catch into a
    // green run.
    await expect(page.locator('.cp')).toBeVisible({ timeout: 60_000 });

    await page.getByLabel('Topic').fill('Quarterly business review');
    await page.getByLabel('Title').fill('Q2 Business Review');
    await page.getByRole('button', { name: 'Continue' }).click();

    await expect(page.locator('.ap')).toBeVisible({ timeout: 120_000 });
  });

  test('approval prompt can be rejected cleanly', async () => {
    await page.getByPlaceholder('Ask me anything').fill('create a ppt about quarterly business review');
    await page.locator('.send-btn').click();

    await expect(page.locator('.ap')).toBeVisible({ timeout: 120_000 });

    await page.getByRole('button', { name: '❌ No' }).click();
    await expect(page.locator('.ap--rejected')).toBeVisible({ timeout: 20_000 });
  });

  test('existing chats can be opened and new chat can be started', async () => {
    // Seed a topic rather than skipping when the account happens to have none —
    // the earlier tests in this serial block already send messages, but this
    // makes the test self-sufficient if run in isolation.
    await page.getByPlaceholder('Ask me anything').fill('Reply with exactly: SEED_OK');
    await page.locator('.send-btn').click();
    await waitForAssistantMessage(page);

    await openSidebarSection(page, 'Chats');
    const topics = page.locator('.sidebar .topic-item');
    await expect(topics.first()).toBeVisible({ timeout: 30_000 });

    await topics.first().click();
    await expect(page.locator('.messages-area')).toBeVisible();
    await page.locator('.sidebar .new-chat-btn').click();
    await expect(page.getByPlaceholder('Ask me anything')).toBeVisible();
  });
});
