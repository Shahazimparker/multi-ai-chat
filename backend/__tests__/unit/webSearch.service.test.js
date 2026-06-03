const axios = require('axios');

describe('webSearch.service', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    vi.restoreAllMocks();
    vi.resetModules();
    vi.spyOn(axios, 'get');
    vi.spyOn(axios, 'post');
    process.env = {
      ...originalEnv,
      NODE_ENV: 'test',
      EXA_API_KEY: 'exa-key',
      LANGSEARCH_API_KEY: 'lang-key',
      JINA_API_KEY: 'jina-key',
      WEB_SEARCH_TIMEOUT_MS: '1000',
      WEB_SEARCH_MAX_RESULTS: '8',
    };
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it('aggregates primary, LangSearch, and Jina Search results', async () => {
    axios.post.mockImplementation((url) => {
      if (url === 'https://api.exa.ai/search') {
        return Promise.resolve({
          data: {
            results: [{ title: 'Exa result', text: 'from exa', url: 'https://example.com/exa' }],
          },
        });
      }

      if (url === 'https://api.langsearch.com/v1/web-search') {
        return Promise.resolve({
          data: {
            data: [{ title: 'Lang result', summary: 'from lang', url: 'https://example.com/lang' }],
          },
        });
      }

      return Promise.resolve({ data: {} });
    });

    axios.get.mockImplementation((url) => {
      if (url.startsWith('https://s.jina.ai/')) {
        return Promise.resolve({
          data: 'Title: Jina result\nURL Source: https://example.com/jina\nContent: from jina',
        });
      }

      return Promise.resolve({ data: {} });
    });

    const { searchWeb } = require('../../services/tools/webSearch.service');
    const results = await searchWeb('test query');

    expect(results.map((item) => item.url)).toEqual([
      'https://example.com/exa',
      'https://example.com/lang',
      'https://example.com/jina',
    ]);
  });

  it('continues when Jina Search fails', async () => {
    axios.post.mockImplementation((url) => {
      if (url === 'https://api.exa.ai/search') {
        return Promise.resolve({
          data: {
            results: [{ title: 'Exa result', text: 'from exa', url: 'https://example.com/exa' }],
          },
        });
      }

      if (url === 'https://api.langsearch.com/v1/web-search') {
        return Promise.resolve({ data: { data: [] } });
      }

      return Promise.resolve({ data: {} });
    });

    axios.get.mockRejectedValue(new Error('jina search unavailable'));

    const { searchWeb } = require('../../services/tools/webSearch.service');
    const results = await searchWeb('test query');

    expect(results.map((item) => item.url)).toContain('https://example.com/exa');
    expect(results.map((item) => item.url)).not.toContain('https://example.com/jina');
  });
});
