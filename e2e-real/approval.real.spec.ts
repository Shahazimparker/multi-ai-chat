import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import { REAL_USER, REAL_PASSWORD, login } from './support/realHelpers';

let context: BrowserContext;
let page: Page;

test.describe.serial('real approval flow', () => {
  test.beforeAll(async ({ browser }) => {
    test.skip(!REAL_USER || !REAL_PASSWORD, 'No real user credentials configured');
    context = await browser.newContext();
    page = await context.newPage();
    await login(page, REAL_USER, REAL_PASSWORD);
    await page.goto('/chat');
    await page.waitForLoadState('networkidle');
  });

  test.afterAll(async () => {
    await context?.close();
  });

  test.beforeEach(async () => {
    // Navigate to chat and ensure we're still logged in
    await page.goto('/chat');
    await page.waitForLoadState('networkidle');
    // If redirected to login, re-login
    if (page.url().includes('/login')) {
      await login(page, REAL_USER, REAL_PASSWORD);
    }
  });

  test('approval prompt appears for image generation request', async () => {
    const imagePrompt = 'Generate an image of a red apple on white background. Use GENERATE_IMAGE tool.';
    const textarea = page.locator('textarea, input[placeholder*="message" i]').first();
    await textarea.fill(imagePrompt);
    await textarea.press('Enter');

    // Wait for approval prompt to appear
    await expect(page.locator('.ap')).toBeVisible({ timeout: 30000 });
    await expect(page.locator('.ap__badge')).toContainText('IMAGE', { timeout: 5000 });
    await expect(page.locator('.ap__summary')).toBeVisible();
    await expect(page.locator('.ap__btn--approve')).toBeVisible();
  });

  test('can provide instructions via "Other" button', async () => {
    const imagePrompt = 'Generate a cityscape image. Use GENERATE_IMAGE tool.';
    const textarea = page.locator('textarea, input[placeholder*="message" i]').first();
    await textarea.fill(imagePrompt);
    await textarea.press('Enter');

    // Wait for approval prompt
    await expect(page.locator('.ap')).toBeVisible({ timeout: 30000 });

    // Click "Other" button
    const otherBtn = page.locator('.ap__btn--other');
    await otherBtn.click();

    // Wait for instructions textarea
    await expect(page.locator('.ap__textarea')).toBeVisible({ timeout: 5000 });

    // Type instructions
    const instructionsTextarea = page.locator('.ap__textarea');
    await instructionsTextarea.fill('Make it a night scene with neon lights');

    // Check character counter
    await expect(page.locator('.ap__char-count')).toContainText(/\d+\/500/);

    // Submit instructions
    const submitBtn = page.locator('.ap__btn--primary');
    await submitBtn.click();

    // Wait for "Changes noted" state
    await expect(page.locator('.ap--modified')).toBeVisible({ timeout: 10000 });
    await expect(page.locator('.ap__state-text')).toContainText(/Changes noted|revising/i);
  });

  test('can approve after instructions (revised approval)', async () => {
    const imagePrompt = 'Generate a futuristic city skyline. Use GENERATE_IMAGE tool with a detailed prompt.';
    const textarea = page.locator('textarea, input[placeholder*="message" i]').first();
    await textarea.fill(imagePrompt);
    await textarea.press('Enter');

    // Wait for initial approval
    await expect(page.locator('.ap')).toBeVisible({ timeout: 30000 });

    // Send instructions
    const otherBtn = page.locator('.ap__btn--other');
    await otherBtn.click();
    await page.locator('.ap__textarea').fill('Use more vibrant neon colors');
    await page.locator('.ap__btn--primary').click();

    // Wait for "Changes noted" state
    await expect(page.locator('.ap--modified')).toBeVisible({ timeout: 10000 });

    // Wait for revised approval prompt (next approval_request event)
    // Look for a non-modified approval prompt with approve button
    await page.waitForFunction(() => {
      const aps = document.querySelectorAll('.ap');
      return Array.from(aps).some(el =>
        !el.classList.contains('ap--modified') &&
        el.querySelector('.ap__btn--approve')
      );
    }, { timeout: 60000 });

    // Approve the revised version
    const approveBtn = page.locator('.ap:not(.ap--modified) .ap__btn--approve').first();
    await approveBtn.click();

    // Wait for approved state
    await expect(page.locator('.ap--approved')).toBeVisible({ timeout: 10000 });
    await expect(page.locator('.ap__state-text')).toContainText(/Approved|generating/i);

    // Wait for file card to appear (image generated)
    await expect(page.locator('.file-card')).toBeVisible({ timeout: 120000 });
  });

  test('can reject approval request', async () => {
    const imagePrompt = 'Generate an image. Use GENERATE_IMAGE tool.';
    const textarea = page.locator('textarea, input[placeholder*="message" i]').first();
    await textarea.fill(imagePrompt);
    await textarea.press('Enter');

    // Wait for approval prompt
    await expect(page.locator('.ap')).toBeVisible({ timeout: 30000 });

    // Click reject button
    const rejectBtn = page.locator('.ap__btn--reject');
    await rejectBtn.click();

    // Wait for rejected state
    await expect(page.locator('.ap--rejected')).toBeVisible({ timeout: 5000 });
    await expect(page.locator('.ap__state-text')).toContainText(/Cancelled/i);
  });

  test('approval prompt shows correct tool labels', async () => {
    const imagePrompt = 'Generate a professional business presentation. Use GENERATE_PPT tool.';
    const textarea = page.locator('textarea, input[placeholder*="message" i]').first();
    await textarea.fill(imagePrompt);
    await textarea.press('Enter');

    // Wait for approval prompt
    await expect(page.locator('.ap')).toBeVisible({ timeout: 30000 });

    // Check tool label (could be PPT, GENERATE_PPT, or similar)
    const badge = page.locator('.ap__badge');
    await expect(badge).toBeVisible();
    const badgeText = await badge.innerText();
    expect(badgeText).toMatch(/PPT|presentation|generate/i);
  });
});
