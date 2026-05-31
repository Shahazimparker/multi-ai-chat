const axios = require('axios');

const isDebugEnabled = () => String(process.env.RERANK_DEBUG || '').toLowerCase() === 'true';
const debugLog = (...args) => {
  if (isDebugEnabled()) {
    console.error('[LangSearchRerank]', ...args);
  }
};

const rerankWithLangSearch = async (query, items, options = {}) => {
  const apiKey = process.env.LANGSEARCH_API_KEY;
  if (!apiKey) {
    debugLog('skipped: missing LANGSEARCH_API_KEY');
    return items || [];
  }

  const list = Array.isArray(items) ? items : [];
  if (list.length <= 1) {
    debugLog(`skipped: insufficient items (${list.length})`);
    return list;
  }

  const model = process.env.LANGSEARCH_RERANK_MODEL || 'langsearch-reranker-v1';
  const timeout = Number(process.env.WEB_SEARCH_TIMEOUT_MS || 8000);
  const maxDocs = Math.min(50, Number(options.maxDocs || 20));
  const topN = Math.min(maxDocs, Number(options.topN || list.length));
  const toText = typeof options.toText === 'function'
    ? options.toText
    : (item) => String(item?.text || item?.content || item?.snippet || item?.title || '').trim();

  const source = list.slice(0, maxDocs);
  const documents = source.map((item) => toText(item));
  const lengths = documents.map((d) => d.length);
  const totalChars = lengths.reduce((sum, n) => sum + n, 0);
  const avgChars = lengths.length ? Math.round(totalChars / lengths.length) : 0;
  const maxChars = lengths.length ? Math.max(...lengths) : 0;
  debugLog(`request: model=${model}, docs=${documents.length}, topN=${topN}, avgChars=${avgChars}, maxChars=${maxChars}, totalChars=${totalChars}`);
  if (documents.every((d) => !d)) {
    debugLog('skipped: empty documents');
    return list;
  }

  try {
    const response = await axios.post(
      'https://api.langsearch.com/v1/rerank',
      {
        model,
        query: String(query || ''),
        documents,
        top_n: topN,
        return_documents: false,
      },
      {
        timeout,
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
      }
    );

    const results = Array.isArray(response?.data?.results) ? response.data.results : [];
    if (results.length === 0) {
      debugLog(`skipped: no rerank results (candidates=${source.length})`);
      return list;
    }

    const ranked = [];
    const used = new Set();

    for (const row of results) {
      const idx = Number(
        row?.index ??
        row?.document_index ??
        row?.document?.index
      );
      if (!Number.isInteger(idx) || idx < 0 || idx >= source.length || used.has(idx)) continue;
      ranked.push(source[idx]);
      used.add(idx);
    }

    if (ranked.length === 0) {
      debugLog(`skipped: no valid rerank indexes (candidates=${source.length})`);
      return list;
    }
    const tail = source.filter((_, i) => !used.has(i));
    debugLog(`applied: ranked=${ranked.length}, candidates=${source.length}, returned=${ranked.length + tail.length}`);
    return [...ranked, ...tail, ...list.slice(maxDocs)];
  } catch (err) {
    console.warn('[LangSearchRerank] failed:', err?.message || 'unknown');
    if (isDebugEnabled()) {
      const status = err?.response?.status;
      const body = err?.response?.data;
      const bodyText = typeof body === 'string' ? body : JSON.stringify(body || {});
      const bodyPreview = bodyText.slice(0, 500);
      debugLog(`failure-details: status=${status || 'n/a'}, body=${bodyPreview || 'n/a'}`);
    }
    return list;
  }
};

module.exports = { rerankWithLangSearch };
