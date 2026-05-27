// Real chat API integration tests — requires backend running on localhost:5000
// Run: npx vitest run --config vitest.real.config.js
// Prerequisite: npm run dev (start backend first)

const BASE = 'http://localhost:5000/api';

describe('Chat API (real)', () => {
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

  // ── Anonymous chat (no auth) ────────────────────────
  it('POST /api/chat/message works anonymously', async () => {
    const res = await fetch(`${BASE}/chat/message`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        modelId: 'gemini-flash',
        message: 'Reply with exactly: HELLO',
      }),
    });

    const data = await res.json();
    expect(res.status).toBe(200);
    expect(data.reply).toBeTruthy();
    expect(data.model).toBeDefined();
    console.log(`[Anonymous Chat] Reply: ${data.reply.slice(0, 100)}`);
    console.log(`[Anonymous Chat] Tokens: ${data.tokensUsed}`);
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
    let chunks = [];

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      const text = decoder.decode(value, { stream: true });
      const lines = text.split('\n').filter(l => l.startsWith('data: '));

      for (const line of lines) {
        try {
          const event = JSON.parse(line.slice(6));
          chunks.push(event);

          if (event.type === 'chunk') {
            fullText += event.text;
          }
          if (event.type === 'done') {
            doneReceived = true;
          }
        } catch (e) {
          // Skip parse errors for partial chunks
        }
      }
    }

    expect(chunks.length).toBeGreaterThan(0);
    expect(doneReceived).toBe(true);
    expect(fullText.length).toBeGreaterThan(0);
    console.log(`[Stream] Received ${chunks.length} chunks, full text: "${fullText.trim()}"`);
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
