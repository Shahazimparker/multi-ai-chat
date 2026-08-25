// ============================================================
// FILE: backend/services/documentLoader.service.js
// PURPOSE: Unified document loader abstraction for all file types
//          - Keeps original file binary unchanged (stored separately)
//          - Extracts text/content for AI processing
//          - Format-specific loaders for each file type
// ============================================================

const path = require('path');

// Polyfill browser globals required by pdfjs-dist / pdf-parse in Node.js serverless runtimes
if (typeof global.DOMMatrix === 'undefined') {
  global.DOMMatrix = class DOMMatrix {};
}
if (typeof global.ImageData === 'undefined') {
  global.ImageData = class ImageData {};
}
if (typeof global.Path2D === 'undefined') {
  global.Path2D = class Path2D {};
}

const { PDFParse } = require('pdf-parse');
try {
  const { getData } = require('pdf-parse/worker');
  if (typeof PDFParse?.setWorker === 'function' && typeof getData === 'function') {
    PDFParse.setWorker(getData());
  }
} catch (workerErr) {
  console.warn('[PDFLoader] Failed to set embedded PDF worker:', workerErr?.message);
}

// pdf-parse v2 replaced the `pdfParse(buffer)` callable with a `PDFParse` class
// backed by pdfjs-dist 5.x (v1 vendored pdf.js 1.10.100 from 2018). This adapter
// keeps the v1-shaped contract the rest of PDFLoader relies on:
// `(buffer) => Promise<{ text, numpages }>`.
const parsePdfBuffer = async (buffer) => {
  // Copy before handing the bytes to pdfjs: it may transfer ownership of a
  // TypedArray to its worker thread, which would detach the caller's Buffer
  // (`.length` silently becomes 0) and corrupt the `size` metadata below.
  const parser = new PDFParse({ data: Uint8Array.from(buffer) });
  try {
    // pageJoiner: '' keeps raw concatenated text; the v2 default inserts
    // "-- page_number of total_number --" markers between pages.
    const result = await parser.getText({ pageJoiner: '' });
    return { text: String(result?.text || ''), numpages: Number(result?.total) || 0 };
  } finally {
    await parser.destroy();
  }
};

// Supported file types and their loaders
const SUPPORTED_FORMATS = {
  // Text & Logs
  txt: 'text',
  text: 'text',
  log: 'text',
  rtf: 'text',
  tex: 'text',
  latex: 'text',
  rst: 'text',
  adoc: 'text',
  asciidoc: 'text',
  srt: 'text',
  vtt: 'text',
  sub: 'text',

  // Markdowns
  md: 'text',
  markdown: 'text',
  mdown: 'text',
  mkdn: 'text',
  mdx: 'text',

  // Spreadsheets & Tabular Data
  csv: 'spreadsheet',
  tsv: 'spreadsheet',
  tab: 'spreadsheet',
  xlsx: 'spreadsheet',
  xls: 'spreadsheet',
  xlsm: 'spreadsheet',
  xlsb: 'spreadsheet',
  ods: 'spreadsheet',

  // Documents
  pdf: 'pdf',
  doc: 'document',
  docx: 'document',
  dot: 'document',
  dotx: 'document',
  odt: 'document',
  epub: 'document',
  pages: 'document',
  ppt: 'document',
  pptx: 'document',
  odp: 'document',
  key: 'document',

  // Images
  jpg: 'image',
  jpeg: 'image',
  png: 'image',
  gif: 'image',
  webp: 'image',
  bmp: 'image',
  tiff: 'image',
  tif: 'image',
  ico: 'image',
  svg: 'code',

  // Archives
  zip: 'archive',
  tar: 'archive',
  gz: 'archive',
  tgz: 'archive',
  '7z': 'archive',
  rar: 'archive',
  bz2: 'archive',
  xz: 'archive',

  // Web & Scripting
  html: 'code',
  htm: 'code',
  xhtml: 'code',
  css: 'code',
  scss: 'code',
  sass: 'code',
  less: 'code',
  xml: 'code',
  json: 'text',
  jsonl: 'text',
  ndjson: 'text',
  geojson: 'text',
  json5: 'text',
  yaml: 'code',
  yml: 'code',
  toml: 'code',
  ini: 'code',
  conf: 'code',
  cfg: 'code',
  config: 'code',
  properties: 'code',
  env: 'code',
  lock: 'code',

  // Programming Languages
  js: 'code',
  mjs: 'code',
  cjs: 'code',
  jsx: 'code',
  ts: 'code',
  mts: 'code',
  cts: 'code',
  tsx: 'code',
  py: 'code',
  pyw: 'code',
  ipynb: 'code',
  java: 'code',
  kt: 'code',
  kts: 'code',
  scala: 'code',
  groovy: 'code',
  cpp: 'code',
  hpp: 'code',
  cc: 'code',
  cxx: 'code',
  c: 'code',
  h: 'code',
  cs: 'code',
  go: 'code',
  rb: 'code',
  php: 'code',
  pl: 'code',
  pm: 'code',
  tcl: 'code',
  lua: 'code',
  r: 'code',
  jl: 'code',
  dart: 'code',
  rs: 'code',
  zig: 'code',
  d: 'code',
  nim: 'code',
  swift: 'code',
  m: 'code',
  mm: 'code',
  vue: 'code',
  svelte: 'code',
  astro: 'code',

  // Terminal & Shells
  sh: 'code',
  bash: 'code',
  zsh: 'code',
  fish: 'code',
  ps1: 'code',
  psm1: 'code',
  psd1: 'code',
  bat: 'code',
  cmd: 'code',

  // Query & Schemas
  sql: 'code',
  psql: 'code',
  plsql: 'code',
  mysql: 'code',
  cql: 'code',
  graphql: 'code',
  gql: 'code',
  proto: 'code',
  prisma: 'code',
  dockerfile: 'code',
  tf: 'code',
  hcl: 'code',
};

