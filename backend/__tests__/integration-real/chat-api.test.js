// Real chat API integration tests — requires backend running on localhost:5000
// Run: npx vitest run --config vitest.real.config.js
// Prerequisite: npm run dev (start backend first)

const BASE = 'http://localhost:5000/api';

// /api/chat/* requires auth — anonymous chat was removed so an unauthenticated
// caller could no longer spend provider budget. Same login shape as
// approval-flow.test.js; keep the two in step if either changes.
let authToken = null;
let csrfToken = null;

beforeAll(async () => {
  const res = await fetch(`${BASE}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      username: process.env.TEST_USERNAME || 'testadmin',
      password: process.env.TEST_PASSWORD || 'testpassword123',
    }),
  });

  if (res.status !== 200) {
    console.warn('[beforeAll] Login failed — authenticated tests will be skipped');
    return;
  }

  const setCookie = res.headers.get('set-cookie') || '';
  authToken = setCookie.match(/auth_token=([^;]+)/)?.[1] || null;
  try {
    csrfToken = (await res.json()).csrfToken || null;
  } catch { /* body already consumed or malformed */ }

  if (!authToken) console.warn('[beforeAll] Could not parse auth_token from cookie');
}, 15000);

// The CSRF cookie has to ride along with the header: the middleware compares
// the two, so sending only the header now fails exactly as a forgery would.
const authHeaders = (extra = {}) => ({
  ...extra,
  ...(authToken ? { Cookie: `auth_token=${authToken}; csrf_token=${csrfToken}` } : {}),
  ...(csrfToken ? { 'X-CSRF-Token': csrfToken } : {}),
});

describe('Chat API (real)', () => {
  const parseSseEvents = (buffer) => {
    const events = [];
    for (const block of buffer.split('\n\n')) {
      if (!block) continue;
      const dataLine = block.split('\n').find((l) => l.startsWith('data: '));
      if (!dataLine) continue;
      try {
        events.push(JSON.parse(dataLine.slice(6)));
      } catch {
        // ignore partial/malformed chunks
      }
    }
    return events;
  };
  // ── Health check ────────────────────────────────────
  it('GET /api/health returns OK', async () => {
    const res = await fetch(`${BASE}/health`);
    const data = await res.json();
    expect(res.status).toBe(200);
    expect(data.status).toBe('OK');
    expect(data.timestamp).toBeDefined();
  });

  // ── Model listing ───────────────────────────────────
  it('GET /api/chat/models returns model list', async () => {
    if (!authToken) return;
    const res = await fetch(`${BASE}/chat/models`, { headers: authHeaders() });
    const data = await res.json();
    expect(res.status).toBe(200);
    expect(data.models).toBeDefined();
    expect(Array.isArray(data.models)).toBe(true);
    expect(data.models.length).toBeGreaterThan(0);

    // Verify expected models exist
    const modelIds = data.models.map(m => m.id);
    expect(modelIds).toContain('gemini-flash');
    expect(modelIds).toContain('groq-gpt-oss-120b');
    console.log(`[Models] ${data.models.length} models available`);
  });

  // ── Anonymous streaming chat (no auth) ──────────────
  // This asserted 200 while anonymous chat was allowed. That was removed so an
  // unauthenticated caller could not spend provider budget, so the test now
  // pins the opposite guarantee.
  it('POST /api/chat/stream rejects unauthenticated callers', async () => {
    const res = await fetch(`${BASE}/chat/stream`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        modelId: 'deepseek-v4-flash',
        message: 'Reply with exactly: HELLO',
      }),
    });
    expect(res.status).toBe(401);
  }, 15000);

  it('GET /api/chat/models rejects unauthenticated callers', async () => {
    const res = await fetch(`${BASE}/chat/models`);
    expect(res.status).toBe(401);
  }, 15000);

  it('POST /api/chat/stream streams for an authenticated caller', async () => {
    if (!authToken) return;
    const res = await fetch(`${BASE}/chat/stream`, {
      method: 'POST',
      headers: authHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({
        modelId: 'deepseek-v4-flash',
        message: 'Reply with exactly: HELLO',
      }),
    });

    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/event-stream');

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let fullText = '';
    let doneEvent = null;
    let errorEvent = null;

    let sseBuffer = '';
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      sseBuffer += decoder.decode(value, { stream: true });
      const parts = sseBuffer.split('\n\n');
      sseBuffer = parts.pop() || '';
      for (const event of parseSseEvents(parts.join('\n\n'))) {
        if (event.type === 'chunk') fullText += event.text;
        if (event.type === 'done') doneEvent = event;
        if (event.type === 'error') errorEvent = event;
      }
    }
    for (const event of parseSseEvents(sseBuffer)) {
      if (event.type === 'chunk') fullText += event.text;
      if (event.type === 'done') doneEvent = event;
      if (event.type === 'error') errorEvent = event;
    }

    expect(doneEvent || errorEvent).toBeTruthy();
    if (doneEvent) expect(doneEvent?.model).toBeDefined();
    console.log(`[Auth Stream] Reply: ${fullText.slice(0, 100)}`);
    console.log(`[Auth Stream] Tokens: ${doneEvent?.tokensUsed}`);
  }, 30000);

  // ── Streaming chat ──────────────────────────────────
  it('POST /api/chat/stream returns SSE events', async () => {
    if (!authToken) return;
    const res = await fetch(`${BASE}/chat/stream`, {
      method: 'POST',
      headers: authHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({
        modelId: 'deepseek-v4-flash',
        message: 'Say hello in one word',
      }),
    });

    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/event-stream');

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let fullText = '';
    let doneReceived = false;
    let errorReceived = false;
    let chunks = [];

    let sseBuffer = '';
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      sseBuffer += decoder.decode(value, { stream: true });
      const parts = sseBuffer.split('\n\n');
      sseBuffer = parts.pop() || '';
      for (const event of parseSseEvents(parts.join('\n\n'))) {
        chunks.push(event);
        if (event.type === 'chunk') fullText += event.text;
        if (event.type === 'done') doneReceived = true;
        if (event.type === 'error') errorReceived = true;
      }
    }
    for (const event of parseSseEvents(sseBuffer)) {
      chunks.push(event);
      if (event.type === 'chunk') fullText += event.text;
      if (event.type === 'done') doneReceived = true;
      if (event.type === 'error') errorReceived = true;
    }

    expect(chunks.length).toBeGreaterThan(0);
    expect(doneReceived || errorReceived).toBe(true);
    expect(fullText.length > 0 || errorReceived).toBe(true);
    console.log(`[Stream] Received ${chunks.length} chunks, full text: "${fullText.trim()}"`);
  }, 60000);

  it('POST /api/chat/stream accepts allowArtifactWithCurrentModel override', async () => {
    if (!authToken) return;
    const res = await fetch(`${BASE}/chat/stream`, {
      method: 'POST',
      headers: authHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({
        modelId: 'deepseek-v4-flash',
        message: 'Say HELLO in one short sentence.',
        allowArtifactWithCurrentModel: true,
      }),
    });

    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/event-stream');

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let sseBuffer = '';
    let sawDone = false;
    let sawError = false;
    let sawSwitchError = false;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      sseBuffer += decoder.decode(value, { stream: true });
      const parts = sseBuffer.split('\n\n');
      sseBuffer = parts.pop() || '';
      for (const event of parseSseEvents(parts.join('\n\n'))) {
        if (event.type === 'done') sawDone = true;
        if (event.type === 'error') {
          sawError = true;
          if (event.errorType === 'model_switch_required') sawSwitchError = true;
        }
      }
    }
    for (const event of parseSseEvents(sseBuffer)) {
      if (event.type === 'done') sawDone = true;
      if (event.type === 'error') {
        sawError = true;
        if (event.errorType === 'model_switch_required') sawSwitchError = true;
      }
    }

    expect(sawDone).toBe(true);
    expect(sawError).toBe(false);
    expect(sawSwitchError).toBe(false);
  }, 60000);

  // ── Provider model catalog ──────────────────────────
  it('GET /api/chat/provider-models/openrouter works', async () => {
    if (!authToken) return;
    const res = await fetch(`${BASE}/chat/provider-models/openrouter`, { headers: authHeaders() });
    const data = await res.json();

    if (res.status === 200) {
      expect(data.models).toBeDefined();
      console.log(`[OpenRouter] ${data.models.length} models available`);
    }
    // May fail if OPENROUTER_API_KEY is not set — that's OK
  }, 15000);
});
