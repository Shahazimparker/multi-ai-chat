const axios = require('axios');
const { parseGitHubRepoUrl, readGitHubRepo } = require('./githubReader.service');
const { readSiteSpecificUrl } = require('./siteReaders.service');

const ALLOWED_PROTOCOLS = new Set(['http:', 'https:']);

const extractUrls = (text = '') => {
  if (!text || typeof text !== 'string') return [];
  const matches = text.match(/https?:\/\/[^\s<>"'`]+/gi) || [];
  const cleaned = matches.map((m) => m.replace(/[),.;!?]+$/g, ''));
  return [...new Set(cleaned)];
};

const isPrivateIpv4 = (hostname) => {
  const parts = hostname.split('.').map((p) => Number(p));
  if (parts.length !== 4 || parts.some((n) => Number.isNaN(n) || n < 0 || n > 255)) return false;
  const [a, b] = parts;
  if (a === 10) return true;
  if (a === 127) return true;
  if (a === 192 && b === 168) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 169 && b === 254) return true;
  return false;
};

const validatePublicHttpUrl = (rawUrl) => {
  let parsed;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new Error(`Invalid URL: ${rawUrl}`);
  }

  if (!ALLOWED_PROTOCOLS.has(parsed.protocol)) {
    throw new Error('Only http/https URLs are allowed');
  }

  const hostname = (parsed.hostname || '').toLowerCase();
  if (
    hostname === 'localhost' ||
    hostname === '::1' ||
    hostname.endsWith('.local') ||
    hostname.endsWith('.internal') ||
    hostname.endsWith('.localhost')
  ) {
    throw new Error(`Blocked private/internal URL host: ${hostname}`);
  }

  if (isPrivateIpv4(hostname)) {
    throw new Error(`Blocked private/internal URL host: ${hostname}`);
  }

  return parsed.toString();
};

const normalizeResults = (items = [], source = 'unknown') =>
  items
    .map((item) => ({
      url: String(item?.url || '').trim(),
      title: String(item?.title || item?.url || '').trim(),
      text: String(item?.text || item?.summary || item?.content || item?.raw_content || item?.markdown || '').trim(),
      source,
    }))
    .filter((item) => item.url && item.text);

const readWithExa = async (urls, timeout) => {
  const apiKey = process.env.EXA_API_KEY;
  if (!apiKey) return [];

  const response = await axios.post(
    'https://api.exa.ai/contents',
    { urls, text: true, summary: true },
    {
      timeout,
      headers: {
        'x-api-key': apiKey,
        'Content-Type': 'application/json',
      },
    }
  );

  return normalizeResults(response?.data?.results || [], 'exa');
};

const readWithTavily = async (urls, timeout) => {
  const apiKey = process.env.TAVILY_API_KEY;
  if (!apiKey) return [];

  const response = await axios.post(
    'https://api.tavily.com/extract',
    { urls, extract_depth: 'advanced', include_images: false },
    {
      timeout,
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
    }
  );

  return normalizeResults(response?.data?.results || [], 'tavily');
};

