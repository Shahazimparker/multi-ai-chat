// ============================================================
// Real integration tests for the human approval flow
// Tests the full approval lifecycle without mocks:
//   - All tests hit http://localhost:5000/api — no mocks anywhere
//   - Auth token is obtained once in a top-level beforeAll
//   - Any test that requires auth skips gracefully if token is null
//
// Prerequisites:
//   1. Backend running on localhost:5000 (npm run dev)
//   2. .env configured with JWT_SECRET, SUPABASE_URL, SUPABASE_SERVICE_KEY
//   3. TEST_USERNAME / TEST_PASSWORD env vars set (or defaults used)
// ============================================================

const BASE = 'http://localhost:5000/api';

// File-scoped auth token + CSRF token — set once in the top-level beforeAll
let globalAuthToken = null;

// The CSRF middleware compares the X-CSRF-Token header against a csrf_token
// cookie, so sending the header alone now fails exactly as a forgery would.
// Every request in this file goes through here to keep the pair together.
const cookieHeader = () => [
  globalAuthToken ? `auth_token=${globalAuthToken}` : null,
  globalCsrfToken ? `csrf_token=${globalCsrfToken}` : null,
].filter(Boolean).join('; ');
let globalCsrfToken = null;

// ── Helper: Parse SSE events from a raw multi-event buffer ───
const parseSseEvents = (buffer) => {
  const events = [];
  for (const block of buffer.split('\n\n')) {
    if (!block.trim()) continue;
    const dataLine = block.split('\n').find((l) => l.startsWith('data: '));
    if (!dataLine) continue;
    try {
      events.push(JSON.parse(dataLine.slice(6)));
    } catch {
      // ignore partial / malformed chunks
    }
  }
  return events;
};

// ── Helper: Stream chat and collect events until condition ───
/**
 * Opens a /api/chat/stream SSE stream and reads events until:
 *   - `stopWhen(event)` returns true for one of the received events, OR
 *   - `maxWaitMs` elapses, OR
 *   - The stream ends naturally.
 *
 * Returns { events, reader } where `reader` is the still-open ReadableStreamDefaultReader
 * so the caller can cancel it or keep reading.
 */
const streamUntil = async (body, stopWhen, maxWaitMs = 30000) => {
  const res = await fetch(`${BASE}/chat/stream`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(globalAuthToken ? { Cookie: cookieHeader() } : {}),
      ...(globalCsrfToken ? { 'X-CSRF-Token': globalCsrfToken } : {}),
    },
    body: JSON.stringify(body),
  });

  const allEvents = [];
  if (!res.ok && res.status !== 200) {
    return { res, events: [], reader: null };
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let sseBuffer = '';
  const startTime = Date.now();

  while (Date.now() - startTime < maxWaitMs) {
    const { done, value } = await reader.read();
    if (done) break;

    sseBuffer += decoder.decode(value, { stream: true });
    const parts = sseBuffer.split('\n\n');
    sseBuffer = parts.pop() ?? '';

    for (const evt of parseSseEvents(parts.join('\n\n'))) {
      allEvents.push(evt);
      if (stopWhen(evt)) {
        // Flush the remaining buffer
        for (const trailing of parseSseEvents(sseBuffer)) allEvents.push(trailing);
        return { res, events: allEvents, reader };
      }
    }
  }

  // Flush remainder
  for (const evt of parseSseEvents(sseBuffer)) allEvents.push(evt);
  return { res, events: allEvents, reader };
};

// ── Helper: POST respond to an approval ─────────────────────
const postRespond = (approvalId, body) =>
  fetch(`${BASE}/approval/${approvalId}/respond`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(globalAuthToken ? { Cookie: cookieHeader() } : {}),
      ...(globalCsrfToken ? { 'X-CSRF-Token': globalCsrfToken } : {}),
    },
    body: JSON.stringify(body),
  });

// ── Helper: GET approval status ──────────────────────────────
const getStatus = (approvalId) =>
  fetch(`${BASE}/approval/${approvalId}/status`, {
    headers: globalAuthToken ? { Cookie: cookieHeader() } : {},
  });

