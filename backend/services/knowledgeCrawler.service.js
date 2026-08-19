// ============================================================
// FILE: backend/services/knowledgeCrawler.service.js
// PURPOSE: Recursive website & documentation crawler for RAG 2.0
// ============================================================

const axios = require('axios');
const { URL } = require('url');
const { validatePublicHttpUrl } = require('./tools/urlReader.service');

const USER_AGENT = 'MultiAIChat-Crawler/2.0 (+https://github.com/Azim/multi-ai-chat)';
const DEFAULT_TIMEOUT = 10000;
const MAX_HTML_SIZE = 5 * 1024 * 1024; // 5MB

/**
 * Basic HTML to clean text/markdown converter
 */
const htmlToCleanText = (html = '') => {
  if (!html) return '';

  let text = String(html);

  // Remove scripts, styles, noscript, svg, iframes, nav, footer
  text = text.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, ' ');
  text = text.replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, ' ');
  text = text.replace(/<noscript\b[^<]*(?:(?!<\/noscript>)<[^<]*)*<\/noscript>/gi, ' ');
  text = text.replace(/<svg\b[^<]*(?:(?!<\/svg>)<[^<]*)*<\/svg>/gi, ' ');
  text = text.replace(/<iframe\b[^<]*(?:(?!<\/iframe>)<[^<]*)*<\/iframe>/gi, ' ');
  text = text.replace(/<nav\b[^<]*(?:(?!<\/nav>)<[^<]*)*<\/nav>/gi, ' ');
  text = text.replace(/<footer\b[^<]*(?:(?!<\/footer>)<[^<]*)*<\/footer>/gi, ' ');
  text = text.replace(/<header\b[^<]*(?:(?!<\/header>)<[^<]*)*<\/header>/gi, ' ');

  // Convert headings to Markdown
  text = text.replace(/<h1[^>]*>([\s\S]*?)<\/h1>/gi, '\n\n# $1\n\n');
  text = text.replace(/<h2[^>]*>([\s\S]*?)<\/h2>/gi, '\n\n## $1\n\n');
  text = text.replace(/<h3[^>]*>([\s\S]*?)<\/h3>/gi, '\n\n### $1\n\n');
  text = text.replace(/<h4[^>]*>([\s\S]*?)<\/h4>/gi, '\n\n#### $1\n\n');

  // Convert code blocks
  text = text.replace(/<pre[^>]*><code[^>]*>([\s\S]*?)<\/code><\/pre>/gi, '\n```\n$1\n```\n');
  text = text.replace(/<code[^>]*>([\s\S]*?)<\/code>/gi, '`$1`');

  // Convert list items
  text = text.replace(/<li[^>]*>([\s\S]*?)<\/li>/gi, '\n- $1');

  // Convert paragraphs and line breaks
  text = text.replace(/<p[^>]*>([\s\S]*?)<\/p>/gi, '\n\n$1\n\n');
  text = text.replace(/<br\s*\/?>/gi, '\n');
  text = text.replace(/<hr\s*\/?>/gi, '\n---\n');

  // Strip remaining HTML tags
  text = text.replace(/<[^>]+>/g, ' ');

  // Decode common HTML entities
  text = text
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&mdash;/gi, '—')
    .replace(/&ndash;/gi, '–');

  // Collapse excessive newlines and spaces
  text = text
    .replace(/[ \t]+/g, ' ')
    .replace(/\n\s*\n\s*\n+/g, '\n\n')
    .trim();

  return text;
};

/**
 * Extract title from HTML
 */
const extractTitle = (html = '', fallbackUrl = '') => {
  const match = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  if (match && match[1]) {
    const raw = match[1].replace(/<[^>]+>/g, '').trim();
    if (raw) return raw;
  }
  const h1Match = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i);
  if (h1Match && h1Match[1]) {
    const raw = h1Match[1].replace(/<[^>]+>/g, '').trim();
    if (raw) return raw;
  }
  try {
    const u = new URL(fallbackUrl);
    return u.pathname.split('/').filter(Boolean).pop() || u.hostname;
  } catch {
    return 'Web Document';
  }
};

/**
 * Extract links on same domain
 */
