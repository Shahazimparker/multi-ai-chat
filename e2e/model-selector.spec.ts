import { expect, test } from '@playwright/test';
import { installMockApi } from './support/mockApi';

const MODELS = [
  {
    id: 'deepseek-v4-flash',
    label: 'DeepSeek V4 Flash',
    provider: 'deepseek',
    paid: true,
    unified: false,
    models: [],
    reasoning: { levels: ['high', 'max'], default: 'high', canDisable: true, enabledByDefault: false, label: 'Thinking' },
  },
  {
    id: 'gemini-3-flash',
    label: 'Gemini 3 Flash',
    provider: 'gemini',
    paid: false,
    unified: false,
    models: [],
    reasoning: { levels: ['low', 'medium', 'high'], default: 'medium', canDisable: false, enabledByDefault: true, label: 'Thinking' },
  },
  {
    id: 'claude-haiku',
    label: 'Claude Haiku 4.5',
    provider: 'claude',
    paid: true,
    unified: false,
    models: [],
    reasoning: { levels: [], default: null, canDisable: true, enabledByDefault: false, label: 'Extended thinking' },
  },
  {
    id: 'mistral-large',
    label: 'Mistral Large',
    provider: 'mistral',
    paid: false,
    unified: false,
    models: [],
    reasoning: null,
  },
  {
    id: 'openrouter',
    label: 'OpenRouter',
    provider: 'openrouter',
    paid: true,
    unified: true,
    models: [],
    reasoning: null,
  },
];

const user = {
  id: 'user-1',
  username: 'user',
  email: 'user@example.com',
  role: 'user' as const,
  total_tokens: 100000,
  used_tokens: 100,
  per_query_limit: 2000,
  session_minutes: 60,
  expires_at: null,
  is_active: true,
};

test('model picker sits under the composer and picks model + effort together', async ({ page }) => {
  await installMockApi(page, { loggedInUser: user, topics: [] });
  await page.route('**/api/chat/models', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ models: MODELS }) }),
  );

  await page.goto('/chat');
  await expect(page.locator('.model-trigger')).toContainText('DeepSeek V4 Flash');

  // Trigger sits in the composer footer, below the input box.
  const triggerBox = await page.locator('.model-trigger').boundingBox();
  const inputBox = await page.locator('.input-box').boundingBox();
  expect(triggerBox!.y).toBeGreaterThan(inputBox!.y);

  await page.locator('.model-trigger').click();
  await expect(page.locator('.model-dropdown')).toBeVisible();

  // The list opens upward: its bottom edge is above the trigger.
  const listBox = await page.locator('.model-dropdown').boundingBox();
  expect(listBox!.y + listBox!.height).toBeLessThanOrEqual(triggerBox!.y + 2);

  // Hovering a model with levels opens its flyout.
  await page.locator('.model-row', { hasText: 'Gemini 3 Flash' }).hover();
  await expect(page.locator('.model-level-menu')).toBeVisible();
  await expect(page.locator('.model-level-item')).toHaveCount(3);
  await expect(page.locator('.model-level-item.active')).toHaveText(/Medium/);

  // Picking a level picks the model too, and the trigger reports both.
  await page.locator('.model-level-item', { hasText: 'High' }).click();
  await expect(page.locator('.model-dropdown')).toHaveCount(0);
  await expect(page.locator('.model-trigger')).toContainText('Gemini 3 Flash');
  await expect(page.locator('.model-trigger-level')).toHaveText('High');

  // Reopening shows the level that is actually in force on the chosen model.
  await page.locator('.model-trigger').click();
  await expect(
    page.locator('.model-row', { hasText: 'Gemini 3 Flash' }).locator('.option-level'),
  ).toHaveText('High');

  // A model that thinks at one fixed depth has no caret, just the Thinks tag.
  const haiku = page.locator('.model-row', { hasText: 'Claude Haiku' });
  await expect(haiku.locator('.model-level-caret')).toHaveCount(0);
  await expect(haiku.locator('.model-think-tag')).toBeVisible();

  // A model that cannot think has neither.
  const mistral = page.locator('.model-row', { hasText: 'Mistral Large' });
  await expect(mistral.locator('.model-level-caret')).toHaveCount(0);
  await expect(mistral.locator('.model-think-tag')).toHaveCount(0);
});

// Below 768px the flyout has nowhere to go, so the sheet expands the levels
// under the row instead. Separate code path, so it gets its own pass.
test('mobile sheet expands the levels inline', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 780 });
  await installMockApi(page, { loggedInUser: user, topics: [] });
  await page.route('**/api/chat/models', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ models: MODELS }) }),
  );

  await page.goto('/chat');
  await page.locator('.model-trigger').click();
  await expect(page.locator('.model-sheet')).toBeVisible();
  await expect(page.locator('.model-level-menu')).toHaveCount(0);

  await page.locator('.model-row', { hasText: 'Gemini 3 Flash' }).locator('.model-level-caret').click();
  const inline = page.locator('.model-level-inline');
  await expect(inline).toBeVisible();

  const box = (await inline.boundingBox())!;
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(390);

  await inline.locator('.model-level-item', { hasText: 'High' }).click();
  await expect(page.locator('.model-sheet')).toHaveCount(0);
  await expect(page.locator('.model-trigger')).toContainText('Gemini 3 Flash');
});