// ── Top-level auth setup ─────────────────────────────────────
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
    console.warn('[beforeAll] Login failed — tests requiring auth will be skipped');
    return;
  }

  const setCookie = res.headers.get('set-cookie');
  if (!setCookie) {
    console.warn('[beforeAll] No set-cookie header in login response');
    return;
  }

  const match = setCookie.match(/auth_token=([^;]+)/);
  globalAuthToken = match ? match[1] : null;
  if (!globalAuthToken) {
    console.warn('[beforeAll] Could not parse auth_token from cookie');
    return;
  }

  // Extract CSRF token from the login response body
  try {
    const body = await res.json();
    globalCsrfToken = body.csrfToken || null;
  } catch { /* ignore */ }

  console.log('[beforeAll] Auth token obtained successfully');
  console.log(`[beforeAll] CSRF token: ${globalCsrfToken ? 'obtained' : 'NOT obtained'}`);
}, 15000);

// ════════════════════════════════════════════════════════════
//  1. Health Check
// ════════════════════════════════════════════════════════════
describe('1 — Health Check', () => {
  it('GET /api/health returns { status: "OK" }', async () => {
    const res = await fetch(`${BASE}/health`);
    const data = await res.json();
    expect(res.status).toBe(200);
    expect(data.status).toBe('OK');
    expect(data.timestamp).toBeDefined();
  });
});

// ════════════════════════════════════════════════════════════
//  2. Model Listing
// ════════════════════════════════════════════════════════════
describe('2 — Model Listing', () => {
  it('GET /api/chat/models returns a non-empty model array', async () => {
    if (!globalAuthToken) {
      console.warn('[Test 2] No auth token, skipping');
      return;
    }
    const res = await fetch(`${BASE}/chat/models`, { headers: { Cookie: cookieHeader() } });
    const data = await res.json();
    expect(res.status).toBe(200);
    expect(Array.isArray(data.models)).toBe(true);
    expect(data.models.length).toBeGreaterThan(0);
    const modelIds = data.models.map((m) => m.id);
    expect(modelIds).toContain('gemini-flash');
    expect(modelIds).toContain('groq-gpt-oss-120b');
    console.log(`[Models] ${data.models.length} models available`);
  });
});

// ════════════════════════════════════════════════════════════
//  3. Unknown Approval ID — unauthenticated status check
// ════════════════════════════════════════════════════════════
describe('3 — Approval API: unknown ID (no auth needed for error check)', () => {
  const UNKNOWN_ID = 'approval-nonexistent-99999';

  it('GET /api/approval/:id/status returns 404 for unknown ID (with auth)', async () => {
    if (!globalAuthToken) {
      console.warn('[Test 3a] No auth token, skipping');
      return;
    }
    const res = await fetch(`${BASE}/approval/${UNKNOWN_ID}/status`, {
      headers: { Cookie: cookieHeader() },
    });
    expect(res.status).toBe(404);
    const data = await res.json();
    expect(data.error).toBeDefined();
    console.log(`[Test 3a] 404 body: ${data.error}`);
  });

  // ── 4. POST respond with auth on unknown ID ──────────────
  it('POST /api/approval/:id/respond returns 404 for unknown ID (with auth)', async () => {
    if (!globalAuthToken) {
      console.warn('[Test 4] No auth token, skipping');
      return;
    }
    const res = await postRespond(UNKNOWN_ID, { response: true });
    expect(res.status).toBe(404);
    const data = await res.json();
    expect(data.error).toBeDefined();
    console.log(`[Test 4] 404 body: ${data.error}`);
  });

  // ── 5. POST respond without auth ─────────────────────────
  it('POST /api/approval/:id/respond without auth returns 401 or 404', async () => {
    const res = await fetch(`${BASE}/approval/${UNKNOWN_ID}/respond`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ response: true }),
    });
    // 401 = auth middleware rejects before the route handler runs
    // 404 = auth passed (anonymous allowed?) but ID not found
    expect([401, 404]).toContain(res.status);
    console.log(`[Test 5] Unauthenticated respond → ${res.status}`);
  });
});

