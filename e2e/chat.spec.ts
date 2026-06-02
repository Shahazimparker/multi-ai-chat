import { expect, test } from '@playwright/test';
import { buildSse, expectDeepSeekSelected, installMockApi, loginAs } from './support/mockApi';

test('sends a normal chat message using deepseek-v4-flash', async ({ page }) => {
  await installMockApi(page, {
    loggedInUser: {
      id: 'user-1',
      username: 'user',
      email: 'user@example.com',
      role: 'user',
      total_tokens: 100000,
      used_tokens: 100,
      per_query_limit: 2000,
      session_minutes: 60,
      expires_at: null,
      is_active: true,
    },
    topics: [{ id: 'topic-1', title: 'Existing topic', model: 'deepseek-v4-flash' }],
    streamBody: buildSse(
      { status: 'connected' },
      { type: 'chunk', text: 'DeepSeek says hello.' },
      { type: 'done', tokensUsed: 12, cacheHit: false, model: 'DeepSeek V4 Flash — Fast (Paid)', topicId: 'topic-1' },
    ),
  });

  await page.goto('/chat');
  await expectDeepSeekSelected(page);
  await page.getByPlaceholder('Ask me anything').fill('hello');
  await page.locator('.send-btn').click();
  await expect(page.locator('.message-row.user')).toContainText('hello');
  await expect(page.locator('.message-row.assistant')).toContainText('DeepSeek says hello.');
});

test('shows clarification form for vague artifact requests', async ({ page }) => {
  await installMockApi(page, {
    loggedInUser: {
      id: 'user-1',
      username: 'user',
      email: 'user@example.com',
      role: 'user',
    },
    streamBody: (body) => {
      const message = String(body.message || '');
      if (message.includes('[ARTIFACT DETAILS]')) {
        return buildSse(
          { status: 'connected' },
          {
            type: 'approval_request',
            approvalId: 'approval-1',
            toolType: 'GENERATE_PPT',
            toolLabel: 'PowerPoint presentation',
            message: 'I want to generate a PowerPoint presentation. Review the plan below and approve, cancel, or request changes.',
            summary: 'Title: "Q2 Review"\nTheme: modern_corporate\nSlides (6):\n  1. Overview',
            options: ['yes', 'other', 'no'],
          },
          { type: 'done', tokensUsed: 25, cacheHit: false, model: 'DeepSeek V4 Flash — Fast (Paid)', topicId: 'topic-2' },
        );
      }
      return buildSse(
        { status: 'connected' },
        {
          type: 'clarification_request',
          intent: 'generate_ppt',
          message: 'Select the presentation details, then continue.',
          formId: 'generate_ppt-clarification',
          questions: [
            { id: 'topic', label: 'Topic', kind: 'text', required: true, placeholder: 'Quarterly business review', value: '' },
            { id: 'title', label: 'Title', kind: 'text', required: false, placeholder: 'Q2 Business Review', value: '' },
            { id: 'slideCount', label: 'Slides', kind: 'select', required: true, value: '6', options: [{ value: '4', label: '4 slides' }, { value: '6', label: '6 slides' }] },
            { id: 'theme', label: 'Theme', kind: 'select', required: true, value: 'modern_corporate', options: [{ value: 'modern_corporate', label: 'Modern corporate' }] },
            { id: 'audience', label: 'Audience', kind: 'select', required: true, value: 'team members', options: [{ value: 'team members', label: 'Team members' }] },
          ],
        },
        { type: 'done', tokensUsed: 0, cacheHit: false, model: 'DeepSeek V4 Flash — Fast (Paid)', topicId: 'topic-2' },
      );
    },
  });

  await page.goto('/chat');
  await expectDeepSeekSelected(page);
  await page.getByPlaceholder('Ask me anything').fill('generate a ppt for me');
  await page.locator('.send-btn').click();

  await expect(page.locator('.cp')).toBeVisible();
  await page.getByLabel('Topic').fill('Quarterly planning');
  await page.getByLabel('Title').fill('Q2 Review');
  await page.getByRole('button', { name: 'Continue' }).click();

  await expect(page.locator('.ap')).toBeVisible();
  await expect(page.locator('.ap')).toContainText('PowerPoint presentation');
});

test('approves generated artifact from approval prompt', async ({ page }) => {
  await installMockApi(page, {
    loggedInUser: {
      id: 'user-1',
      username: 'user',
      email: 'user@example.com',
      role: 'user',
    },
    streamBody: buildSse(
      { status: 'connected' },
      {
        type: 'approval_request',
        approvalId: 'approval-2',
        toolType: 'GENERATE_IMAGE',
        toolLabel: 'image',
        message: 'I want to generate a image. Review the plan below and approve, cancel, or request changes.',
        summary: 'Prompt: "Create a launch banner"',
        options: ['yes', 'other', 'no'],
      },
      { type: 'done', tokensUsed: 5, cacheHit: false, model: 'DeepSeek V4 Flash — Fast (Paid)', topicId: 'topic-3' },
    ),
  });

  await page.goto('/chat');
  await page.getByPlaceholder('Ask me anything').fill('generate image banner');
  await page.locator('.send-btn').click();
  await page.getByRole('button', { name: '✅ Yes, generate' }).click();
  await expect(page.locator('.ap--approved')).toContainText('Approved');
});

test('starts a new chat from the sidebar', async ({ page }) => {
  await installMockApi(page, {
    loggedInUser: {
      id: 'user-1',
      username: 'user',
      email: 'user@example.com',
      role: 'user',
    },
    topics: [
      { id: 'topic-1', title: 'First topic', model: 'deepseek-v4-flash' },
      { id: 'topic-2', title: 'Second topic', model: 'deepseek-v4-flash' },
    ],
    messagesByTopic: {
      'topic-1': [{ role: 'assistant', content: 'Saved content', model: 'deepseek-v4-flash', tokens_used: 12, created_at: '2026-06-02T10:00:00.000Z', generated_files: [] }],
    },
  });

  await page.goto('/chat');
  await page.locator('.sidebar-section-label.collapsible').filter({ hasText: 'Chats' }).click();
  await page.locator('.sidebar .topic-title').filter({ hasText: 'First topic' }).first().click();
  await expect(page.locator('.message-row.assistant')).toContainText('Saved content');
  await page.locator('.sidebar .new-chat-btn').click();
  await expect(page.locator('.message-row')).toHaveCount(0);
});