const extractInternalLinks = (html = '', baseUrlStr = '') => {
  const links = new Set();
  let base;
  try {
    base = new URL(baseUrlStr);
  } catch {
    return [];
  }

  const hrefRegex = /href=["']([^"']+)["']/gi;
  let match;
  while ((match = hrefRegex.exec(html)) !== null) {
    const rawHref = match[1].trim();
    if (!rawHref || rawHref.startsWith('javascript:') || rawHref.startsWith('mailto:') || rawHref.startsWith('tel:')) {
      continue;
    }

    try {
      const resolved = new URL(rawHref, base);
      // Stay on same hostname
      if (resolved.hostname === base.hostname) {
        // Strip query params and hash for clean crawl indexing
        resolved.search = '';
        resolved.hash = '';
        const normalized = resolved.toString().replace(/\/+$/, '');

        // Ignore common binary file downloads
        if (!/\.(png|jpg|jpeg|gif|webp|svg|pdf|zip|tar|gz|exe|dmg|mp4|mp3|avi|mov)$/i.test(normalized)) {
          links.add(normalized);
        }
      }
    } catch {
      // ignore malformed URLs
    }
  }

  return Array.from(links);
};

/**
 * Crawl website recursively up to maxDepth and maxPages
 */
const crawlWebsite = async (startUrl, options = {}) => {
  const maxDepth = Math.min(3, Math.max(1, Number(options.maxDepth || 2)));
  const maxPages = Math.min(50, Math.max(1, Number(options.maxPages || 20)));
  const onProgress = options.onProgress || (() => {});

  // Reuse the app-wide SSRF guard: this crawler fetches server-side, so an
  // unvalidated host reaches loopback, RFC1918, and cloud metadata endpoints.
  let rootUrl;
  try {
    rootUrl = validatePublicHttpUrl(startUrl).replace(/\/+$/, '');
  } catch (err) {
    throw new Error(`Invalid or blocked start URL: ${err.message}`, { cause: err });
  }

  const visited = new Set();
  const queue = [{ url: rootUrl, depth: 1 }];
  const crawledPages = [];

  console.log(`[Crawler] Starting crawl at "${rootUrl}" (maxDepth: ${maxDepth}, maxPages: ${maxPages})`);

  while (queue.length > 0 && crawledPages.length < maxPages) {
    const { url, depth } = queue.shift();
    if (visited.has(url)) continue;
    visited.add(url);

    onProgress({
      phase: 'crawling',
      currentUrl: url,
      crawledCount: crawledPages.length,
      queueCount: queue.length,
      progressPercent: Math.round((crawledPages.length / maxPages) * 100),
    });

    // Re-check every hop: links are same-host as an already-validated root,
    // but a queued URL can still resolve somewhere unexpected.
    let safeUrl;
    try {
      safeUrl = validatePublicHttpUrl(url);
    } catch (err) {
      console.warn(`[Crawler] Skipping blocked URL "${url}":`, err.message);
      continue;
    }

    try {
      const response = await axios.get(safeUrl, {
        timeout: DEFAULT_TIMEOUT,
        headers: { 'User-Agent': USER_AGENT },
        maxContentLength: MAX_HTML_SIZE,
        maxRedirects: 3,
        validateStatus: (status) => status === 200,
      });

      // A public URL can 302 into private space, so check where we landed
      // before reading the body.
      const finalUrl = response.request?.res?.responseUrl;
      if (finalUrl && finalUrl !== safeUrl) {
        try {
          validatePublicHttpUrl(finalUrl);
        } catch (err) {
          console.warn(`[Crawler] Blocked redirect target "${finalUrl}":`, err.message);
          continue;
        }
      }

      const contentType = response.headers['content-type'] || '';
      if (!contentType.includes('text/html') && !contentType.includes('application/xhtml+xml')) {
        continue;
      }

      const html = String(response.data);
      const title = extractTitle(html, url);
      const text = htmlToCleanText(html);

      if (text && text.length > 50) {
        crawledPages.push({
          url,
          title,
          text,
          depth,
          byteSize: Buffer.byteLength(text, 'utf8'),
        });
        console.log(`[Crawler] Indexed page ${crawledPages.length}/${maxPages}: "${title}" (${url})`);
      }

      // Discover internal links if depth allows
      if (depth < maxDepth && crawledPages.length + queue.length < maxPages * 2) {
        const foundLinks = extractInternalLinks(html, url);
        for (const nextLink of foundLinks) {
          if (!visited.has(nextLink) && !queue.some((q) => q.url === nextLink)) {
            queue.push({ url: nextLink, depth: depth + 1 });
          }
        }
      }
    } catch (err) {
      console.warn(`[Crawler] Failed to fetch "${url}":`, err.message);
    }
  }

  console.log(`[Crawler] Completed crawl of "${rootUrl}". Total pages indexed: ${crawledPages.length}`);
  return crawledPages;
};

module.exports = {
  crawlWebsite,
  htmlToCleanText,
  extractTitle,
  extractInternalLinks,
};
