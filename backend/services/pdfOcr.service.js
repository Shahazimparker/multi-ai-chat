// ============================================================
// FILE: backend/services/pdfOcr.service.js
// PURPOSE: Read a PDF that the text layer cannot give us — scanned pages,
//          image-only exports, and documents whose structure matters.
//
//   WHY THIS EXISTS. documentLoader reads PDFs with pdf-parse, which extracts
//   the embedded text layer. That covers most PDFs and costs nothing, but it
//   has two hard limits:
//
//     - A scanned page has NO text layer. pdf-parse returns an empty string
//       and the document silently enters the index carrying nothing.
//     - pdf-parse 1.1.4 vendors pdf.js 1.10.100 (2018). It fails outright on
//       plenty of modern PDFs, including — verified — the ones this very
//       application generates with pdfkit, which raise "bad XRef entry".
//
//   Mistral's OCR model reads the page itself rather than its text layer, so
//   neither limit applies. It also returns markdown, so tables survive as
//   tables instead of collapsing into run-on text.
//
//   COST. Billed per page, so this is a FALLBACK, not the default path:
//   pdf-parse runs first and OCR is used only when its output is missing or
//   implausibly sparse. MAX_PAGES caps the damage from someone uploading a
//   500-page scan.
// ============================================================

const axios = require('axios');

const OCR_URL = 'https://api.mistral.ai/v1/ocr';
const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';

// Instruction for the chat-model fallback. The dedicated OCR model needs no
// prompt; a general model does, and it has to be told not to summarise.
const TRANSCRIBE_PROMPT = [
  'Transcribe this PDF completely and accurately.',
  '',
  '- Reproduce all text verbatim, including identifiers, code and error codes.',
  '- Preserve tables as markdown tables and keep reading order.',
  '- Prefix each page with "## Page N".',
  '- Do not summarise, interpret or add commentary.',
].join(String.fromCharCode(10));

const config = () => ({
  enabled: String(process.env.PDF_OCR_ENABLED ?? 'true').toLowerCase() !== 'false',
  model: process.env.PDF_OCR_MODEL || 'mistral-ocr-latest',
  // The dedicated background key first: it exists so bulk ingest does not
  // compete with user-facing chat for the same quota.
  apiKey: process.env.MISTRAL_SUMMARY_API_KEY || process.env.MISTRAL_API_KEY,
  maxPages: Number(process.env.PDF_OCR_MAX_PAGES || 50),
  timeoutMs: Number(process.env.PDF_OCR_TIMEOUT_MS || 120000),
});

/**
 * Ordered extraction chain.
 *
 * Mistral's dedicated OCR model leads: it is purpose-built for documents, runs
 * on the free quota, and returns markdown. The OpenRouter tier is a genuine
 * fallback rather than a duplicate — those models accept a PDF as `file` input
 * and read the rendered page, so a Mistral outage or quota exhaustion does not
 * leave scanned documents unreadable.
 */
const ocrChain = () => {
  const c = config();
  return [
    { kind: 'mistral-ocr', model: c.model, apiKey: c.apiKey },
    {
      kind: 'openrouter-file',
      model: process.env.PDF_OCR_FALLBACK_MODEL || 'google/gemini-2.5-flash-lite',
      apiKey: process.env.OPENROUTER_API_KEY,
    },
  ].filter((t) => t.apiKey);
};

const isAvailable = () => config().enabled && ocrChain().length > 0;

/**
 * A text layer that produced almost nothing per page is the signature of a
 * scan. A genuine text page runs to hundreds or thousands of characters; a
 * scanned one yields a handful of stray ligatures at most.
 */
const DEFAULT_MIN_CHARS_PER_PAGE = 100;

// Read per call, not captured at module load: a value baked in at require time
// cannot be changed afterwards and ignores anything dotenv loads later.
const minCharsPerPage = () =>
  Number(process.env.PDF_OCR_MIN_CHARS_PER_PAGE || DEFAULT_MIN_CHARS_PER_PAGE);

const needsOcr = (text, pageCount) => {
  const chars = String(text || '').trim().length;
  if (chars === 0) return true;
  const pages = Math.max(1, Number(pageCount) || 1);
  return (chars / pages) < minCharsPerPage();
};

/**
 * extractTextFromPdf — OCR a PDF and return its pages joined as markdown.
 *
 * @param {Buffer} buffer
 * @param {{ signal?: AbortSignal, fileName?: string }} options
 * @returns {Promise<{ text: string|null, pages: number, model: string|null }>}
 *          `text` is null when OCR is unavailable or produced nothing. Callers
 *          must not substitute a placeholder — an unreadable document should
 *          fail rather than enter the index as an apology.
 */