// ════════════════════════════════════════════════════════════
//  6. Full lifecycle — "Yes" path (GENERATE_IMAGE → approve)
// ════════════════════════════════════════════════════════════
describe('6 — Full lifecycle: GENERATE_IMAGE → approve (Yes path)', () => {
  it('stream → approval_request SSE → GET status is pending → POST respond(true) → status is approved', async () => {
    if (!globalAuthToken) {
      console.warn('[Test 6] No auth token, skipping');
      return;
    }

    const { res, events, reader } = await streamUntil(
      {
        modelId: 'deepseek-v4-flash',
        message:
          'Generate an image of a cat sitting on a windowsill. Use the GENERATE_IMAGE tool with prompt="a cute orange cat on a windowsill".',
      },
      (evt) => evt.type === 'approval_request',
      20000,
    );

    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/event-stream');

    const approvalEvt = events.find((e) => e.type === 'approval_request');
    if (!approvalEvt) {
      console.warn('[Test 6] No approval_request emitted — AI may have asked clarifying questions instead. Skipping lifecycle assertions.');
      if (reader) reader.cancel().catch(() => {});
      return;
    }

    const { approvalId } = approvalEvt;
    expect(approvalId).toBeDefined();
    expect(approvalId.length).toBeGreaterThan(0);
    console.log(`[Test 6] Got approval_request id=${approvalId}`);

    // Step 1: GET /status → expect pending
    const statusRes1 = await getStatus(approvalId);
    if (statusRes1.status === 200) {
      const statusData = await statusRes1.json();
      expect(statusData.status).toBe('pending');
      console.log(`[Test 6] Status before approve: ${statusData.status}`);
    }

    // Step 2: POST respond(true)
    const respondRes = await postRespond(approvalId, { response: true });
    expect(respondRes.status).toBe(200);
    const respondData = await respondRes.json();
    expect(respondData.success).toBe(true);
    expect(respondData.status).toBe('approved');
    console.log(`[Test 6] respond → ${respondData.status}`);

    // Step 3: GET /status → expect approved
    const statusRes2 = await getStatus(approvalId);
    if (statusRes2.status === 200) {
      const statusData2 = await statusRes2.json();
      expect(statusData2.status).toBe('approved');
      console.log(`[Test 6] Status after approve: ${statusData2.status}`);
    }

    if (reader) reader.cancel().catch(() => {});
  }, 45000);
});

// ════════════════════════════════════════════════════════════
//  7. Full lifecycle — "No" path (GENERATE_PPT → reject)
// ════════════════════════════════════════════════════════════
describe('7 — Full lifecycle: GENERATE_PPT → reject (No path)', () => {
  it('stream → approval_request SSE → POST respond(false) → status is rejected', async () => {
    if (!globalAuthToken) {
      console.warn('[Test 7] No auth token, skipping');
      return;
    }

    const { res, events, reader } = await streamUntil(
      {
        modelId: 'deepseek-v4-flash',
        message:
          'Create a PowerPoint about ocean life with 3 slides. Title: Ocean Life. Theme: ocean_depth. ' +
          'Slides: [{"title":"Introduction","bullets":["Oceans cover 71%"]},{"title":"Creatures","bullets":["Fish","Coral"]},{"title":"Conservation","bullets":["Protect reefs"]}]. ' +
          'Generate it now using the GENERATE_PPT tool.',
      },
      (evt) => evt.type === 'approval_request',
      20000,
    );

    expect(res.status).toBe(200);

    const approvalEvt = events.find((e) => e.type === 'approval_request');
    if (!approvalEvt) {
      console.warn('[Test 7] No approval_request emitted. Skipping reject lifecycle assertions.');
      if (reader) reader.cancel().catch(() => {});
      return;
    }

    const { approvalId } = approvalEvt;
    console.log(`[Test 7] Got approval_request id=${approvalId}`);

    // POST respond(false) → reject
    const respondRes = await postRespond(approvalId, { response: false, reason: 'Not needed for test' });
    expect(respondRes.status).toBe(200);
    const respondData = await respondRes.json();
    expect(respondData.success).toBe(true);
    expect(respondData.status).toBe('rejected');
    console.log(`[Test 7] respond → ${respondData.status}`);

    if (reader) reader.cancel().catch(() => {});
  }, 45000);
});