/**
 * Get loader for file type
 * @param {string} fileName
 * @returns {string} loader type
 */
const getLoaderType = (fileName) => {
  if (!fileName || typeof fileName !== 'string') return 'unknown';
  const base = path.basename(fileName).toLowerCase();

  if (base === 'dockerfile' || base.startsWith('dockerfile.')) return 'code';
  if (base === '.env' || base.startsWith('.env.')) return 'code';
  if (base === '.gitignore' || base === '.dockerignore' || base === '.editorconfig') return 'code';

  const ext = path.extname(base).slice(1).toLowerCase();
  return SUPPORTED_FORMATS[ext] || 'unknown';
};

/**
 * TextLoader — plain text extraction
 */
const TextLoader = {
  async load(buffer, fileName) {
    const content = buffer.toString('utf-8');
    return {
      content,
      metadata: {
        type: 'text',
        fileName,
        size: buffer.length,
      },
    };
  },
};

/**
 * CodeLoader — extract code with language detection
 */
const CodeLoader = {
  detectLanguage(fileName) {
    const ext = path.extname(fileName).slice(1).toLowerCase();
    const langMap = {
      js: 'javascript',
      jsx: 'javascript',
      ts: 'typescript',
      tsx: 'typescript',
      py: 'python',
      java: 'java',
      cpp: 'cpp',
      c: 'c',
      go: 'go',
      rb: 'ruby',
      php: 'php',
      rs: 'rust',
      swift: 'swift',
      kt: 'kotlin',
      html: 'html',
      css: 'css',
      scss: 'scss',
      xml: 'xml',
      json: 'json',
      yaml: 'yaml',
      yml: 'yaml',
      sql: 'sql',
      sh: 'bash',
      bat: 'batch',
      md: 'markdown',
      vue: 'vue',
      svelte: 'svelte',
    };
    return langMap[ext] || 'text';
  },

  async load(buffer, fileName) {
    const content = buffer.toString('utf-8');
    const language = this.detectLanguage(fileName);

    return {
      content,
      metadata: {
        type: 'code',
        language,
        fileName,
        size: buffer.length,
      },
    };
  },
};

/**
 * PDFLoader — extract text from PDF
 */
