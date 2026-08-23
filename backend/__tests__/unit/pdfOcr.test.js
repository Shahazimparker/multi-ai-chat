// ============================================================
// FILE: backend/__tests__/unit/pdfOcr.test.js
// PURPOSE: PDF text extraction — text layer first, OCR when it is not enough.
//
//   The routing decision is the whole feature. pdf-parse is free, so it must
//   always get first attempt; OCR is billed per page, so it must fire only
//   when the text layer is genuinely unusable. Getting that backwards either
//   loses scanned documents or bills for every PDF ever uploaded.
// ============================================================

const axios = require('axios');
const pdfOcr = require('../../services/pdfOcr.service');
const { loaders } = require('../../services/documentLoader.service');

const PDF = Buffer.from('%PDF-1.4 fake bytes');

const ocrResponse = (markdowns, pagesProcessed) => ({
  data: {
    pages: markdowns.map((markdown, index) => ({ index, markdown })),
    model: 'mistral-ocr-latest',
    usage_info: { pages_processed: pagesProcessed ?? markdowns.length },
  },
});

const ENV_SNAPSHOT = { ...process.env };

beforeEach(() => {
  vi.restoreAllMocks();
  process.env = { ...ENV_SNAPSHOT };
  process.env.MISTRAL_SUMMARY_API_KEY = 'test-mistral';
  delete process.env.PDF_OCR_ENABLED;
  delete process.env.PDF_OCR_MAX_PAGES;
});

afterEach(() => { process.env = { ...ENV_SNAPSHOT }; });

describe('needsOcr heuristic', () => {
  it('treats an empty text layer as needing OCR', () => {
    expect(pdfOcr.needsOcr('', 3)).toBe(true);
    expect(pdfOcr.needsOcr('   ', 3)).toBe(true);
  });

  it('treats a few stray characters across many pages as a scan', () => {
    // The signature of a scanned document: a handful of ligatures, nothing more.
    expect(pdfOcr.needsOcr('ﬁ ﬂ 12', 10)).toBe(true);
  });

  it('leaves a genuine text layer alone', () => {
    const dense = 'x'.repeat(2000);
    expect(pdfOcr.needsOcr(dense, 1)).toBe(false);
  });

  it('scales with page count rather than total length', () => {
    const text = 'y'.repeat(500);
    expect(pdfOcr.needsOcr(text, 1)).toBe(false);  // 500 chars on one page is fine
    expect(pdfOcr.needsOcr(text, 20)).toBe(true);  // same text over 20 pages is not
  });
});

describe('extractTextFromPdf', () => {
  it('joins pages as markdown with page headings', async () => {
    vi.spyOn(axios, 'post').mockResolvedValue(ocrResponse(['# Page one body', 'Second page body']));

    const { text, pages } = await pdfOcr.extractTextFromPdf(PDF, { fileName: 'a.pdf' });

    expect(pages).toBe(2);
    // Page markers let the chunker split on boundaries and let a retrieved
    // passage say which page it came from.
    expect(text).toContain('## Page 1');
    expect(text).toContain('## Page 2');
    expect(text).toContain('Second page body');
  });

  it('posts the PDF as a base64 data URI to the OCR endpoint', async () => {
    const post = vi.spyOn(axios, 'post').mockResolvedValue(ocrResponse(['ok']));

    await pdfOcr.extractTextFromPdf(PDF, { fileName: 'a.pdf' });

    const [url, payload] = post.mock.calls[0];
    expect(url).toBe('https://api.mistral.ai/v1/ocr');
    expect(payload.model).toBe('mistral-ocr-latest');
    expect(payload.document.document_url).toMatch(/^data:application\/pdf;base64,/);
  });

  it('caps how many pages it will bill for', async () => {
    process.env.PDF_OCR_MAX_PAGES = '2';
    const many = Array.from({ length: 10 }, (_, i) => `page ${i + 1} text`);
    vi.spyOn(axios, 'post').mockResolvedValue(ocrResponse(many));

    const { text, pages } = await pdfOcr.extractTextFromPdf(PDF, { fileName: 'big.pdf' });

    // A 500-page scan should not quietly become a 500-page bill.
    expect(pages).toBe(2);
    expect(text).toContain('page 2 text');
    expect(text).not.toContain('page 3 text');
  });

  it('returns null when disabled', async () => {
    process.env.PDF_OCR_ENABLED = 'false';
    const post = vi.spyOn(axios, 'post');

    const { text } = await pdfOcr.extractTextFromPdf(PDF);

    expect(post).not.toHaveBeenCalled();
    expect(text).toBeNull();
  });

  it('returns null only when NO provider in the chain is configured', async () => {
    // Removing just the Mistral key no longer disables OCR — the OpenRouter
    // file-input tier still covers it, which is the point of the fallback.
    for (const k of ['MISTRAL_SUMMARY_API_KEY', 'MISTRAL_API_KEY', 'OPENROUTER_API_KEY']) {
      delete process.env[k];
    }
    const post = vi.spyOn(axios, 'post');

    const { text } = await pdfOcr.extractTextFromPdf(PDF);

    expect(post).not.toHaveBeenCalled();
    expect(text).toBeNull();
  });

  it('falls back to the OpenRouter file tier when Mistral OCR fails', async () => {
    const post = vi.spyOn(axios, 'post')
      .mockRejectedValueOnce(new Error('mistral ocr down'))
      .mockResolvedValueOnce({
        data: { choices: [{ message: { content: '## Page 1 -- recovered by chat model' } }] },
      });

    const { text, model } = await pdfOcr.extractTextFromPdf(PDF, { fileName: 'a.pdf' });

    expect(post).toHaveBeenCalledTimes(2);
    expect(post.mock.calls[1][0]).toContain('openrouter.ai');
    expect(text).toContain('recovered by chat model');
    expect(model).toContain('gemini');
  });

  it('sends the PDF as OpenRouter file content, not as an image', async () => {
    vi.spyOn(axios, 'post')
      .mockRejectedValueOnce(new Error('mistral ocr down'))
      .mockResolvedValueOnce({ data: { choices: [{ message: { content: 'text' } }] } });

    const post = axios.post;
    await pdfOcr.extractTextFromPdf(PDF, { fileName: 'a.pdf' });

    const parts = post.mock.calls[1][1].messages[0].content;
    const filePart = parts.find((p) => p.type === 'file');
    expect(filePart.file.file_data).toMatch(/^data:application\/pdf;base64,/);
    expect(filePart.file.filename).toBe('a.pdf');
  });

  it('keeps trying the chain when a tier returns empty text', async () => {
    const post = vi.spyOn(axios, 'post')
      .mockResolvedValueOnce({ data: { pages: [] } })
      .mockResolvedValueOnce({ data: { choices: [{ message: { content: 'from fallback' } }] } });

    const { text } = await pdfOcr.extractTextFromPdf(PDF);

    expect(post).toHaveBeenCalledTimes(2);
    expect(text).toBe('from fallback');
  });

  it('prefers the background key over the primary one', () => {
    process.env.MISTRAL_SUMMARY_API_KEY = 'background';
    process.env.MISTRAL_API_KEY = 'primary';
    expect(pdfOcr.config().apiKey).toBe('background');

    delete process.env.MISTRAL_SUMMARY_API_KEY;
    expect(pdfOcr.config().apiKey).toBe('primary');
  });

  it('returns null rather than throwing when the API errors', async () => {
    vi.spyOn(axios, 'post').mockRejectedValue(new Error('mistral 500'));
    const { text } = await pdfOcr.extractTextFromPdf(PDF, { fileName: 'a.pdf' });
    expect(text).toBeNull();
  });

  it('returns null when OCR comes back with no pages', async () => {
    vi.spyOn(axios, 'post').mockResolvedValue({ data: { pages: [] } });
    const { text } = await pdfOcr.extractTextFromPdf(PDF);
    expect(text).toBeNull();
  });

  it('propagates cancellation', async () => {
    vi.spyOn(axios, 'post').mockRejectedValue(
      Object.assign(new Error('aborted'), { name: 'CanceledError' })
    );
    await expect(pdfOcr.extractTextFromPdf(PDF)).rejects.toMatchObject({ name: 'CanceledError' });
  });
});

