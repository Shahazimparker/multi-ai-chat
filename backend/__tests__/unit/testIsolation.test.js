// ============================================================
// FILE: backend/__tests__/unit/testIsolation.test.js
// PURPOSE: Guard the unit suite against making real, billed API calls.
//
//   __tests__/setup.js loads the real .env so that non-secret config matches
//   production. That once left every unit test one un-stubbed call away from a
//   paid API — and three separate features shipped with stubs that silently
//   failed to intercept, passing their tests by making genuine requests. The
//   output looked identical either way, which is what made it dangerous.
//
//   setup.js now overwrites provider credentials with placeholders. This file
//   asserts that it still does, so the protection cannot be quietly removed.
// ============================================================

const PROVIDER_KEYS = [
  'OPENROUTER_API_KEY',
  'OPENAI_API_KEY',
  'ANTHROPIC_API_KEY',
  'GEMINI_API_KEY',
  'GEMINI_SUMMARY_API_KEY',
  'MISTRAL_API_KEY',
  'MISTRAL_SUMMARY_API_KEY',
  'GROQ_API_KEY',
  'COHERE_API_KEY',
  'DEEPSEEK_API_KEY',
  'FIRECRAWL_API_KEY',
  'EXA_API_KEY',
  'TAVILY_API_KEY',
  'SERPAPI_API_KEY',
  'LANGSEARCH_API_KEY',
  'PARALLEL_API_KEY',
];

describe('unit test isolation', () => {
  it.each(PROVIDER_KEYS)('%s is a placeholder, not a real credential', (key) => {
    const value = process.env[key];

    expect(value, `${key} should be set so "is provider configured" branches stay reachable`).toBeTruthy();
    expect(value, `${key} looks like a real credential — setup.js must overwrite it`).toMatch(/^test-/);
  });

  it('keeps every provider "configured" so those branches are still exercised', () => {
    // Deleting the keys instead of faking them would silently skip every
    // provider-enabled code path, which is the opposite of useful.
    for (const key of PROVIDER_KEYS) {
      expect(Boolean(process.env[key])).toBe(true);
    }
  });

  it('does not leave a usable OpenRouter key in the unit environment', () => {
    // Real OpenRouter keys start with "sk-or-".
    expect(process.env.OPENROUTER_API_KEY).not.toMatch(/^sk-or-/);
  });

  it('does not leave a usable OpenAI key in the unit environment', () => {
    expect(process.env.OPENAI_API_KEY).not.toMatch(/^sk-[A-Za-z0-9]{20,}/);
  });
});
