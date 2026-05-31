const { runChatPipeline } = require('../../services/chatPipeline.service');

describe('chatPipeline result shape', () => {
  it('returns stable shape on invalid model', async () => {
    const result = await runChatPipeline({
      modelId: 'does-not-exist',
      message: 'hello',
      isAnonymous: true,
      abortController: new AbortController(),
    });

    expect(result).toBeTruthy();
    expect(result.errorType).toBe('invalid_model');
    expect(result.err).toBeInstanceOf(Error);
    expect(result.userMessage).toContain('Unknown model');

    const requiredKeys = [
      'finalReply',
      'billableTokens',
      'totalAITokens',
      'totalEmbeddingTokens',
      'orchestratorBrain',
      'queryCacheHit',
      'cacheCreationTokens',
      'cacheReadTokens',
      'cacheHit',
      'generatedMediaFiles',
      'resolvedTopicId',
      'persistError',
      'estimatedInputTokens',
      'compressTokens',
      'historySummaryTokens',
      'modelConfig',
      'effectiveModelConfig',
      'isIdentityQuestion',
      'savedUserMessageId',
      'savedAssistantMessageId',
      'promptTokens',
      'err',
      'errorType',
      'userMessage',
      'suggestedModels',
      'recommendedModelId',
    ];

    for (const key of requiredKeys) {
      expect(Object.prototype.hasOwnProperty.call(result, key)).toBe(true);
    }
  });
});
