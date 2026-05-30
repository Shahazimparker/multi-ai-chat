describe('runToolLoop status events', () => {
  it('emits tool_loop status sequence across tool and final rounds', async () => {
    vi.resetModules();

    let callCount = 0;
    const dispatcher = require('../../services/ai/dispatcher.service');
    dispatcher.dispatchToAI = vi.fn();
    dispatcher.dispatchToAIStream = vi.fn(async (_model, _messages, _signal, onChunk) => {
      callCount += 1;
      if (callCount === 1) {
        onChunk('[WEB_SEARCH:query="x"]');
        return { text: '[WEB_SEARCH:query="x"]', tokensUsed: 5, cacheCreationTokens: 0, cacheReadTokens: 0 };
      }
      onChunk('Final ');
      onChunk('answer');
      return { text: 'Final answer', tokensUsed: 7, cacheCreationTokens: 0, cacheReadTokens: 0 };
    });

    const toolProcessor = require('../../services/toolProcessor.service');
    toolProcessor.processToolCall = vi.fn(async ({ reply }) => {
      if (reply.includes('[WEB_SEARCH:query="x"]')) {
        return {
          handled: true,
          newMessages: [
            { role: 'assistant', content: '[Searching web for "x"]' },
            { role: 'user', content: '[WEB SEARCH RESULTS]' },
          ],
          embedTokens: 0,
          generatedMedia: [],
        };
      }
      return { handled: false, newMessages: [], embedTokens: 0, generatedMedia: [] };
    });

    const { runToolLoop } = require('../../services/toolLoop.service');

    const statuses = [];
    const chunks = [];
    const result = await runToolLoop({
      effectiveModelConfig: { provider: 'test', model: 'test-model' },
      aiMessages: [{ role: 'user', content: 'hello' }],
      abortController: new AbortController(),
      processToolCallArgs: { onStatus: (event) => statuses.push(event) },
      promptBudget: { maxPromptTokens: 1000 },
      maxToolRounds: 3,
      onStreamChunk: (chunk) => chunks.push(chunk),
    });

    expect(result.aborted).toBe(false);
    expect(result.finalReply).toBe('Final answer');
    expect(chunks.join('')).toBe('Final answer');

    const toolLoopMessages = statuses
      .filter((event) => event.type === 'status' && event.tool === 'tool_loop')
      .map((event) => event.message);

    expect(toolLoopMessages).toEqual([
      'Thinking...',
      'Using tool and preparing response...',
      'Continuing with tool results...',
    ]);
  });
});