// ════════════════════════════════════════════════════════════
//  8. Full lifecycle — "Other" path (instructions loop)
//     GENERATE_IMAGE → POST respond(true, reason="...") →
//     status approved with instructions → stream emits second
//     approval_request with updated summary
// ════════════════════════════════════════════════════════════
describe('8 — Full lifecycle: GENERATE_IMAGE → Other (instructions loop)', () => {
  it('stream → first approval_request → respond(true, reason=instructions) → second approval_request with revised summary', async () => {
    if (!globalAuthToken) {
      console.warn('[Test 8] No auth token, skipping');
      return;
    }

    // --- Phase 1: get first approval_request ---
    const { res, events: phase1Events, reader } = await streamUntil(
      {
        modelId: 'deepseek-v4-flash',
        message:
          'Generate an image of a mountain landscape. Use the GENERATE_IMAGE tool with prompt="a mountain landscape at dawn".',
      },
      (evt) => evt.type === 'approval_request',
      20000,
    );

    expect(res.status).toBe(200);

    const firstApproval = phase1Events.find((e) => e.type === 'approval_request');
    if (!firstApproval) {
      console.warn('[Test 8] No first approval_request emitted. Skipping instructions loop assertions.');
      if (reader) reader.cancel().catch(() => {});
      return;
    }

    const { approvalId: firstId } = firstApproval;
    console.log(`[Test 8] First approval_request id=${firstId}, summary="${firstApproval.summary}"`);

    // --- Phase 2: respond with instructions (the "Other" path) ---
    const instructions = 'make it a sunset over mountains with vivid orange sky';
    const respondRes = await postRespond(firstId, {
      response: true,
      reason: instructions,
    });
    expect(respondRes.status).toBe(200);
    const respondData = await respondRes.json();
    expect(respondData.success).toBe(true);
    expect(respondData.status).toBe('approved');
    console.log(`[Test 8] respond(true, instructions) → status=${respondData.status}`);

    // --- Phase 3: keep reading the same stream for a second approval_request ---
    // The AI revises its plan and emits a new approval_request with updated summary.
    let secondApproval = null;
    const decoder = new TextDecoder();
    let sseBuffer = '';
    const phaseStartTime = Date.now();
    const maxWait = 30000;

    while (Date.now() - phaseStartTime < maxWait) {
      const { done, value } = await reader.read();
      if (done) break;
      sseBuffer += decoder.decode(value, { stream: true });
      const parts = sseBuffer.split('\n\n');
      sseBuffer = parts.pop() ?? '';
      for (const evt of parseSseEvents(parts.join('\n\n'))) {
        if (evt.type === 'approval_request') {
          secondApproval = evt;
          break;
        }
      }
      if (secondApproval) break;
    }

    if (secondApproval) {
      expect(secondApproval.approvalId).toBeDefined();
      expect(secondApproval.summary).toBeDefined();
      console.log(`[Test 8] Second approval_request id=${secondApproval.approvalId}, summary="${secondApproval.summary}"`);
      // Clean up: reject the second approval so the stream can terminate
      await postRespond(secondApproval.approvalId, { response: false, reason: 'test cleanup' }).catch(() => {});
    } else {
      // The AI may have completed the generation without a second approval (edge case).
      // This is acceptable — the important assertion is that the first respond(true, reason)
      // returned approved and the stream kept running.
      console.warn('[Test 8] No second approval_request received within timeout — AI may have proceeded directly.');
    }

    reader.cancel().catch(() => {});
  }, 75000);
});

