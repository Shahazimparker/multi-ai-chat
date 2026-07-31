// vitest globals: describe, it, expect

const { buildGeminiHistory, buildGeminiRequest } = require('../../services/ai/gemini.service');

describe('buildGeminiHistory', () => {
  it('drops system messages', () => {
    const history = buildGeminiHistory([
      { role: 'system', content: 'You are helpful.' },
      { role: 'user', content: 'hi' },
      { role: 'assistant', content: 'hello' },
    ]);
    expect(history).toEqual([
      { role: 'user', parts: [{ text: 'hi' }] },
      { role: 'model', parts: [{ text: 'hello' }] },
    ]);
  });

  it('drops leading model turns so history starts with a user turn', () => {
    const history = buildGeminiHistory([
      { role: 'system', content: 'sys' },
      { role: 'assistant', content: '[Conversation summary] ...' },
      { role: 'user', content: 'hi' },
    ]);
    expect(history[0]).toEqual({ role: 'user', parts: [{ text: 'hi' }] });
  });

  it('returns empty history when only model turns precede the query', () => {
    expect(buildGeminiHistory([{ role: 'assistant', content: 'orphaned reply' }])).toEqual([]);
  });

  it('merges consecutive same-role turns to keep strict alternation', () => {
    const history = buildGeminiHistory([
      { role: 'user', content: 'a' },
      { role: 'user', content: 'b' },
      { role: 'assistant', content: 'c' },
      { role: 'assistant', content: 'd' },
      { role: 'user', content: 'e' },
    ]);
    expect(history.map(h => h.role)).toEqual(['user', 'model', 'user']);
    expect(history[0].parts).toEqual([{ text: 'a' }, { text: 'b' }]);
  });

  it('converts image content parts to inlineData', () => {
    const history = buildGeminiHistory([
      {
        role: 'user',
        content: [
          { type: 'text', text: 'what is this' },
          { type: 'image_url', image_url: { url: 'data:image/png;base64,AAAB' } },
        ],
      },
      { role: 'assistant', content: 'a cat' },
    ]);
    expect(history[0].parts).toEqual([
      { text: 'what is this' },
      { inlineData: { mimeType: 'image/png', data: 'AAAB' } },
    ]);
  });
});

describe('buildGeminiRequest', () => {
  it('splits the trailing user turn out as the outgoing message', () => {
    const { history, message } = buildGeminiRequest([
      { role: 'system', content: 'sys' },
      { role: 'user', content: 'hi' },
      { role: 'assistant', content: 'hello' },
      { role: 'user', content: 'how are you' },
    ]);
    expect(history.map(h => h.role)).toEqual(['user', 'model']);
    expect(message).toEqual([{ text: 'how are you' }]);
  });

  it('handles a summary-only history followed by the current query', () => {
    const { history, message } = buildGeminiRequest([
      { role: 'system', content: 'sys' },
      { role: 'assistant', content: 'prior answer with no matching question' },
      { role: 'user', content: 'hi' },
    ]);
    expect(history).toEqual([]);
    expect(message).toEqual([{ text: 'hi' }]);
  });

  it('never returns an empty outgoing message', () => {
    const { message } = buildGeminiRequest([{ role: 'system', content: 'sys' }]);
    expect(message).toEqual([{ text: ' ' }]);
  });
});
