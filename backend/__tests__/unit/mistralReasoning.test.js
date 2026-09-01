// FILE: backend/__tests__/unit/mistralReasoning.test.js
// PURPOSE: Guard the two Mistral contracts that fail silently.
//
// 1. THINKING CHUNKS. Mistral returns reasoning as ThinkChunk (type
//    "thinking", payload a nested LIST of TextChunks). Matching the wrong
//    discriminator, or reading `.text` off the chunk instead of walking
//    `.thinking[]`, produces no error and no output — the trace just vanishes
//    and the feature looks unimplemented rather than broken.
//
// 2. THE OUTPUT BUDGET. `max_tokens` sent to the provider and the tokens
//    contextWindow.service.js holds back are two halves of one contract. If
//    they drift, either a full prompt plus a full answer overflows the window,
//    or prompt space is reserved for an answer that can never use it. Nothing
//    at runtime notices either.

const { EventEmitter } = require('events');
const axios = require('axios');

const { callMistral, callMistralStream } = require('../../services/ai/mistral.service');
const { createContextWindow, outputCapFor } = require('../../services/contextWindow.service');
const { MODELS } = require('../../config/models');

const SMALL = MODELS['mistral-small'];
const MSGS = [{ role: 'user', content: 'hi' }];

const okResponse = (content) => ({
  data: { choices: [{ message: { content } }], usage: { total_tokens: 10 } },
});

/** Drives the SSE reader the way axios' stream response does. */
const runStream = async (frames, { modelConfig = SMALL, reasoningRequest = {} } = {}) => {
  const stream = new EventEmitter();
  stream.destroy = () => {};
  vi.spyOn(axios, 'post').mockResolvedValue({ data: stream });

  const chunks = [];
  const reasoning = [];
  const promise = callMistralStream(
    'mistral-small-latest', 'k', MSGS, null,
    (t) => chunks.push(t), (t) => reasoning.push(t),
    modelConfig, reasoningRequest,
  );

  // Let the mocked axios.post resolve so the 'data' listener is attached.
  await new Promise((r) => setImmediate(r));
  stream.emit('data', Buffer.from(frames.map((f) => `data: ${JSON.stringify(f)}\n`).join('')));
  stream.emit('end');

  return { result: await promise, chunks, reasoning, body: axios.post.mock.calls[0][1] };
};

const think = (text) => ({ type: 'thinking', thinking: [{ type: 'text', text }] });

describe('Mistral — thinking chunks', () => {
  beforeEach(() => vi.restoreAllMocks());

  it('streams a ThinkChunk to onReasoning, never into the answer', async () => {
    const { result, chunks, reasoning } = await runStream([
      { choices: [{ delta: { content: [think('Let me think.')] } }] },
      { choices: [{ delta: { content: [think(' Done.'), { type: 'text', text: 'Answer' }] } }] },
      { choices: [{ delta: { content: ' continues.' } }] },
    ], { reasoningRequest: { thinkingEnabled: true } });

    expect(reasoning.join('')).toBe('Let me think. Done.');
    expect(result.reasoning).toBe('Let me think. Done.');
    // The trace must not leak into the answer — that is the corruption the
    // wrong discriminator would have caused had the else-branch matched.
    expect(result.text).toBe('Answer continues.');
    expect(chunks.join('')).toBe('Answer continues.');
  });

  it('handles the plain-string answer phase unchanged', async () => {
    const { result } = await runStream([
      { choices: [{ delta: { content: 'plain' } }] },
    ]);
    expect(result.text).toBe('plain');
    expect(result.reasoning).toBe('');
  });

  it('splits a non-streaming chunk list instead of returning the array', async () => {
    vi.spyOn(axios, 'post').mockResolvedValue(
      okResponse([think('thought'), { type: 'text', text: 'answer' }])
    );

    const r = await callMistral('mistral-small-latest', 'k', MSGS, null, {}, SMALL);

    // Returning content raw handed RAG/summary/RAPTOR/vision an array.
    expect(typeof r.text).toBe('string');
    expect(r.text).toBe('answer');
    expect(r.reasoning).toBe('thought');
  });
});

describe('Mistral — reasoning_effort', () => {
  beforeEach(() => vi.restoreAllMocks());

  it('sends "none" when thinking is off, rather than omitting the field', async () => {
    vi.spyOn(axios, 'post').mockResolvedValue(okResponse('ok'));
    await callMistral('mistral-small-latest', 'k', MSGS, null, {}, SMALL, { thinkingEnabled: false });
    // Omitting it would inherit the hybrid model's own default, not assert off.
    expect(axios.post.mock.calls[0][1].reasoning_effort).toBe('none');
  });

  it('thinks by default on mistral-small when the request says nothing', async () => {
    vi.spyOn(axios, 'post').mockResolvedValue(okResponse('ok'));
    // enabledByDefault — a bare API call must match what the UI would send,
    // and the UI toggle starts on for this model.
    await callMistral('mistral-small-latest', 'k', MSGS, null, {}, SMALL);
    expect(axios.post.mock.calls[0][1].reasoning_effort).toBe('high');
  });

  it('sends "high" when thinking is on', async () => {
    vi.spyOn(axios, 'post').mockResolvedValue(okResponse('ok'));
    await callMistral('mistral-small-latest', 'k', MSGS, null, {}, SMALL, { thinkingEnabled: true });
    expect(axios.post.mock.calls[0][1].reasoning_effort).toBe('high');
  });

  it('omits the field entirely for a model that cannot reason', async () => {
    vi.spyOn(axios, 'post').mockResolvedValue(okResponse('ok'));
    // mistral-medium-2508 is Medium 3.1; sending reasoning_effort 400s.
    await callMistral('mistral-medium-2508', 'k', MSGS, null, {}, MODELS['mistral-medium'], { thinkingEnabled: true });
    expect(axios.post.mock.calls[0][1]).not.toHaveProperty('reasoning_effort');
  });

  it('never sends a level Mistral rejects', async () => {
    vi.spyOn(axios, 'post').mockResolvedValue(okResponse('ok'));
    // A stale client asking for "medium" must not reach the API — only
    // "high" and "none" exist.
    await callMistral('mistral-small-latest', 'k', MSGS, null, {}, SMALL, {
      thinkingEnabled: true, reasoningEffort: 'medium',
    });
    expect(['high', 'none']).toContain(axios.post.mock.calls[0][1].reasoning_effort);
  });
});

