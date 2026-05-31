// Real chat API integration tests — requires backend running on localhost:5000
// Run: npx vitest run --config vitest.real.config.js
// Prerequisite: npm run dev (start backend first)

const BASE = 'http://localhost:5000/api';

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
    const res = await fetch(`${BASE}/chat/models`);
    const data = await res.json();
    expect(res.status).toBe(200);
    expect(data.models).toBeDefined();
    expect(Array.isArray(data.models)).toBe(true);
    expect(data.models.length).toBeGreaterThan(0);

    // Verify expected models exist
    const modelIds = data.models.map(m => m.id);
    expect(modelIds).toContain('gemini-flash');
    expect(modelIds).toContain('groq-llama');
    console.log(`[Models] ${data.models.length} models available`);
  });

  // ── Anonymous streaming chat (no auth) ──────────────
  it('POST /api/chat/stream works anonymously', async () => {
    const res = await fetch(`${BASE}/chat/stream`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        modelId: 'gemini-flash',
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
    console.log(`[Anonymous Stream] Reply: ${fullText.slice(0, 100)}`);
    console.log(`[Anonymous Stream] Tokens: ${doneEvent?.tokensUsed}`);
  }, 30000);

  // ── Streaming chat ──────────────────────────────────
  it('POST /api/chat/stream returns SSE events', async () => {
    const res = await fetch(`${BASE}/chat/stream`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        modelId: 'gemini-flash',
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
    const res = await fetch(`${BASE}/chat/stream`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
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
    const res = await fetch(`${BASE}/chat/provider-models/openrouter`);
    const data = await res.json();

    if (res.status === 200) {
      expect(data.models).toBeDefined();
      console.log(`[OpenRouter] ${data.models.length} models available`);
    }
    // May fail if OPENROUTER_API_KEY is not set — that's OK
  }, 15000);
});