const readWithFirecrawl = async (urls, timeout) => {
  const apiKey = process.env.FIRECRAWL_API_KEY;
  if (!apiKey) return [];

  const output = [];
  for (const url of urls) {
    try {
      const response = await axios.post(
        'https://api.firecrawl.dev/v2/scrape',
        { url, formats: ['markdown'], onlyMainContent: true },
        {
          timeout,
          headers: {
            Authorization: `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
          },
        }
      );
      const data = response?.data?.data || {};
      const text = String(data?.markdown || '').trim();
      if (!text) continue;
      output.push({
        url,
        title: String(data?.metadata?.title || url),
        text,
        source: 'firecrawl',
      });
    } catch {
      // Continue with the next URL.
    }
  }
  return output;
};

const readWithJinaReader = async (urls, timeout) => {
  const apiKey = process.env.JINA_API_KEY;
  if (!apiKey) return [];

  const output = [];
  for (const url of urls) {
    try {
      debugLog(`[UrlReader] JinaReader: attempting ${url}`);
      const response = await axios.get(`https://r.jina.ai/${url}`, {
        timeout,
        responseType: 'text',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'User-Agent': 'multi-ai-chat-url-reader',
        },
      });

      const text = String(response?.data || '').trim();
      if (!text) continue;
      const title = text.match(/^Title:\s*(.+)$/im)?.[1]?.trim()
        || text.match(/^#\s+(.+)$/m)?.[1]?.trim()
        || url;

      output.push({
        url,
        title,
        text,
        source: 'jina-reader',
      });
      debugLog(`[UrlReader] JinaReader: success ${url} (${text.length} chars)`);
    } catch {
      debugLog(`[UrlReader] JinaReader: failed ${url}`);
      // Jina Reader is additive; other readers should still complete.
    }
  }
  return output;
};

const readWithJinaDeepSearch = async (urls) => {
  const apiKey = process.env.JINA_API_KEY;
  if (!apiKey) return [];

  const deepSearchTimeout = Number(process.env.JINA_DEEPSEARCH_TIMEOUT_MS || 300000);
  const output = [];

  for (const url of urls) {
    try {
      debugLog(`[UrlReader] JinaDeepSearch: attempting ${url}`);
      const response = await axios.post(
        'https://deepsearch.jina.ai/v1/chat/completions',
        {
          model: process.env.JINA_DEEPSEARCH_MODEL || 'jina-deepsearch-v1',
          messages: [
            {
              role: 'user',
              content: `Render the content of this URL in concise markdown. Preserve the title and key facts.\nURL: ${url}`,
            },
          ],
        },
        {
          timeout: deepSearchTimeout,
          headers: {
            Authorization: `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
            'User-Agent': 'multi-ai-chat-url-reader',
          },
        }
      );

      const text = String(response?.data?.choices?.[0]?.message?.content || '').trim();
      if (!text) continue;

      output.push({
        url,
        title: text.match(/^Title:\s*(.+)$/im)?.[1]?.trim()
          || text.match(/^#\s+(.+)$/m)?.[1]?.trim()
          || url,
        text,
        source: 'jina-deepsearch',
      });
      debugLog(`[UrlReader] JinaDeepSearch: success ${url} (${text.length} chars)`);
    } catch (err) {
      const status = err?.response?.status;
      const label = status ? `${err.message} (HTTP ${status})` : err?.message || 'unknown';
      debugLog(`[UrlReader] JinaDeepSearch: failed ${url} - ${label}`);
    }
  }

  return output;
};

const isNonProd = process.env.NODE_ENV !== 'production';
const debugLog = (...args) => { if (isNonProd) console.log(...args); };

const readUrls = async (rawUrls = []) => {
  const timeout = Number(process.env.WEB_SEARCH_TIMEOUT_MS || 8000);
  const urls = [...new Set(rawUrls.map(validatePublicHttpUrl))];
  if (urls.length === 0) return [];
  const output = [];

  const genericUrls = [];
  for (const url of urls) {
    try {
      debugLog(`[UrlReader] Site-specific phase: trying ${url}`);
      if (parseGitHubRepoUrl(url)) {
        const repoResult = await readGitHubRepo(url, { timeout });
        if (Array.isArray(repoResult) && repoResult.length > 0) {
          output.push(...repoResult);
          debugLog(`[UrlReader] GitHub reader: ${repoResult.length} result(s) for ${url}`);
          continue;
        }
      }
      const siteResult = await readSiteSpecificUrl(url, { timeout });
      if (Array.isArray(siteResult) && siteResult.length > 0) {
        output.push(...siteResult);
        debugLog(`[UrlReader] Site-specific reader: ${siteResult.length} result(s) for ${url}`);
        continue;
      }
      debugLog(`[UrlReader] Generic phase queued: ${url}`);
      genericUrls.push(url);
    } catch (err) {
      console.warn('[UrlReader] Site-specific read failed:', err?.message || 'unknown');
      genericUrls.push(url);
    }
  }

  const providers = [
    { name: 'FirecrawlScrape', fn: readWithFirecrawl },
    { name: 'TavilyExtract', fn: readWithTavily },
    { name: 'ExaContents', fn: readWithExa },
  ];

  const providerResults = genericUrls.length > 0
    ? await Promise.all(providers.map(async (provider) => {
        try {
          debugLog(`[UrlReader] ${provider.name}: attempting ${genericUrls.length} generic URL(s)`);
          const results = await provider.fn(genericUrls, timeout);
          debugLog(`[UrlReader] Aggregated: ${results.length} results from ${provider.name}`);
          return results;
        } catch (err) {
          console.warn(`[UrlReader] ${provider.name} failed:`, err?.message || 'unknown');
          return [];
        }
      }))
    : [];

  const jinaResults = await readWithJinaReader(urls, timeout);
  const deepSearchResults = await readWithJinaDeepSearch(urls);
  const merged = [...output, ...providerResults.flat(), ...jinaResults, ...deepSearchResults]
    .filter((item) => item?.url && item?.text);

  debugLog(`[UrlReader] Final aggregated: ${merged.length} result(s)`);
  return merged;
};

module.exports = {
  extractUrls,
  validatePublicHttpUrl,
  readUrls,
};
