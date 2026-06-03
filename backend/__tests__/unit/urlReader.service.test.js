vi.mock('../../services/tools/githubReader.service', () => ({
  parseGitHubRepoUrl: vi.fn(() => null),
  readGitHubRepo: vi.fn(),
}));

vi.mock('../../services/tools/siteReaders.service', () => ({
  readSiteSpecificUrl: vi.fn(async () => []),
}));

const axios = require('axios');
const { extractUrls, validatePublicHttpUrl, readUrls } = require('../../services/tools/urlReader.service');

describe('urlReader.service', () => {
  it('extracts distinct http/https urls from text', () => {
    const text = 'Check https://example.com and http://test.com/a?x=1 and https://example.com';
    const urls = extractUrls(text);
    expect(urls).toEqual(['https://example.com', 'http://test.com/a?x=1']);
  });

  it('strips trailing punctuation from extracted urls', () => {
    const text = 'Read this (https://github.com/octocat/Hello-World), and this https://example.org/test.';
    const urls = extractUrls(text);
    expect(urls).toEqual(['https://github.com/octocat/Hello-World', 'https://example.org/test']);
  });

  it('allows valid public http/https urls', () => {
    expect(validatePublicHttpUrl('https://example.com/path')).toBe('https://example.com/path');
    expect(validatePublicHttpUrl('http://8.8.8.8/info')).toBe('http://8.8.8.8/info');
  });

  it('blocks localhost and private hosts', () => {
    expect(() => validatePublicHttpUrl('http://localhost:3000')).toThrow();
    expect(() => validatePublicHttpUrl('http://127.0.0.1:8080')).toThrow();
    expect(() => validatePublicHttpUrl('http://10.0.0.5')).toThrow();
    expect(() => validatePublicHttpUrl('http://192.168.1.20')).toThrow();
    expect(() => validatePublicHttpUrl('http://172.16.2.10')).toThrow();
    expect(() => validatePublicHttpUrl('http://internal.local/path')).toThrow();
  });

  it('blocks non-http protocols', () => {
    expect(() => validatePublicHttpUrl('file:///etc/passwd')).toThrow();
    expect(() => validatePublicHttpUrl('ftp://example.com')).toThrow();
  });

  it('aggregates generic URL rendering with Jina Reader', async () => {
    const originalEnv = { ...process.env };
    process.env.EXA_API_KEY = 'exa-key';
    process.env.TAVILY_API_KEY = 'tavily-key';
    process.env.FIRECRAWL_API_KEY = 'firecrawl-key';
    process.env.JINA_API_KEY = 'jina-key';
    delete process.env.JINA_DEEPSEARCH_TIMEOUT_MS;

    vi.spyOn(axios, 'post').mockImplementation((url) => {
      if (url === 'https://api.firecrawl.dev/v2/scrape') {
        return Promise.resolve({ data: { data: { markdown: 'Firecrawl text', metadata: { title: 'Firecrawl' } } } });
      }
      if (url === 'https://api.tavily.com/extract') {
        return Promise.resolve({ data: { results: [{ url: 'https://example.com/', title: 'Tavily', raw_content: 'Tavily text' }] } });
      }
      if (url === 'https://api.exa.ai/contents') {
        return Promise.resolve({ data: { results: [{ url: 'https://example.com/', title: 'Exa', text: 'Exa text' }] } });
      }
      if (url === 'https://deepsearch.jina.ai/v1/chat/completions') {
        return Promise.resolve({
          data: {
            choices: [{
              message: {
                content: 'Title: DeepSearch\nDeepSearch text',
              },
            }],
          },
        });
      }
      return Promise.resolve({ data: {} });
    });

    vi.spyOn(axios, 'get').mockResolvedValue({ data: 'Title: Jina\nJina reader text' });

    const results = await readUrls(['https://example.com']);

    expect(results.map((item) => item.source)).toEqual(['firecrawl', 'tavily', 'exa', 'jina-reader', 'jina-deepsearch']);
    expect(axios.post).toHaveBeenCalledWith(
      'https://deepsearch.jina.ai/v1/chat/completions',
      expect.any(Object),
      expect.objectContaining({ timeout: 300000 })
    );
    process.env = originalEnv;
    vi.restoreAllMocks();
  });
});
