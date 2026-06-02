import { expect, test } from '@playwright/test';
import { buildSse, installMockApi } from './support/mockApi';

test('uploads a file and sends a chat message with deepseek-v4-flash selected', async ({ page }) => {
  await installMockApi(page, {
    loggedInUser: {
      id: 'user-1',
      username: 'user',
      email: 'user@example.com',
      role: 'user',
    },
    uploadResponse: {
      type: 'done',
      fileName: 'notes.txt',
    },
    streamBody: buildSse(
      { status: 'connected' },
      { type: 'chunk', text: 'I analyzed your file.' },
      { type: 'done', tokensUsed: 33, cacheHit: false, model: 'DeepSeek V4 Flash — Fast (Paid)', topicId: 'topic-upload' },
    ),
  });

  await page.goto('/chat');
  await page.getByTitle('Attach files').click();
  await page.locator('#file-input').setInputFiles({
    name: 'notes.txt',
    mimeType: 'text/plain',
    buffer: Buffer.from('hello from upload'),
  });
  await expect(page.locator('.pending-file-tag')).toContainText('notes.txt');
  await page.getByPlaceholder('Ask me anything').fill('review this');
  await page.locator('.send-btn').click();
  await expect(page.locator('.message-row.assistant').first()).toContainText('I analyzed your file.');
});

test('shows and filters artifacts in the sidebar', async ({ page }) => {
  await installMockApi(page, {
    loggedInUser: {
      id: 'user-1',
      username: 'user',
      email: 'user@example.com',
      role: 'user',
    },
    artifacts: [
      { file_id: 'file-1', file_name: 'Q2-review.pptx', file_type: 'pptx', created_at: '2026-06-02T10:00:00.000Z' },
      { file_id: 'file-2', file_name: 'budget.xlsx', file_type: 'xlsx', created_at: '2026-06-02T10:00:00.000Z' },
    ],
  });

  await page.goto('/chat');
  await page.locator('.sidebar-section-label.collapsible').filter({ hasText: 'Artifacts' }).click();
  await expect(page.getByText('Q2-review.pptx')).toBeVisible();
  await page.getByPlaceholder('Search docs...').fill('budget');
  await expect(page.getByText('budget.xlsx')).toBeVisible();
  await expect(page.getByText('Q2-review.pptx')).toHaveCount(0);
});

test('deletes an artifact from the sidebar', async ({ page }) => {
  await installMockApi(page, {
    loggedInUser: {
      id: 'user-1',
      username: 'user',
      email: 'user@example.com',
      role: 'user',
    },
    artifacts: [
      { file_id: 'file-1', file_name: 'artifact.json', file_type: 'json', created_at: '2026-06-02T10:00:00.000Z' },
    ],
  });

  page.on('dialog', async (dialog) => dialog.accept());

  await page.goto('/chat');
  await page.locator('.sidebar-section-label.collapsible').filter({ hasText: 'Artifacts' }).click();
  await expect(page.getByText('artifact.json')).toBeVisible();
  await page.locator('.artifact-del-btn').click();
  await expect(page.getByText('artifact.json')).toHaveCount(0);
});