const viaMistralOcr = async (buffer, tier, { signal, fileName, maxPages, timeoutMs }) => {
  const response = await axios.post(
    OCR_URL,
    {
      model: tier.model,
      document: {
        type: 'document_url',
        document_url: `data:application/pdf;base64,${buffer.toString('base64')}`,
      },
    },
    {
      headers: { Authorization: `Bearer ${tier.apiKey}`, 'Content-Type': 'application/json' },
      timeout: timeoutMs,
      signal,
      // A scanned PDF's base64 payload is large; the default body cap is not.
      maxBodyLength: Infinity,
      maxContentLength: Infinity,
    }
  );

  const pages = Array.isArray(response?.data?.pages) ? response.data.pages : [];
  if (pages.length === 0) return { text: null, pages: 0 };

  const used = pages.slice(0, maxPages);
  if (pages.length > used.length) {
    console.warn(`[PdfOcr] "${fileName}" has ${pages.length} pages; capped at ${maxPages}.`);
  }

  // Page breaks are kept as headings so the chunker can split on them and a
  // retrieved passage still says which page it came from.
  const text = used
    .map((p, i) => {
      const md = String(p?.markdown || '').trim();
      return md ? `## Page ${Number.isInteger(p?.index) ? p.index + 1 : i + 1}\n\n${md}` : '';
    })
    .filter(Boolean)
    .join('\n\n')
    .trim();

  return { text: text || null, pages: used.length };
};

/**
 * Chat models that accept `file` input read the rendered page rather than the
 * text layer, so they cover the same failures the dedicated OCR model does.
 * The page-heading convention is requested in the prompt instead of coming
 * back structured, so output shape is best-effort here.
 */
const viaOpenRouterFile = async (buffer, tier, { signal, fileName, timeoutMs }) => {
  const response = await axios.post(
    OPENROUTER_URL,
    {
      model: tier.model,
      messages: [{
        role: 'user',
        content: [
          { type: 'text', text: TRANSCRIBE_PROMPT },
          {
            type: 'file',
            file: {
              filename: fileName,
              file_data: `data:application/pdf;base64,${buffer.toString('base64')}`,
            },
          },
        ],
      }],
    },
    {
      headers: {
        Authorization: `Bearer ${tier.apiKey}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': process.env.FRONTEND_URL || 'http://localhost:3000',
        'X-Title': 'MultiAI Chat',
      },
      timeout: timeoutMs,
      signal,
      maxBodyLength: Infinity,
      maxContentLength: Infinity,
    }
  );

  const text = String(response?.data?.choices?.[0]?.message?.content || '').trim();
  if (!text) return { text: null, pages: 0 };

  // The model was asked for "## Page N" markers; count them when present so the
  // caller still gets a page figure, without inventing one when it is absent.
  const pageMarkers = (text.match(/^##\s+Page\s+\d+/gim) || []).length;
  return { text, pages: pageMarkers };
};

const extractTextFromPdf = async (buffer, options = {}) => {
  const { signal = null, fileName = 'document.pdf' } = options;
  const c = config();

  if (!c.enabled) return { text: null, pages: 0, model: null };
  if (!buffer || !buffer.length) return { text: null, pages: 0, model: null };

  const chain = ocrChain();
  if (chain.length === 0) {
    console.warn('[PdfOcr] No OCR provider configured; cannot read "%s".', fileName);
    return { text: null, pages: 0, model: null };
  }

  for (const tier of chain) {
    try {
      const runner = tier.kind === 'mistral-ocr' ? viaMistralOcr : viaOpenRouterFile;
      const result = await runner(buffer, tier, {
        signal,
        fileName,
        maxPages: c.maxPages,
        timeoutMs: c.timeoutMs,
      });

      if (!result.text) {
        console.warn(`[PdfOcr] ${tier.kind} produced no text for "${fileName}"; trying next.`);
        continue;
      }

      if (tier !== chain[0]) {
        console.warn(`[PdfOcr] "${fileName}" served by fallback ${tier.kind}/${tier.model}.`);
      }
      console.log(`[PdfOcr] Extracted ${result.text.length} chars from "${fileName}" via ${tier.model}.`);
      return { text: result.text, pages: result.pages, model: tier.model };
    } catch (err) {
      if (err?.name === 'AbortError' || err?.name === 'CanceledError') throw err;
      const detail = err?.response?.data ? JSON.stringify(err.response.data).slice(0, 160) : err.message;
      console.warn(`[PdfOcr] ${tier.kind}/${tier.model} failed for "${fileName}": ${detail}`);
    }
  }

  return { text: null, pages: 0, model: null };
};

/**
 * Callback shape documentLoader's PDFLoader expects.
 */
const createPdfOcrCallback = (options = {}) => async (buffer, fileName) => {
  const { text } = await extractTextFromPdf(buffer, { ...options, fileName });
  return text;
};

module.exports = {
  extractTextFromPdf,
  createPdfOcrCallback,
  needsOcr,
  isAvailable,
  ocrChain,
  config,
  minCharsPerPage,
  DEFAULT_MIN_CHARS_PER_PAGE,
};
