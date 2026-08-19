import { expect, type Page, type Route } from '@playwright/test';

const API_BASE = 'http://localhost:5000/api';

const deepseekModel = {
  id: 'deepseek-v4-flash',
  label: 'DeepSeek V4 Flash — Fast (Paid)',
  provider: 'deepseek',
  paid: true,
  unified: false,
  models: [],
};

type User = {
  id: string;
  username: string;
  email: string;
  role: 'user' | 'admin';
  total_tokens?: number;
  used_tokens?: number;
  per_query_limit?: number;
  session_minutes?: number;
  expires_at?: string | null;
  is_active?: boolean;
  is_login_locked?: boolean;
};

type Topic = {
  id: string;
  title: string;
  model: string;
};

type Artifact = {
  file_id: string;
  file_name: string;
  file_type: string;
  created_at: string;
};

type MockOptions = {
  loggedInUser?: User | null;
  users?: User[];
  topics?: Topic[];
  messagesByTopic?: Record<string, Array<Record<string, unknown>>>;
  artifacts?: Artifact[];
  analytics?: Record<string, unknown>;
  apiStatus?: Record<string, string>;
  streamBody?:
    | string
    | ((body: Record<string, unknown>) => string);
  uploadResponse?: Record<string, unknown>;
};

const buildSse = (...events: Record<string, unknown>[]) =>
  events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join('');

const defaultAnalytics = {
  summary: {
    totalQueries: 12,
    totalTokens: 4567,
    cacheHits: 3,
    cacheHitRate: 25,
  },
  modelCounts: {
    'deepseek-v4-flash': 8,
    'claude-sonnet-5': 4,
  },
  dailyUsage: [
    { created_at: '2026-06-01T10:00:00.000Z', tokens_used: 120 },
    { created_at: '2026-06-02T10:00:00.000Z', tokens_used: 180 },
  ],
  topQueries: [
    { id: 'q1', query_text: 'generate a ppt for me', model: 'deepseek-v4-flash', hit_count: 4, last_hit_at: '2026-06-02T10:00:00.000Z' },
  ],
};

const json = async (route: Route, payload: unknown, status = 200) => {
  await route.fulfill({
    status,
    contentType: 'application/json',
    body: JSON.stringify(payload),
  });
};

