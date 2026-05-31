// Real web search integration test (no mocks).
// Runs only when at least one web-search provider key is configured in .env.

const { searchWeb } = require('../../services/tools/webSearch.service');

const hasAnyWebSearchKey = Boolean(
  process.env.EXA_API_KEY ||
  process.env.TAVILY_API_KEY ||
  process.env.FIRECRAWL_API_KEY ||
  process.env.SERPAPI_API_KEY ||
  process.env.LANGSEARCH_API_KEY
);

const describeReal = hasAnyWebSearchKey ? describe : describe.skip;

describeReal('searchWeb (real)', () => {
  it('returns normalized live results from configured providers', async () => {
    const results = await searchWeb('latest AI agent frameworks');

    expect(Array.isArray(results)).toBe(true);
    expect(results.length).toBeGreaterThan(0);

    for (const item of results) {
      expect(typeof item.title).toBe('string');
      expect(item.title.length).toBeGreaterThan(0);
      expect(typeof item.url).toBe('string');
      expect(item.url.length).toBeGreaterThan(0);
      expect(typeof item.snippet).toBe('string');
    }
  }, 60000);
});
