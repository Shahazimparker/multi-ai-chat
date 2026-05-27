// ============================================================
// FILE: backend/services/documentLoader.service.js
// PURPOSE: Unified document loader abstraction for all file types
//          - Keeps original file binary unchanged (stored separately)
//          - Extracts text/content for AI processing
//          - Format-specific loaders for each file type
// ============================================================

const path = require('path');
const pdfParse = require('pdf-parse');
const mammoth = require('mammoth');
const XLSX = require('xlsx');

// Supported file types and their loaders
const SUPPORTED_FORMATS = {
  txt: 'text',
  csv: 'spreadsheet',
  json: 'text',
  md: 'text',
  html: 'code',
  xml: 'code',
  sql: 'code',
  sh: 'code',
  bat: 'code',
  js: 'code',
  ts: 'code',
  tsx: 'code',
  jsx: 'code',
  py: 'code',
  java: 'code',
  cpp: 'code',
  c: 'code',
  go: 'code',
  rb: 'code',
  php: 'code',
  rs: 'code',
  swift: 'code',
  kt: 'code',
  vue: 'code',
  svelte: 'code',
  css: 'code',
  scss: 'code',
  yaml: 'code',
  yml: 'code',
  xlsx: 'spreadsheet',
  xls: 'spreadsheet',
  pdf: 'pdf',
  doc: 'document',
  docx: 'document',
  jpg: 'image',
  jpeg: 'image',
  png: 'image',
  gif: 'image',
  webp: 'image',
  zip: 'archive',
};

/**
 * Get loader for file type
 * @param {string} fileName
 * @returns {string} loader type
 */
const getLoaderType = (fileName) => {
  const ext = path.extname(fileName).slice(1).toLowerCase();
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
  async load(buffer, fileName) {
    const data = await pdfParse(buffer);
    return {
      content: data.text,
      metadata: {
        type: 'pdf',
        fileName,
        pages: data.numpages,
        size: buffer.length,
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

    // Excel file
    const workbook = XLSX.read(buffer, { type: 'buffer' });
    const sheets = [];

    workbook.SheetNames.forEach((name) => {
      const sheet = workbook.Sheets[name];
      const csv = XLSX.utils.sheet_to_csv(sheet);
      sheets.push(`[Sheet: ${name}]\n${csv}`);
    });

    return {
      content: sheets.join('\n\n'),
      metadata: {
        type: 'spreadsheet',
        fileName,
        format: ext,
        sheets: workbook.SheetNames,
        size: buffer.length,
      },
    };
  },
};

/**
 * ImageLoader — extract text from image via vision API
 */
const ImageLoader = {
  async load(buffer, fileName, visionApiCall) {
    if (!visionApiCall) {
      return {
        content: `[Image: ${fileName}] - Vision API not available`,
        metadata: {
          type: 'image',
          fileName,
          size: buffer.length,
        },
      };
    }

    try {
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

      const result = await visionApiCall(base64Image, mimeType);
      return {
        content: result,
        metadata: {
          type: 'image',
          fileName,
          mimeType,
          size: buffer.length,
        },
      };
    } catch (err) {
      console.error('[ImageLoader] Vision API failed:', err.message);
      return {
        content: `[Image: ${fileName}] - Could not extract text`,
        metadata: {
          type: 'image',
          fileName,
          size: buffer.length,
          error: err.message,
        },
      };
    }
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
 * @returns {Promise<{content: string, metadata: object}>}
 */
const loadDocument = async (buffer, fileName, visionApiCall = null) => {
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
        return await PDFLoader.load(buffer, fileName);

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