const PDFLoader = {
  /**
   * Text layer first, OCR only when it is not enough.
   *
   * pdf-parse is free and fast, so it always gets first attempt. It falls short
   * in two ways that OCR covers:
   *
   *   - A scanned page has no text layer, so pdf-parse returns an empty string
   *     and the document would otherwise enter the index carrying nothing.
   *   - pdf-parse v2 (pdfjs-dist 5.x) handles modern PDFs well; OCR remains the
   *     fallback for scanned pages and for anything the text layer can't cover.
   *
   * @param {Function|null} pdfOcrCall async (buffer, fileName) => string|null
   * @param {Function} parse text-layer parser; injectable so the routing above
   *   can be tested without hand-crafting a PDF that satisfies pdfjs-dist
   */
  async load(buffer, fileName, pdfOcrCall = null, parse = parsePdfBuffer) {
    let text = '';
    let pages = 0;
    let parseError = null;

    try {
      const data = await parse(buffer);
      text = String(data?.text || '').trim();
      pages = data?.numpages || 0;
    } catch (err) {
      // Not fatal yet — OCR reads the page image and does not care that the
      // text layer is unparseable.
      parseError = err;
      console.warn(`[PDFLoader] pdf-parse failed for "${fileName}": ${err.message}`);
    }

    const { needsOcr } = require('./pdfOcr.service');
    const sparse = needsOcr(text, pages);

    if (pdfOcrCall && (parseError || sparse)) {
      const reason = parseError ? 'text layer unreadable' : 'text layer too sparse (likely scanned)';
      console.log(`[PDFLoader] "${fileName}": ${reason}; falling back to OCR.`);

      const ocrText = await pdfOcrCall(buffer, fileName);
      if (ocrText && ocrText.trim()) {
        return {
          content: ocrText.trim(),
          metadata: {
            type: 'pdf',
            fileName,
            pages: pages || undefined,
            size: buffer.length,
            extraction: 'ocr',
          },
        };
      }
      console.warn(`[PDFLoader] OCR produced nothing for "${fileName}".`);
    }

    // No usable text from either route. Throwing keeps an empty document out of
    // the index rather than storing a chunk with no content.
    if (!text) {
      const detail = parseError ? parseError.message : 'no text layer and OCR unavailable';
      throw new Error(`Could not extract text from PDF "${fileName}": ${detail}`,
        parseError ? { cause: parseError } : undefined);
    }

    return {
      content: text,
      metadata: {
        type: 'pdf',
        fileName,
        pages,
        size: buffer.length,
        extraction: 'text-layer',
      },
    };
  },
};

/**
 * DocumentLoader — extract text from Word docs (.doc, .docx)
 */
const DocumentLoader = {
  async load(buffer, fileName) {
    const result = await mammoth.extractRawText({ buffer });
    return {
      content: result.value,
      metadata: {
        type: 'document',
        fileName,
        size: buffer.length,
      },
    };
  },
};

/**
 * Render one exceljs cell value as a CSV field.
 * Handles the richer shapes exceljs returns (formula, hyperlink, rich text)
 * that a raw String() would turn into "[object Object]".
 */
const toCsvCell = (value) => {
  if (value === null || value === undefined) return '';

  let text;
  if (value instanceof Date) text = value.toISOString();
  else if (typeof value === 'object') {
    if (typeof value.text === 'string') text = value.text;
    else if (Array.isArray(value.richText)) text = value.richText.map((part) => part.text).join('');
    else if ('result' in value) text = String(value.result ?? '');
    else if ('hyperlink' in value) text = String(value.hyperlink ?? '');
    else text = String(value);
  } else text = String(value);

  // Quote when the field contains a delimiter, quote or newline.
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
};

/**
 * SpreadsheetLoader — extract data from Excel/CSV
 */
const SpreadsheetLoader = {
  async load(buffer, fileName) {
    const ext = path.extname(fileName).slice(1).toLowerCase();

    if (ext === 'csv') {
      return {
        content: buffer.toString('utf-8'),
        metadata: {
          type: 'spreadsheet',
          fileName,
          format: 'csv',
          size: buffer.length,
        },
      };
    }

    // Excel file. Read via exceljs — `xlsx` was dropped because its npm build
    // carries unfixed prototype-pollution and ReDoS advisories.
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer);

    const sheets = [];
    const sheetNames = [];

    workbook.eachSheet((worksheet) => {
      sheetNames.push(worksheet.name);
      const rows = [];
      worksheet.eachRow({ includeEmpty: false }, (row) => {
        // row.values is 1-indexed with a leading hole; drop it.
        const cells = Array.isArray(row.values) ? row.values.slice(1) : [];
        rows.push(cells.map(toCsvCell).join(','));
      });
      sheets.push(`[Sheet: ${worksheet.name}]\n${rows.join('\n')}`);
    });

    return {
      content: sheets.join('\n\n'),
      metadata: {
        type: 'spreadsheet',
        fileName,
        format: ext,
        sheets: sheetNames,
        size: buffer.length,
      },
    };
  },
};

/**
 * ImageLoader — extract text from image via vision API
 *
 * THROWS when nothing readable can be extracted, rather than returning a
 * human-readable apology as `content`. Those placeholders were previously
 * chunked, embedded and stored, so an unreadable image became a retrievable
 * chunk that the reranker could later present to the model as a cited source.
 * Callers already treat a throw as "this file has no usable content", which is
 * the correct outcome.
 */
