// Global test setup — runs before every UNIT test file.
// vitest globals (vi) are available because globals: true is set in vitest.config.js
//
// Real integration tests do NOT use this file. They have their own config and
// setup (vitest.real.config.js + __tests__/integration-real/setup.js) which
// loads the genuine .env on purpose.

// .env is still loaded so non-secret config (URLs, tuning knobs, feature flags)
// matches how the app actually runs.
require('dotenv').config();

// Set fallback env vars ONLY if real .env values are not present
// Supabase is NOT a "fill in if missing" case. Its credentials are valid and
// point at the live database, so leaving them in place means a unit test whose
// mock fails to intercept writes to production with a service-role key that
// bypasses RLS. That is the same failure the provider keys below had — a
// working credential and a passing test look identical to a working mock — with
// a worse outcome than a surprise bill. Overwrite unconditionally.
//
// The URL keeps a valid https shape so client construction still succeeds and
// every "is Supabase configured?" branch stays reachable.
process.env.SUPABASE_URL = 'https://test.supabase.co';
process.env.SUPABASE_SERVICE_KEY = 'test-service-key';

if (!process.env.JWT_SECRET) process.env.JWT_SECRET = 'test-jwt-secret-minimum-32-chars!!';
if (!process.env.FRONTEND_URL) process.env.FRONTEND_URL = 'http://localhost:3000';

// ── Neutralise provider credentials ─────────────────────────
//
// Loading the real .env made every unit test one un-stubbed call away from
// hitting a paid API. That is not hypothetical: query expansion, Cohere rerank
// and vision extraction each shipped with a stub that silently failed to
// intercept, and the tests passed anyway — by making real, billed requests.
// Nothing in the output distinguished that from a working mock.
//
// Replacing the keys with obvious placeholders keeps every "is this provider
// configured?" branch reachable, while guaranteeing that any request which
// escapes its mock fails fast with a 401 instead of quietly succeeding and
// charging the account. Tests that need a specific value still set it in their
// own beforeEach, which overrides these.
const PROVIDER_KEYS = [
  'OPENROUTER_API_KEY',
  'OPENAI_API_KEY',
  'ANTHROPIC_API_KEY',
  'GEMINI_API_KEY',
  'GEMINI_SUMMARY_API_KEY',
  'MISTRAL_API_KEY',
  'MISTRAL_SUMMARY_API_KEY',
  'CEREBRAS_SUMMARY_API_KEY',
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

for (const key of PROVIDER_KEYS) {
  process.env[key] = `test-${key.toLowerCase().replace(/_/g, '-')}`;
}
