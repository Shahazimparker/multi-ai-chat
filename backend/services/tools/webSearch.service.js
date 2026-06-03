const axios = require('axios');

/**
 * Searches the web with provider fallback in this order:
 * 1) Tavily
 * 2) Firecrawl
 * 3) Exa
 * 4) SerpAPI
 * LangSearch and Jina Search are always queried for aggregation enhancement.
 * Falls back on error, timeout, rate-limit, or empty results.
 * @param {string} query
 * @returns {Promise<Array>} Array of { title, snippet, url }
 */
const isNonProd = process.env.NODE_ENV !== 'production';
const debugLog = (...args) => { if (isNonProd) console.log(...args); };

const searchWeb = async (query) => {
  const timeout = Number(process.env.WEB_SEARCH_TIMEOUT_MS || 8000);
  const jinaSearchTimeout = Number(process.env.JINA_SEARCH_TIMEOUT_MS || 60000);
  const maxResults = Number(process.env.WEB_SEARCH_MAX_RESULTS || 8);
  const userAgent = 'MultiAIChatBot/1.0 (https://github.com/Azim/multi-ai-chat) axios/1.7.9';
  debugLog(`[WebSearch] Called with query: "${query.substring(0, 100)}${query.length > 100 ? '...' : ''}"`);

  const normalize = (raw = []) => raw
    .map((item) => ({
      title: String(item?.title || '').trim(),
      snippet: String(item?.snippet || '').replace(/<[^>]+>/g, '').trim(),
      url: String(item?.url || '').trim(),
    }))
    .filter((item) => item.title && item.url)
    .slice(0, maxResults);

  const toCanonicalUrl = (value = '') => {
    try {
      const u = new URL(value);
      return `${u.origin}${u.pathname}`.replace(/\/+$/, '').toLowerCase();
    } catch {
      return String(value || '').trim().toLowerCase();
    }
  };

  const aggregateResults = (...groups) => {
    const seen = new Set();
    const output = [];
    const maxGroupLength = Math.max(0, ...groups.map((group) => group.length));
    for (let index = 0; index < maxGroupLength; index += 1) {
      for (const group of groups) {
        const item = group[index];
        if (!item) continue;
        const key = toCanonicalUrl(item.url);
        if (!key || seen.has(key)) continue;
        seen.add(key);
        output.push(item);
        if (output.length >= maxResults) return output;
      }
    }
    return output;
  };

  const safeProviderCall = async (name, fn) => {
    try {
      debugLog(`[WebSearch] ${name}: attempting`);
      const results = normalize(await fn());
      if (results.length === 0) {
        console.warn(`[WebSearch] ${name} returned empty results, falling back...`);
        return null;
      }
      debugLog(`[WebSearch] ${name}: ${results.length} normalized result(s)`);
      return results;
    } catch (err) {
      const status = err?.response?.status;
      const label = status ? `${err.message} (HTTP ${status})` : err.message;
      console.error(`[WebSearch] ${name} failed:`, label);
      return null;
    }
  };

  const exaSearch = async () => {
    const apiKey = process.env.EXA_API_KEY;
    if (!apiKey) return [];

    const response = await axios.post(
      'https://api.exa.ai/search',
      { query, numResults: 5, type: 'auto' },
      {
        timeout,
        headers: {
          'Content-Type': 'application/json',
          'User-Agent': userAgent,
          'x-api-key': apiKey,
        },
      }
    );

    const items = Array.isArray(response?.data?.results) ? response.data.results : [];
    return items.map((item) => ({
      title: item?.title || item?.url || query,
      snippet: item?.text || '',
      url: item?.url || '',
    }));
  };

  const tavilySearch = async () => {
    const apiKey = process.env.TAVILY_API_KEY;
    if (!apiKey) return [];

    const response = await axios.post(
      'https://api.tavily.com/search',
      {
        api_key: apiKey,
        query,
        max_results: 5,
        include_answer: false,
        search_depth: 'basic',
      },
      {
        timeout,
        headers: {
          'Content-Type': 'application/json',
          'User-Agent': userAgent,
        },
      }
    );

    const items = Array.isArray(response?.data?.results) ? response.data.results : [];
    return items.map((item) => ({
      title: item?.title || item?.url || query,
      snippet: item?.content || '',
      url: item?.url || '',
    }));
  };

  const firecrawlSearch = async () => {
    const apiKey = process.env.FIRECRAWL_API_KEY;
    if (!apiKey) return [];

    const response = await axios.post(
      'https://api.firecrawl.dev/v1/search',
      { query, limit: 5 },
      {
        timeout,
        headers: {
          'Content-Type': 'application/json',
          'User-Agent': userAgent,
          Authorization: `Bearer ${apiKey}`,
        },
      }
    );

    const items = Array.isArray(response?.data?.data) ? response.data.data : [];
    return items.map((item) => ({
      title: item?.title || item?.url || query,
      snippet: item?.description || item?.markdown || '',
      url: item?.url || '',
    }));
  };

  const serpApiSearch = async () => {
    const apiKey = process.env.SERPAPI_API_KEY;
    if (!apiKey) return [];

    const response = await axios.get('https://serpapi.com/search.json', {
      timeout,
      params: {
        q: query,
        api_key: apiKey,
        num: 5,
        engine: 'google',
      },
      headers: {
        'User-Agent': userAgent,
      },
    });

    const items = Array.isArray(response?.data?.organic_results) ? response.data.organic_results : [];
    return items.map((item) => ({
      title: item?.title || item?.link || query,
      snippet: item?.snippet || '',
      url: item?.link || '',
    }));
  };

  const langSearch = async () => {
    const apiKey = process.env.LANGSEARCH_API_KEY;
    if (!apiKey) return [];

    const response = await axios.post(
      'https://api.langsearch.com/v1/web-search',
      {
        query,
        freshness: process.env.LANGSEARCH_FRESHNESS || 'noLimit',
        summary: String(process.env.LANGSEARCH_SUMMARY || 'true').toLowerCase() === 'true',
        count: 5,
      },
      {
        timeout,
        headers: {
          'Content-Type': 'application/json',
          'User-Agent': userAgent,
          Authorization: `Bearer ${apiKey}`,
        },
      }
    );

    const payload = response?.data?.data;
    let items = [];

    if (Array.isArray(payload)) {
      items = payload;
    } else if (Array.isArray(payload?.results)) {
      items = payload.results;
    } else if (Array.isArray(payload?.webPages?.value)) {
      items = payload.webPages.value;
    } else if (Array.isArray(payload?.organic_results)) {
      items = payload.organic_results;
    }

    return items.map((item) => ({
      title: item?.title || item?.name || item?.url || item?.link || query,
      snippet: item?.summary || item?.content || item?.snippet || item?.description || '',
      url: item?.url || item?.link || '',
    }));
  };

  const parseJinaSearchText = (text = '') => {
    const normalizedText = String(text || '').trim();
    if (!normalizedText) return [];

    const blocks = normalizedText
      .split(/\n(?=Title:\s*)/i)
      .map((block) => block.trim())
      .filter(Boolean);

    const items = [];
    for (const block of blocks) {
      const title = block.match(/^Title:\s*(.+)$/im)?.[1]?.trim();
      const url = block.match(/^URL Source:\s*(https?:\/\/\S+)/im)?.[1]?.trim()
        || block.match(/^URL:\s*(https?:\/\/\S+)/im)?.[1]?.trim();
      const snippet = block
        .replace(/^Title:\s*.+$/gim, '')
        .replace(/^URL Source:\s*https?:\/\/\S+$/gim, '')
        .replace(/^URL:\s*https?:\/\/\S+$/gim, '')
        .replace(/^(Description|Snippet|Content):\s*/gim, '')
        .trim();

      if (title && url) {
        items.push({ title, snippet, url });
      }
    }

    if (items.length > 0) return items;

    return extractMarkdownLinks(normalizedText).map((link) => ({
      title: link.title || link.url || query,
      snippet: normalizedText.slice(0, 700),
      url: link.url,
    }));
  };

  const extractMarkdownLinks = (text = '') => {
    const links = [];
    const seen = new Set();
    const markdownRe = /\[([^\]]{1,160})\]\((https?:\/\/[^)\s]+)\)/g;
    const plainRe = /https?:\/\/[^\s<>"')]+/g;
    let match;

    while ((match = markdownRe.exec(text)) !== null) {
      const title = String(match[1] || '').trim();
      const url = String(match[2] || '').trim();
      const key = toCanonicalUrl(url);
      if (!key || seen.has(key)) continue;
      seen.add(key);
      links.push({ title, url });
    }

    while ((match = plainRe.exec(text)) !== null) {
      const url = String(match[0] || '').replace(/[),.;!?]+$/g, '').trim();
      const key = toCanonicalUrl(url);
      if (!key || seen.has(key)) continue;
      seen.add(key);
      links.push({ title: url, url });
    }

    return links;
  };

  const jinaSearch = async () => {
    const apiKey = process.env.JINA_API_KEY;
    if (!apiKey) return [];

    const response = await axios.get(`https://s.jina.ai/${encodeURIComponent(query)}`, {
      timeout: jinaSearchTimeout,
      responseType: 'text',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'User-Agent': userAgent,
      },
    });

    return parseJinaSearchText(response?.data || '');
  };

  const providers = [
    { name: 'Exa', fn: exaSearch },
    { name: 'Firecrawl', fn: firecrawlSearch },
    { name: 'Tavily', fn: tavilySearch },
    { name: 'SerpAPI', fn: serpApiSearch },
  ];

  let primaryResults = null;
  let primaryProvider = null;
  for (const provider of providers) {
    debugLog(`[WebSearch] Primary fallback: trying ${provider.name}`);
    const results = await safeProviderCall(provider.name, provider.fn);
    if (results) {
      primaryResults = results;
      primaryProvider = provider.name;
      debugLog(`[WebSearch] Primary selected: ${provider.name}`);
      break;
    }
  }

  debugLog('[WebSearch] Aggregate providers: trying LangSearch + JinaSearch');
  const [langResults, jinaResults] = await Promise.all([
    safeProviderCall('LangSearch', langSearch),
    safeProviderCall('JinaSearch', jinaSearch),
  ]);

  const base = primaryResults || [];
  const langExtra = langResults || [];
  const jinaExtra = jinaResults || [];
  const finalResults = aggregateResults(base, langExtra, jinaExtra);
  debugLog(`[WebSearch] Final aggregated: ${finalResults.length} results (primary: ${primaryProvider || 'none'}, base: ${base.length}, lang: ${langExtra.length}, jina: ${jinaExtra.length})`);

  if (finalResults.length > 0) {
    return finalResults;
  }

  console.warn('[WebSearch] No provider returned results.');
  return [];
};

module.exports = { searchWeb };