const ImageLoader = {
  async load(buffer, fileName, visionApiCall) {
    if (!visionApiCall) {
      throw new Error(`No vision extractor configured, so "${fileName}" cannot be read`);
    }

    const base64Image = buffer.toString('base64');
    const ext = path.extname(fileName).toLowerCase();
    const mimeTypeMap = {
      '.jpg': 'image/jpeg',
      '.jpeg': 'image/jpeg',
      '.png': 'image/png',
      '.gif': 'image/gif',
      '.webp': 'image/webp',
    };
    const mimeType = mimeTypeMap[ext] || 'image/jpeg';

    let result;
    try {
      result = await visionApiCall(base64Image, mimeType);
    } catch (err) {
      console.error('[ImageLoader] Vision extraction failed:', err.message);
      throw new Error(`Could not extract text from image "${fileName}": ${err.message}`, { cause: err });
    }

    // The vision service returns null for an unreadable or empty image.
    const content = typeof result === 'string' ? result.trim() : '';
    if (!content) {
      throw new Error(`No readable text found in image "${fileName}"`);
    }

    return {
      content,
      metadata: {
        type: 'image',
        fileName,
        mimeType,
        size: buffer.length,
      },
    };
  },
};

/**
 * ArchiveLoader — list files in archive (don't extract)
 */
const ArchiveLoader = {
  async load(buffer, fileName) {
    const JSZip = require('jszip');
    const zip = new JSZip();
    await zip.loadAsync(buffer);

    const files = [];
    zip.forEach((filePath) => {
      if (!filePath.endsWith('/')) {
        files.push(filePath);
      }
    });

    return {
      content: `Archive: ${fileName}\n\nFiles:\n${files.join('\n')}`,
      metadata: {
        type: 'archive',
        fileName,
        fileCount: files.length,
        files,
        size: buffer.length,
      },
    };
  },
};

/**
 * Load document based on file type
 * @param {any} buffer - file content
 * @param {string} fileName - original file name
 * @param {Function} visionApiCall - optional vision API function for images
 * @param {Function} pdfOcrCall - optional OCR fallback for PDFs whose text layer
 *   is missing or unreadable
 * @returns {Promise<{content: string, metadata: object}>}
 */
const loadDocument = async (buffer, fileName, visionApiCall = null, pdfOcrCall = null) => {
  if (!buffer || !fileName) {
    throw new Error('buffer and fileName are required');
  }

  const loaderType = getLoaderType(fileName);

  try {
    switch (loaderType) {
      case 'text':
        return await TextLoader.load(buffer, fileName);

      case 'code':
        return await CodeLoader.load(buffer, fileName);

      case 'pdf':
        return await PDFLoader.load(buffer, fileName, pdfOcrCall);

      case 'document':
        return await DocumentLoader.load(buffer, fileName);

      case 'spreadsheet':
        return await SpreadsheetLoader.load(buffer, fileName);

      case 'image':
        return await ImageLoader.load(buffer, fileName, visionApiCall);

      case 'archive':
        return await ArchiveLoader.load(buffer, fileName);

      default:
        // Try as text, fallback to placeholder
        try {
          const text = buffer.toString('utf-8');
          const printable = text.replace(/[\x20-\x7E\n\r\t]/g, '').length;
          if (printable > text.length * 0.5) {
            return {
              content: `[Binary file: ${fileName}]`,
              metadata: {
                type: 'unknown',
                fileName,
                size: buffer.length,
              },
            };
          }
          return {
            content: text,
            metadata: {
              type: 'unknown',
              fileName,
              size: buffer.length,
            },
          };
        } catch {
          return {
            content: `[Binary file: ${fileName}]`,
            metadata: {
              type: 'unknown',
              fileName,
              size: buffer.length,
            },
          };
        }
    }
  } catch (err) {
    console.error(`[DocumentLoader] Failed to load ${fileName}:`, err.message);
    throw new Error(`Failed to load ${fileName}: ${err.message}`);
  }
};

module.exports = {
  loadDocument,
  getLoaderType,
  SUPPORTED_FORMATS,
  loaders: {
    TextLoader,
    CodeLoader,
    PDFLoader,
    DocumentLoader,
    SpreadsheetLoader,
    ImageLoader,
    ArchiveLoader,
  },
};
