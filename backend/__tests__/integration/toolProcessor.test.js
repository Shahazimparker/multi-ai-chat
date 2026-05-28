// vitest globals: describe, it, expect, vi, beforeEach
// NOTE: supabase is mocked globally in setup.js
// These tests verify processToolCall logic paths

const { processToolCall } = require('../../services/toolProcessor.service');

describe('processToolCall', () => {
  const baseArgs = {
    reply: '',
    aiMessages: [],
    user: null,
    topicId: null,
    abortController: new AbortController(),
    fetchedSchemaTables: new Set(),
    consecutiveZeroResults: 0,
    dbQueryCount: 0,
  };

  describe('no tool match', () => {
    it('returns handled: false for normal text', async () => {
      const result = await processToolCall({
        ...baseArgs,
        reply: 'This is a normal response with no tool calls.',
      });

      expect(result.handled).toBe(false);
    });
  });

  describe('bare close tag detection', () => {
    it('detects and handles bare [/QUERY_DB]', async () => {
      const result = await processToolCall({
        ...baseArgs,
        reply: '[/QUERY_DB]',
      });

      expect(result.handled).toBe(true);
      expect(result.newMessages[1].content).toContain('closing tag');
    });
  });

  describe('tool tag matching', () => {
    it('matches SEARCH_FILES tag pattern', async () => {
      const result = await processToolCall({
        ...baseArgs,
        reply: '[SEARCH_FILES:query=test query]',
      });
      expect(result.handled).toBe(true);
    });

    it('matches GET_FILE tag pattern', async () => {
      const result = await processToolCall({
        ...baseArgs,
        reply: '[GET_FILE:id=test-id]',
      });
      expect(result.handled).toBe(true);
    });

    it('matches WEB_SEARCH tag pattern', async () => {
      const result = await processToolCall({
        ...baseArgs,
        reply: '[WEB_SEARCH:query="test"]',
      });
      expect(result.handled).toBe(true);
    });

    it('matches EXECUTE_CODE tag pattern', async () => {
      const result = await processToolCall({
        ...baseArgs,
        reply: '[EXECUTE_CODE]1+1[/EXECUTE_CODE]',
      });
      expect(result.handled).toBe(true);
    });
  });
});