export async function installMockApi(page: Page, options: MockOptions = {}) {
  const state = {
    loggedInUser: options.loggedInUser ?? null,
    users: options.users ?? [],
    topics: options.topics ?? [],
    messagesByTopic: options.messagesByTopic ?? {},
    artifacts: options.artifacts ?? [],
    analytics: options.analytics ?? defaultAnalytics,
    apiStatus: options.apiStatus ?? { openai: 'active', deepseek: 'active', supabase: 'active' },
    uploadResponse: options.uploadResponse ?? { type: 'done', fileName: 'notes.txt' },
  };

  await page.route(`${API_BASE}/**`, async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname.replace('/api', '');
    const method = request.method();
    const bodyText = request.postData() || '';
    let body: Record<string, unknown> = {};
    try {
      body = bodyText ? JSON.parse(bodyText) : {};
    } catch {
      body = {};
    }

    if (path === '/auth/me' && method === 'GET') {
      if (!state.loggedInUser) return json(route, { error: 'Unauthorized' }, 401);
      return json(route, { user: state.loggedInUser });
    }

    if (path === '/auth/login' && method === 'POST') {
      const username = String(body.username || '');
      const password = String(body.password || '');
      if (password !== 'password123') return json(route, { error: 'Invalid credentials' }, 401);
      state.loggedInUser = username === 'admin'
        ? {
            id: 'admin-1',
            username: 'admin',
            email: 'admin@example.com',
            role: 'admin',
            total_tokens: 100000,
            used_tokens: 1200,
            per_query_limit: 2000,
            session_minutes: 60,
            expires_at: null,
            is_active: true,
          }
        : {
            id: 'user-1',
            username: username || 'tester',
            email: `${username || 'tester'}@example.com`,
            role: 'user',
            total_tokens: 100000,
            used_tokens: 450,
            per_query_limit: 2000,
            session_minutes: 60,
            expires_at: null,
            is_active: true,
          };
      return json(route, { csrfToken: 'csrf-token', user: state.loggedInUser });
    }

    if (path === '/auth/logout' && method === 'POST') {
      state.loggedInUser = null;
      return json(route, { success: true });
    }

    if (path === '/chat/models' && method === 'GET') {
      return json(route, { models: [deepseekModel] });
    }

    if (path === '/chat/provider-models/openrouter' && method === 'GET') {
      return json(route, { provider: 'openrouter', cached: true, models: [] });
    }

    if (path === '/history/topics' && method === 'GET') {
      return json(route, { topics: state.topics });
    }

    if (path.startsWith('/history/topics/') && path.endsWith('/messages') && method === 'GET') {
      const topicId = path.split('/')[3];
      return json(route, { messages: state.messagesByTopic[topicId] || [] });
    }

    if (path.startsWith('/history/topics/') && method === 'DELETE') {
      const topicId = path.split('/')[3];
      state.topics = state.topics.filter((topic) => topic.id !== topicId);
      return json(route, { success: true });
    }

    if (path.startsWith('/history/topics/') && method === 'PATCH') {
      const topicId = path.split('/')[3];
      state.topics = state.topics.map((topic) => topic.id === topicId ? { ...topic, title: String(body.title || topic.title) } : topic);
      return json(route, { success: true });
    }

    if (path === '/upload/files' && method === 'GET') {
      return json(route, { files: state.artifacts });
    }

    if (path.startsWith('/upload/preview/') && method === 'GET') {
      const artifactId = path.split('/')[3];
      const artifact = state.artifacts.find((entry) => entry.file_id === artifactId);
      return json(route, { file_name: artifact?.file_name || 'artifact.txt', file_type: artifact?.file_type || 'txt', content: 'Preview content' });
    }

    if (path.startsWith('/upload/download/') && method === 'GET') {
      return route.fulfill({
        status: 200,
        contentType: 'application/octet-stream',
        headers: { 'content-disposition': 'attachment; filename="artifact.txt"' },
        body: 'artifact content',
      });
    }

    if (path.startsWith('/upload/') && method === 'DELETE') {
      const artifactId = path.split('/')[3];
      state.artifacts = state.artifacts.filter((entry) => entry.file_id !== artifactId);
      return json(route, { success: true });
    }

    if (path === '/upload/file' && method === 'POST') {
      return route.fulfill({
        status: 200,
        contentType: 'text/event-stream',
        body: [
          `data: ${JSON.stringify({ type: 'init', sessionId: 'upload-session-1' })}`,
          `data: ${JSON.stringify({ type: 'progress', percent: 100, message: 'Upload complete' })}`,
          `data: ${JSON.stringify(state.uploadResponse)}`,
          '',
        ].join('\n'),
      });
    }

    if (path.startsWith('/upload/generate-file') && method === 'POST') {
      const name = String(body.fileName || 'generated.txt');
      const ext = name.split('.').pop() || 'txt';
      const file = {
        file_id: `generated-${Date.now()}`,
        file_name: name,
        file_type: ext,
      };
      state.artifacts.push({ ...file, created_at: new Date().toISOString() });
      return json(route, { file });
    }

    if (path.startsWith('/upload/cancel/') && method === 'POST') {
      return json(route, { success: true });
    }

    if (path === '/chat/stream' && method === 'POST') {
      const streamBody = typeof options.streamBody === 'function'
        ? options.streamBody(body)
        : (options.streamBody || buildSse(
          { status: 'connected' },
          { type: 'chunk', text: 'Mocked response from DeepSeek V4 Flash.' },
          { type: 'done', tokensUsed: 42, cacheHit: false, model: deepseekModel.label, topicId: 'topic-1' },
        ));
      return route.fulfill({
        status: 200,
        contentType: 'text/event-stream',
        body: streamBody,
      });
    }

    if (path.startsWith('/approval/') && path.endsWith('/respond') && method === 'POST') {
      return json(route, { success: true, status: body.response === false ? 'rejected' : 'approved', approval: { id: path.split('/')[2] } });
    }

    if (path === '/admin/users' && method === 'GET') {
      return json(route, { users: state.users });
    }

    if (path === '/admin/users' && method === 'POST') {
      const user = {
        id: `user-${state.users.length + 1}`,
        ...body,
      } as User;
      state.users.push(user);
      return json(route, { user });
    }

    if (path.startsWith('/admin/users/') && method === 'PUT') {
      const userId = path.split('/')[3];
      state.users = state.users.map((user) => user.id === userId ? { ...user, ...body } as User : user);
      return json(route, { success: true });
    }

    if (path.startsWith('/admin/users/') && method === 'DELETE') {
      const userId = path.split('/')[3];
      state.users = state.users.filter((user) => user.id !== userId);
      return json(route, { success: true });
    }

    if (path.startsWith('/admin/users/') && path.endsWith('/reset-tokens') && method === 'POST') {
      const userId = path.split('/')[3];
      state.users = state.users.map((user) => user.id === userId ? { ...user, used_tokens: 0 } : user);
      return json(route, { success: true });
    }

    if (path.startsWith('/admin/users/') && path.endsWith('/lock-login') && method === 'POST') {
      const userId = path.split('/')[3];
      state.users = state.users.map((user) => user.id === userId ? { ...user, is_login_locked: true } : user);
      return json(route, { success: true });
    }

    if (path.startsWith('/admin/users/') && path.endsWith('/unlock-login') && method === 'POST') {
      const userId = path.split('/')[3];
      state.users = state.users.map((user) => user.id === userId ? { ...user, is_login_locked: false } : user);
      return json(route, { success: true });
    }

    if (path === '/admin/analytics' && method === 'GET') {
      return json(route, state.analytics);
    }

    if (path === '/admin/api-status' && method === 'GET') {
      return json(route, state.apiStatus);
    }

    return json(route, { error: `Unhandled mock for ${method} ${path}` }, 500);
  });
}

export async function loginAs(page: Page, username: 'user' | 'admin' = 'user') {
  await page.goto('/login');
  await page.getByPlaceholder('Username or Email').fill(username);
  await page.getByPlaceholder('Password').fill('password123');
  await page.getByRole('button', { name: 'Sign In' }).click();
}

export async function expectDeepSeekSelected(page: Page) {
  await expect(page.locator('.model-trigger')).toContainText('DeepSeek V4 Flash');
}

export { buildSse, deepseekModel };
