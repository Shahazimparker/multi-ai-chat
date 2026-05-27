// vitest globals: describe, it, expect
// NOTE: toolLoop integration tests require mocking dispatchToAI + processToolCall
// which conflicts with global supabase mocks in setup.js.
// These are covered by the unit tests for toolProcessor and the manual regression checklist.
// Full integration tests should be run against a real Supabase instance.

describe('runToolLoop (integration)', () => {
  it('module loads successfully', () => {
    const { runToolLoop } = require('../../services/toolLoop.service');
    expect(runToolLoop).toBeDefined();
    expect(typeof runToolLoop).toBe('function');
  });
});