describe('Mistral — output budget', () => {
  beforeEach(() => vi.restoreAllMocks());

  it('sends max_tokens matching what the context fitter reserves', async () => {
    vi.spyOn(axios, 'post').mockResolvedValue(okResponse('ok'));
    await callMistral('mistral-small-latest', 'k', MSGS, null, {}, SMALL);

    // The contract. These two numbers drifting apart is the bug this guards.
    expect(axios.post.mock.calls[0][1].max_tokens)
      .toBe(createContextWindow(SMALL).reservedOutputTokens);
  });

  it('sends max_tokens on the streaming path too', async () => {
    const { body } = await runStream([{ choices: [{ delta: { content: 'x' } }] }]);
    expect(body.max_tokens).toBe(createContextWindow(SMALL).reservedOutputTokens);
    // Unbounded output is what lets one reasoning trace eat a whole minute of
    // mistral-small's 50,000 free TPM.
    expect(body.max_tokens).toBeGreaterThan(0);
  });

  it('gives every Mistral model a budget that fits its window', () => {
    const mistralModels = Object.entries(MODELS).filter(([, m]) => m.provider === 'mistral');
    expect(mistralModels.length).toBeGreaterThan(0);

    for (const [id, config] of mistralModels) {
      expect(config.maxOutputTokens, `${id} declares no answer budget`).toBeGreaterThan(0);
      // Half the window, enforced in contextWindow.service.js. A budget past
      // this leaves less room for the question than for the answer.
      expect(config.maxOutputTokens, `${id} budget exceeds half its window`)
        .toBeLessThanOrEqual(Math.floor(config.maxTokens * 0.5));
      expect(outputCapFor(config)).toBe(config.maxOutputTokens);
    }
  });

  it('keeps the historical cap for bare internal-chain configs', async () => {
    vi.spyOn(axios, 'post').mockResolvedValue(okResponse('ok'));
    // summary/RAPTOR/GraphRAG/vision/queryTransform build these by hand with no
    // window. Deriving from outputCapFor's 8000 default would reserve 2000 and
    // truncate extractions that previously got 16000.
    const bare = { provider: 'mistral', model: 'mistral-small-latest', apiKey: 'k' };
    await callMistral('mistral-small-latest', 'k', MSGS, null, {}, bare);
    expect(axios.post.mock.calls[0][1].max_tokens).toBe(16000);
  });

  it('never lets one answer claim more than half a model free-tier minute', () => {
    // The rule the budgets are derived from: half the TPM for the answer, half
    // left for the prompt that provoked it. mistral-small and mistral-medium
    // are the two actually bound by TPM; for the rest the half-window bound is
    // tighter.
    //
    // mistral-glm-5-2 is deliberately absent: its free-tier TPM is unconfirmed,
    // and a number nobody checked would assert nothing while looking like it did.
    const FREE_TIER_TPM = {
      'mistral-small': 50000,
      // Medium 3.5 dropped to 25,000 TPM free, down from Medium 3.1's 356,250 --
      // see the note beside maxOutputTokens in config/models.js.
      'mistral-medium': 25000,
      'mistral-large': 250000,
      'ministral-14b': 937500,
      'codestral-2508': 625000,
    };

    for (const [id, tpm] of Object.entries(FREE_TIER_TPM)) {
      expect(MODELS[id], `${id} missing from the registry`).toBeDefined();
      expect(outputCapFor(MODELS[id]), `${id} can claim over half its minute`)
        .toBeLessThanOrEqual(tpm / 2);
    }
  });

  it('gives mistral-small exactly half its 50,000 TPM', () => {
    // The one model where TPM binds, and the one where thinking is on by
    // default — so its trace bills as output on top of the answer.
    expect(outputCapFor(SMALL)).toBe(25000);
  });
});

describe('createContextWindow — per-model reserve', () => {
  it('honours maxOutputTokens over the flat default', () => {
    const w = createContextWindow({ maxTokens: 128000, maxOutputTokens: 32000 });
    expect(w.reservedOutputTokens).toBe(32000);
  });

  it('falls back to the flat reserve when a model declares none', () => {
    expect(createContextWindow({ maxTokens: 128000 }).reservedOutputTokens).toBe(8192);
  });

  it('never reserves more than half the window', () => {
    const w = createContextWindow({ maxTokens: 10000, maxOutputTokens: 90000 });
    expect(w.reservedOutputTokens).toBe(5000);
  });

  it('keeps prompt + reserve + margin inside the window', () => {
    const w = createContextWindow({ maxTokens: 128000, maxOutputTokens: 32000 });
    expect(w.hardCeiling + w.safetyMarginTokens + w.reservedOutputTokens).toBeLessThanOrEqual(128000);
  });
});