describe('PDFLoader routing', () => {
  const { PDFLoader } = loaders;

  // The text-layer parser is injected rather than exercised for real. Building
  // a synthetic PDF that satisfies pdfjs-dist (pdf-parse v2's engine) proved
  // unreliable — and the subject here is PDFLoader's ROUTING decision, not
  // pdf.js. Real parsing is covered by the parser's own library.
  const textLayer = (text, numpages = 1) => async () => ({ text, numpages });
  const brokenParser = async () => { throw new Error('bad XRef entry'); };

  it('uses the text layer and never calls OCR when the text is good', async () => {
    const ocr = vi.fn();
    const dense = 'Lorem ipsum dolor sit amet. '.repeat(20);

    const doc = await PDFLoader.load(PDF, 'good.pdf', ocr, textLayer(dense, 1));

    // OCR is billed per page, so a perfectly readable PDF must never reach it.
    expect(ocr).not.toHaveBeenCalled();
    expect(doc.metadata.extraction).toBe('text-layer');
    expect(doc.content).toContain('Lorem ipsum');
  });

  it('falls back to OCR when the text layer is too sparse to be real', async () => {
    const ocr = vi.fn().mockResolvedValue('scanned content');

    // 40 characters spread over 20 pages is a scan, not a document.
    const doc = await PDFLoader.load(PDF, 'scan.pdf', ocr, textLayer('a'.repeat(40), 20));

    expect(ocr).toHaveBeenCalledTimes(1);
    expect(doc.metadata.extraction).toBe('ocr');
    expect(doc.content).toBe('scanned content');
  });

  it('falls back to OCR when the parser throws', async () => {
    const ocr = vi.fn().mockResolvedValue('recovered by ocr');

    // Parser failures still fall back to OCR rather than failing the document.
    const doc = await PDFLoader.load(PDF, 'broken.pdf', ocr, brokenParser);

    expect(doc.content).toBe('recovered by ocr');
    expect(doc.metadata.extraction).toBe('ocr');
    expect(ocr.mock.calls[0][1]).toBe('broken.pdf');
  });

  it('keeps the text layer when OCR is offered but returns nothing', async () => {
    const ocr = vi.fn().mockResolvedValue(null);
    const thin = 'a'.repeat(40);

    // Sparse enough to try OCR, but OCR failed — the little we have beats
    // discarding the document entirely.
    const doc = await PDFLoader.load(PDF, 'thin.pdf', ocr, textLayer(thin, 20));

    expect(ocr).toHaveBeenCalled();
    expect(doc.metadata.extraction).toBe('text-layer');
    expect(doc.content).toBe(thin);
  });

  it('throws when neither route yields text, instead of indexing nothing', async () => {
    const ocr = vi.fn().mockResolvedValue(null);

    // An empty document must not become an empty chunk in the vector store.
    await expect(PDFLoader.load(PDF, 'empty.pdf', ocr, textLayer('', 3)))
      .rejects.toThrow(/Could not extract text/i);
  });

  it('keeps the original behaviour when no OCR callback is supplied', async () => {
    await expect(PDFLoader.load(PDF, 'legacy.pdf', null, brokenParser))
      .rejects.toThrow(/Could not extract text/i);
  });
});
