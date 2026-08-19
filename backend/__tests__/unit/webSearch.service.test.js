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
      PARALLEL_API_KEY: 'parallel-key',
      WEB_SEARCH_TIMEOUT_MS: '1000',
      WEB_SEARCH_MAX_RESULTS: '8',
    };
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it('aggregates primary, LangSearch, and Parallel results', async () => {
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

      if (url === 'https://api.parallel.ai/v1/search') {
        return Promise.resolve({
          data: {
            results: [{ title: 'Parallel result', excerpts: ['from parallel'], url: 'https://example.com/parallel' }],
          },
        });
      }

      return Promise.resolve({ data: {} });
    });

    const { searchWeb } = require('../../services/tools/webSearch.service');
    const results = await searchWeb('test query');

    expect(results.map((item) => item.url)).toEqual([
      'https://example.com/exa',
      'https://example.com/lang',
      'https://example.com/parallel',
    ]);
  });

  it('continues when LangSearch and Parallel fail', async () => {
    axios.post.mockImplementation((url) => {
      if (url === 'https://api.exa.ai/search') {
        return Promise.resolve({
          data: {
            results: [{ title: 'Exa result', text: 'from exa', url: 'https://example.com/exa' }],
          },
        });
      }

      if (url === 'https://api.langsearch.com/v1/web-search') {
        return Promise.reject(new Error('langsearch unavailable'));
      }

      if (url === 'https://api.parallel.ai/v1/search') {
        return Promise.reject(new Error('parallel unavailable'));
      }

      return Promise.resolve({ data: {} });
    });

    const { searchWeb } = require('../../services/tools/webSearch.service');
    const results = await searchWeb('test query');

    expect(results.map((item) => item.url)).toContain('https://example.com/exa');
  });
});
