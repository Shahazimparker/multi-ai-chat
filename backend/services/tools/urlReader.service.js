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
      // continue with the next URL
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
      if (parseGitHubRepoUrl(url)) {
        const repoResult = await readGitHubRepo(url, { timeout });
        if (Array.isArray(repoResult) && repoResult.length > 0) {
          output.push(...repoResult);
          continue;
        }
      }
      const siteResult = await readSiteSpecificUrl(url, { timeout });
      if (Array.isArray(siteResult) && siteResult.length > 0) {
        output.push(...siteResult);
        continue;
      }
      genericUrls.push(url);
    } catch (err) {
      console.warn('[UrlReader] Site-specific read failed:', err?.message || 'unknown');
      genericUrls.push(url);
    }
  }

  if (genericUrls.length === 0) {
    debugLog('[UrlReader] No generic URLs to read — all handled by GitHub/site readers');
    return output;
  }

  const providers = [
    { name: 'FirecrawlScrape', fn: readWithFirecrawl },
    { name: 'TavilyExtract', fn: readWithTavily },
    { name: 'ExaContents', fn: readWithExa },
  ];

  for (const provider of providers) {
    try {
      const results = await provider.fn(genericUrls, timeout);
      if (results.some((r) => r.text.length > 200)) {
        debugLog(`[UrlReader] Fallback: ${results.length} results from ${provider.name}`);
        return [...output, ...results];
      }
    } catch (err) {
      console.warn(`[UrlReader] ${provider.name} failed:`, err?.message || 'unknown');
    }
  }

  return output;
};

module.exports = {
  extractUrls,
  validatePublicHttpUrl,
  readUrls,
};