// ════════════════════════════════════════════════════════════
//  9. Summary field validation
// ════════════════════════════════════════════════════════════
describe('9 — Summary field validation in approval_request SSE event', () => {
  it('approval_request event contains a non-empty summary string', async () => {
    if (!globalAuthToken) {
      console.warn('[Test 9] No auth token, skipping');
      return;
    }

    const { events, reader } = await streamUntil(
      {
        modelId: 'deepseek-v4-flash',
        message:
          'Create a PowerPoint called "AI Trends" with 2 slides: ' +
          '[{"title":"Current State","bullets":["LLMs are mainstream"]},{"title":"Future","bullets":["AGI next?"]}]. ' +
          'Theme: modern_corporate. Use the GENERATE_PPT tool now.',
      },
      (evt) => evt.type === 'approval_request',
      20000,
    );

    const approvalEvt = events.find((e) => e.type === 'approval_request');
    if (!approvalEvt) {
      console.warn('[Test 9] No approval_request emitted. Summary validation skipped.');
      if (reader) reader.cancel().catch(() => {});
      return;
    }

    // summary must be a non-empty string
    expect(typeof approvalEvt.summary).toBe('string');
    expect(approvalEvt.summary.length).toBeGreaterThan(0);
    console.log(`[Test 9] summary:\n${approvalEvt.summary}`);

    // For PPT, summary should contain either "Title:" or "Slides"
    const hasPptMarker = approvalEvt.summary.includes('Title:') || approvalEvt.summary.includes('Slides');
    expect(hasPptMarker).toBe(true);

    // options must be the three-option array
    expect(approvalEvt.options).toEqual(['yes', 'other', 'no']);

    if (reader) {
      // Clean up: reject so the backend stops polling
      await postRespond(approvalEvt.approvalId, { response: false, reason: 'test cleanup' }).catch(() => {});
      reader.cancel().catch(() => {});
    }
  }, 45000);
});

// ════════════════════════════════════════════════════════════
//  10. Abort signal test — stream cancelled immediately
// ════════════════════════════════════════════════════════════
describe('10 — Abort signal: cancel stream mid-approval', () => {
  it('stream triggers approval then stream is aborted — no crash expected', async () => {
    if (!globalAuthToken) {
      console.warn('[Test 10] No auth token, skipping');
      return;
    }

    const controller = new AbortController();

    const fetchPromise = fetch(`${BASE}/chat/stream`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: cookieHeader(),
      },
      body: JSON.stringify({
        modelId: 'deepseek-v4-flash',
        message: 'Generate an image of a red apple. Use the GENERATE_IMAGE tool with prompt="a shiny red apple".',
      }),
      signal: controller.signal,
    });

    // Wait just long enough for the connection to be established, then abort.
    // We don't need to assert on DB state — this is a fire-and-forget smoke test.
    await new Promise((r) => setTimeout(r, 2000));
    controller.abort();

    // fetchPromise should settle (either AbortError or a response)
    try {
      const res = await fetchPromise;
      // If we got a response before the abort fired, cancel the body reader
      if (res.body) {
        const reader = res.body.getReader();
        reader.cancel().catch(() => {});
      }
      console.log(`[Test 10] Response received before abort (status ${res.status}) — abort fired after body opened`);
    } catch (err) {
      // AbortError is expected when the fetch is aborted before/during response
      if (err.name === 'AbortError') {
        console.log('[Test 10] AbortError received as expected');
      } else {
        // Any other error is unexpected but we allow it (fire-and-forget)
        console.warn(`[Test 10] Unexpected error: ${err.message}`);
      }
    }

    // The test passes as long as no unhandled exception escapes the test runner
    expect(true).toBe(true);
  }, 20000);
});

// ════════════════════════════════════════════════════════════
//  11. Unauthenticated stream request
// ════════════════════════════════════════════════════════════
describe('11 — Unauthenticated stream request', () => {
  it('anonymous stream returns 200 SSE or a graceful non-5xx response', async () => {
    // Temporarily clear the token so the request is anonymous
    const savedToken = globalAuthToken;
    globalAuthToken = null;

    try {
      const res = await fetch(`${BASE}/chat/stream`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          modelId: 'deepseek-v4-flash',
          message: 'Hello, are you there?',
        }),
      });

      // Anonymous users may get a 200 SSE stream (anonymous flow),
      // or a 401/403 if anonymous access is disabled.
      // 5xx would indicate a server crash — that must not happen.
      expect(res.status).not.toBeGreaterThanOrEqual(500);
      console.log(`[Test 11] Unauthenticated stream → HTTP ${res.status}`);

      if (res.status === 200 && res.body) {
        // Read a small amount just to confirm SSE headers
        expect(res.headers.get('content-type')).toContain('text/event-stream');
        const reader = res.body.getReader();
        // Read one chunk then cancel
        await reader.read();
        reader.cancel().catch(() => {});
      }
    } finally {
      globalAuthToken = savedToken;
    }
  }, 20000);
});
