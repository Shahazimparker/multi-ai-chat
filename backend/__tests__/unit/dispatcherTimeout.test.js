const MODULES = [
  '../../config/chatRuntime.config',
  '../../services/ai/dispatcher.service',
  '../../services/ai/gemini.service',
];

// The dispatcher reads AI_CALL_TIMEOUT_MS at load, so each case re-requires it
// with the env it needs. vi.resetModules() does not clear the CommonJS require
// cache here, so the entries are dropped explicitly.
const loadDispatcher = (timeoutMs, geminiImpl, geminiStreamImpl) => {
  vi.resetModules();
  for (const modulePath of MODULES) {
    delete require.cache[require.resolve(modulePath)];
  }

  if (timeoutMs === undefined) delete process.env.AI_CALL_TIMEOUT_MS;
  else process.env.AI_CALL_TIMEOUT_MS = String(timeoutMs);

  const gemini = require('../../services/ai/gemini.service');
  if (geminiImpl) gemini.callGemini = vi.fn(geminiImpl);
  if (geminiStreamImpl) gemini.callGeminiStream = vi.fn(geminiStreamImpl);

  return require('../../services/ai/dispatcher.service');
};

const modelConfig = { provider: 'gemini', model: 'test-model', apiKey: 'k' };

describe('dispatcher provider timeout', () => {
  const originalTimeout = process.env.AI_CALL_TIMEOUT_MS;

  afterEach(() => {
    if (originalTimeout === undefined) delete process.env.AI_CALL_TIMEOUT_MS;
    else process.env.AI_CALL_TIMEOUT_MS = originalTimeout;
  });

  it('rejects with a timeout error when a provider never settles', async () => {
    const { dispatchToAI } = loadDispatcher(30, () => new Promise(() => {}));

    await expect(dispatchToAI(modelConfig, [{ role: 'user', content: 'hi' }]))
      .rejects.toThrow(/timeout after 30ms/);
  });

  it('leaves the caller AbortController untouched on timeout', async () => {
    const { dispatchToAI } = loadDispatcher(30, () => new Promise(() => {}));
    const controller = new AbortController();

    await expect(dispatchToAI(modelConfig, [], controller.signal)).rejects.toThrow(/timeout/);

    // chatPipeline treats a tripped controller as a user cancellation and
    // returns silently, so a timeout must never abort it.
    expect(controller.signal.aborted).toBe(false);
  });

  it('produces a message classifyError maps to the timeout type', async () => {
    const { dispatchToAI } = loadDispatcher(30, () => new Promise(() => {}));
    const { classifyError } = require('../../services/chatCleanup.service');

    const err = await dispatchToAI(modelConfig, []).catch((e) => e);

    expect(classifyError(err.message).errorType).toBe('timeout');
  });

  it('reports a provider abort as a timeout, not a cancellation', async () => {
    // Mimics an SDK that honours the signal: it rejects with AbortError once the
    // internal timeout controller fires. That must not read as a user stop.
    const { dispatchToAI } = loadDispatcher(30, (_m, _k, _msgs, signal) =>
      new Promise((_resolve, reject) => {
        const fail = () => {
          const err = new Error('The operation was aborted');
          err.name = 'AbortError';
          reject(err);
        };
        // Real SDKs check the flag before subscribing; a signal already aborted
        // fires no further event.
        if (signal?.aborted) fail();
        else signal?.addEventListener('abort', fail);
      })
    );

    const err = await dispatchToAI(modelConfig, []).catch((e) => e);

    expect(err.name).not.toBe('AbortError');
    expect(err.message).toMatch(/timeout/);
  });

  it('passes a genuine user cancellation through unchanged', async () => {
    const { dispatchToAI } = loadDispatcher(5000, (_m, _k, _msgs, signal) =>
      new Promise((_resolve, reject) => {
        const fail = () => {
          const err = new Error('The operation was aborted');
          err.name = 'AbortError';
          reject(err);
        };
        // Real SDKs check the flag before subscribing; a signal already aborted
        // fires no further event.
        if (signal?.aborted) fail();
        else signal?.addEventListener('abort', fail);
      })
    );

    const controller = new AbortController();
    const pending = dispatchToAI(modelConfig, [], controller.signal).catch((e) => e);
    controller.abort();

    const err = await pending;
    expect(err.name).toBe('AbortError');
  });

  it('resolves normally when the provider answers in time', async () => {
    const { dispatchToAI } = loadDispatcher(5000, async () => ({ text: 'ok', tokensUsed: 3 }));

    await expect(dispatchToAI(modelConfig, [])).resolves.toEqual({ text: 'ok', tokensUsed: 3 });
  });

  it('does not time out a slow stream that keeps sending chunks', async () => {
    // Total runtime (~90ms) exceeds the 40ms cap, but no single gap does.
    const { dispatchToAIStream } = loadDispatcher(40, null, async (_m, _k, _msgs, _s, onChunk) => {
      for (const part of ['a', 'b', 'c', 'd', 'e', 'f']) {
        await new Promise((resolve) => setTimeout(resolve, 15));
        onChunk(part);
      }
      return { text: 'abcdef', tokensUsed: 6 };
    });

    const chunks = [];
    const result = await dispatchToAIStream(modelConfig, [], null, (c) => chunks.push(c));

    expect(result.text).toBe('abcdef');
    expect(chunks.join('')).toBe('abcdef');
  });

  it('times out a stream that stalls between chunks', async () => {
    const { dispatchToAIStream } = loadDispatcher(40, null, async (_m, _k, _msgs, _s, onChunk) => {
      onChunk('start');
      await new Promise(() => {}); // never sends another delta
    });

    await expect(dispatchToAIStream(modelConfig, [], null, () => {}))
      .rejects.toThrow(/timeout after 40ms/);
  });

  it('skips the timeout entirely when disabled', async () => {
    const { dispatchToAI } = loadDispatcher(0, async () => {
      await new Promise((resolve) => setTimeout(resolve, 50));
      return { text: 'slow but fine', tokensUsed: 1 };
    });

    await expect(dispatchToAI(modelConfig, [])).resolves.toEqual({
      text: 'slow but fine',
      tokensUsed: 1,
    });
  });

  it('still reports an unknown provider rather than hanging', async () => {
    const { dispatchToAI } = loadDispatcher(5000);

    await expect(dispatchToAI({ provider: 'nope', model: 'm', apiKey: 'k' }, []))
      .rejects.toThrow(/Unknown AI provider: nope/);
  });
});

