describe('runToolLoop time budget', () => {
  // vi.resetModules() alone does not clear the CommonJS require cache, so a
  // second load in the same file would reuse the previous test's mocks. Drop the
  // entries explicitly, as chatRuntime.config.test.js does.
  const freshModules = [
    '../../services/ai/dispatcher.service',
    '../../services/toolProcessor.service',
    '../../services/toolLoop.service',
  ];

  const loadWithDispatcher = (dispatchImpl, toolImpl) => {
    vi.resetModules();
    for (const modulePath of freshModules) {
      delete require.cache[require.resolve(modulePath)];
    }

    const dispatcher = require('../../services/ai/dispatcher.service');
    dispatcher.dispatchToAI = vi.fn();
    dispatcher.dispatchToAIStream = vi.fn(dispatchImpl);

    const toolProcessor = require('../../services/toolProcessor.service');
    toolProcessor.processToolCall = vi.fn(toolImpl);

    return require('../../services/toolLoop.service');
  };

  const alwaysToolCall = async (_model, _messages, _signal, onChunk) => {
    onChunk('[WEB_SEARCH:query="x"]');
    return { text: '[WEB_SEARCH:query="x"]', tokensUsed: 5, cacheCreationTokens: 0, cacheReadTokens: 0 };
  };

  const handleToolCall = async () => ({
    handled: true,
    newMessages: [
      { role: 'assistant', content: '[Searching web for "x"]' },
      { role: 'user', content: '[WEB SEARCH RESULTS]' },
    ],
    embedTokens: 0,
    generatedMedia: [],
  });

  it('stops before a new round once the deadline has passed', async () => {
    const { runToolLoop } = loadWithDispatcher(alwaysToolCall, handleToolCall);

    const result = await runToolLoop({
      effectiveModelConfig: { provider: 'test', model: 'test-model' },
      aiMessages: [{ role: 'user', content: 'hello' }],
      abortController: new AbortController(),
      processToolCallArgs: {},
      promptBudget: { maxPromptTokens: 1000 },
      maxToolRounds: 6,
      deadlineAt: Date.now() - 1, // already expired
      onStreamChunk: () => {},
    });

    expect(result.timedOut).toBe(true);
    // Round 0 always runs so there is a reply to fall back on; the expired
    // deadline stops the loop before round 1 rather than using all 6 rounds.
    expect(result.roundsUsed).toBe(1);
  });

  it('reports streamedToClient false when every round ended in a tool call', async () => {
    const { runToolLoop } = loadWithDispatcher(alwaysToolCall, handleToolCall);

    const chunks = [];
    const result = await runToolLoop({
      effectiveModelConfig: { provider: 'test', model: 'test-model' },
      aiMessages: [{ role: 'user', content: 'hello' }],
      abortController: new AbortController(),
      processToolCallArgs: {},
      promptBudget: { maxPromptTokens: 1000 },
      maxToolRounds: 6,
      deadlineAt: Date.now() - 1,
      onStreamChunk: (chunk) => chunks.push(chunk),
    });

    // A handled tool call discards its buffered chunks, so nothing reached the
    // client — this is what tells the pipeline to emit the full reply itself.
    expect(result.streamedToClient).toBe(false);
    expect(chunks).toEqual([]);
  });

  it('reports streamedToClient true once a round flushes its buffer', async () => {
    const { runToolLoop } = loadWithDispatcher(
      async (_model, _messages, _signal, onChunk) => {
        onChunk('Final ');
        onChunk('answer');
        return { text: 'Final answer', tokensUsed: 7, cacheCreationTokens: 0, cacheReadTokens: 0 };
      },
      async () => ({ handled: false, newMessages: [], embedTokens: 0, generatedMedia: [] })
    );

    const chunks = [];
    const result = await runToolLoop({
      effectiveModelConfig: { provider: 'test', model: 'test-model' },
      aiMessages: [{ role: 'user', content: 'hello' }],
      abortController: new AbortController(),
      processToolCallArgs: {},
      promptBudget: { maxPromptTokens: 1000 },
      maxToolRounds: 6,
      onStreamChunk: (chunk) => chunks.push(chunk),
    });

    expect(result.streamedToClient).toBe(true);
    expect(result.timedOut).toBe(false);
    expect(chunks.join('')).toBe('Final answer');
  });

  it('runs every round when no deadline is supplied', async () => {
    const { runToolLoop } = loadWithDispatcher(alwaysToolCall, handleToolCall);

    const result = await runToolLoop({
      effectiveModelConfig: { provider: 'test', model: 'test-model' },
      aiMessages: [{ role: 'user', content: 'hello' }],
      abortController: new AbortController(),
      processToolCallArgs: {},
      promptBudget: { maxPromptTokens: 1000 },
      maxToolRounds: 3,
      onStreamChunk: () => {},
    });

    expect(result.timedOut).toBe(false);
    expect(result.roundsUsed).toBe(3);
  });
});
