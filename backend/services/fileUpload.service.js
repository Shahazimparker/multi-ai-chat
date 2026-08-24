// FILE: backend/services/fileUpload.service.js
// PURPOSE: Handle file uploads, extract text, send directly to LLM, store responses in RAG
// CHANGES:
//   1. NO embedding - direct LLM processing
//   2. /tmp storage for Vercel (read-only handling)
//   3. Store query+response pairs in RAG globally
//   4. Next query - retrieve past file responses for THIS topic
const fs = require('fs');
const path = require('path');
const os = require('os');
const JSZip = require('jszip');
const mammoth = require('mammoth');
const supabase = require('../config/supabase');
const { MODELS } = require('../config/models');
const { dispatchToAI } = require('./ai/dispatcher.service');
const { trimTextByTokens, estimateTokens } = require('./tokenBudget.service');
const crypto = require('crypto');
const { loadDocument } = require('./documentLoader.service');
const { splitText } = require('./textSplitter.service');
const { LEGACY_SPACE, DEFAULT_PROVIDER } = require('../config/embedding');
const { createVisionCallback } = require('./visionExtraction.service');
const { createPdfOcrCallback } = require('./pdfOcr.service');

/**
 * chunkContent — split text into token-aware overlapping chunks
 * Uses TextSplitter service with optimal strategy per file type
 * @param {string} text
 * @param {number} maxTokens     max tokens per chunk (default 500)
 * @param {string} fileType      file type for optimal splitter selection (default 'text')
 * @returns {Array<string>}
 */
const chunkContent = (text, maxTokens = 500, fileType = 'text') => {
  if (!text) return [];

  // Use TextSplitter with optimal strategy for file type
  const chunks = splitText(text, fileType, {
    maxTokens,
    strategy: 'auto',
    metadata: { fileType },
  });

  // Return just the content (for backwards compatibility)
  return chunks.map((chunk) => chunk.content);
};

const hardSplitText = (text, parts = 2) => {
  const source = String(text || '');
  if (!source) return [];
  const safeParts = Math.max(2, Math.min(8, Number(parts) || 2));
  const size = Math.ceil(source.length / safeParts);
  const out = [];
  for (let i = 0; i < safeParts; i++) {
    const piece = source.slice(i * size, (i + 1) * size).trim();
    if (piece) out.push(piece);
  }
  return out;
};

const tryEmbedWithAdaptiveSplit = async ({
  text,
  fileType,
  signal,
  userId,
  embedText,
  maxParts = 32,
  minChars = 300,
}) => {
  let parts = 4;
  while (parts <= maxParts) {
    const pieces = hardSplitText(text, parts);
    if (!pieces.length) return null;

    let sawTooLong = false;
    for (let i = 0; i < pieces.length; i++) {
      if (signal?.aborted) throw new Error('Upload cancelled by user');
      const piece = pieces[i];
      if (!piece || piece.length < minChars) continue;
      try {
        const res = await embedText(piece, 'openrouter', 3, signal, userId);
        if (res?.vector) return res;
      } catch (err) {
        if (err?.code === 'EMBED_INPUT_TOO_LONG') {
          sawTooLong = true;
          continue;
        }
        throw err;
      }
    }

    // If all pieces were still too long, increase split depth and retry
    if (sawTooLong) {
      parts *= 2;
      continue;
    }

    // No success and no "too long" errors => stop retries
    return null;
  }

  return null;
};

const detectLanguage = (fileName) => {
  const ext = fileName.split('.').pop().toLowerCase();
  const langMap = { js: 'javascript', py: 'python', ts: 'typescript', java: 'java', cpp: 'cpp' };
  return langMap[ext] || ext;
};

const getFileHash = (fileName, fileContent) => {
  // Hash = filename + content checksum
  // Same name but different content = different hash
  const contentHash = crypto.createHash('md5')
    .update(fileContent)
    .digest('hex')
    .slice(0, 8);

  return `${fileName}:${contentHash}`;
};

// Explicitly blocked executable and system binaries that pose security risks
const BLOCKED_RISKY_EXTENSIONS = new Set([
  // Windows & DOS Executables / Binaries
  'exe', 'dll', 'so', 'dylib', 'bin', 'com', 'scr', 'sys', 'drv', 'cpl', 'msc', 'hta',
  // Windows Script Hosts & Shells
  'vbs', 'vbe', 'wsf', 'wsh', 'pif', 'gadget',
  // Installers & Packages
  'msi', 'msp', 'pkg', 'deb', 'rpm', 'apk', 'app', 'ipa',
  // Disk Images & System ROMs
  'iso', 'img', 'vmdk', 'dmg', 'toast', 'vcd',
  // Executable Java/Flash/ActiveX
  'jar', 'class', 'swf', 'ocx',
  // Registry & Windows Help
  'reg', 'chm', 'hlp'
]);

const isRiskyFileType = (fileName) => {
  if (!fileName || typeof fileName !== 'string') return false;
  const base = path.basename(fileName).toLowerCase();
  const ext = path.extname(base).slice(1).toLowerCase();
  return BLOCKED_RISKY_EXTENSIONS.has(ext);
};

// Must stay a superset-free mirror of SUPPORTED_FORMATS in documentLoader.service.js.
const SUPPORTED_FILE_TYPES = {
  // Text & Logs
  txt: 'txt',
  text: 'txt',
  log: 'txt',
  rtf: 'txt',
  tex: 'txt',
  latex: 'txt',
  rst: 'txt',
  adoc: 'txt',
  asciidoc: 'txt',
  srt: 'txt',
  vtt: 'txt',
  sub: 'txt',

  // Markdowns
  md: 'code',
  markdown: 'code',
  mdown: 'code',
  mkdn: 'code',
  mdx: 'code',

  // Spreadsheets & Tabular Data
  csv: 'csv',
  tsv: 'csv',
  tab: 'csv',
  xlsx: 'xlsx',
  xls: 'xlsx',
  xlsm: 'xlsx',
  xlsb: 'xlsx',
  ods: 'xlsx',

  // Documents
  pdf: 'pdf',
  doc: 'doc',
  docx: 'doc',
  dot: 'doc',
  dotx: 'doc',
  odt: 'doc',
  epub: 'doc',
  pages: 'doc',
  ppt: 'doc',
  pptx: 'doc',
  odp: 'doc',
  key: 'doc',

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
  zip: 'zip',
  tar: 'zip',
  gz: 'zip',
  tgz: 'zip',
  '7z': 'zip',
  rar: 'zip',
  bz2: 'zip',
  xz: 'zip',

  // JavaScript / TypeScript / Web
  js: 'code',
  mjs: 'code',
  cjs: 'code',
  jsx: 'code',
  ts: 'code',
  mts: 'code',
  cts: 'code',
  tsx: 'code',
  html: 'code',
  htm: 'code',
  xhtml: 'code',
  css: 'code',
  scss: 'code',
  sass: 'code',
  less: 'code',
  vue: 'code',
  svelte: 'code',
  astro: 'code',

  // Structured Data / Config
  json: 'code',
  jsonl: 'code',
  ndjson: 'code',
  geojson: 'code',
  json5: 'code',
  xml: 'code',
  yml: 'code',
  yaml: 'code',
  toml: 'code',
  ini: 'code',
  conf: 'code',
  cfg: 'code',
  config: 'code',
  properties: 'code',
  env: 'code',
  lock: 'code',

  // Backend / Systems / Other Code Languages
  py: 'code',
  pyw: 'code',
  ipynb: 'code',
  java: 'code',
  kt: 'code',
  kts: 'code',
  scala: 'code',
  groovy: 'code',
  c: 'code',
  h: 'code',
  cpp: 'code',
  hpp: 'code',
  cc: 'code',
  cxx: 'code',
  cs: 'code',
  go: 'code',
  rs: 'code',
  zig: 'code',
  d: 'code',
  nim: 'code',
  rb: 'code',
  php: 'code',
  pl: 'code',
  pm: 'code',
  tcl: 'code',
  lua: 'code',
  r: 'code',
  jl: 'code',
  dart: 'code',
  swift: 'code',
  m: 'code',
  mm: 'code',

  // Scripts / Shell
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

// ==================== STORAGE CONFIG ====================
// For Vercel: use /tmp (ephemeral, auto-cleaned)
// For local: use system temp dir
const getTempDir = () => {
  // Check if running on Vercel
  if (process.env.VERCEL === '1') {
    return '/tmp';
  }
  // Fallback to OS temp dir
  return os.tmpdir();
};

const UPLOAD_DIR = getTempDir();
const UPLOAD_FILE_DIR = path.join(UPLOAD_DIR, 'uploads');

// Ensure upload directory exists (with permission handling)
const ensureUploadDir = () => {
  try {
    if (!fs.existsSync(UPLOAD_FILE_DIR)) {
      fs.mkdirSync(UPLOAD_FILE_DIR, { recursive: true, mode: 0o755 });
    }
  } catch (err) {
    if (err.code !== 'EEXIST') {
      console.error('[FileUpload] Warning: Could not create upload dir:', err.message);
    }
  }
};

ensureUploadDir();

const getSupportedFileType = (fileName) => {
  if (!fileName || typeof fileName !== 'string') return 'other';
  const base = path.basename(fileName).toLowerCase();

  // Handle special dotfiles like Dockerfile, .env, .gitignore
  if (base === 'dockerfile' || base.startsWith('dockerfile.')) return 'code';
  if (base === '.env' || base.startsWith('.env.')) return 'code';
  if (base === '.gitignore' || base === '.dockerignore' || base === '.editorconfig') return 'code';

  const ext = path.extname(base).slice(1).toLowerCase();
  if (BLOCKED_RISKY_EXTENSIONS.has(ext)) {
    return 'other';
  }
  return SUPPORTED_FILE_TYPES[ext] || 'other';
};

// ==================== ZIP SAFETY LIMITS ====================
// A ZIP under the 4MB upload cap (MAX_UPLOAD_BYTES in upload.routes.js) can still
// decompress to gigabytes ("zip bomb"), and processZipFile inflates up to
// CONCURRENCY entries at once — enough to exhaust a serverless invocation's
// memory. These bound the damage a single archive can do. Central-directory
// sizes are a fast pre-check, not a guarantee (an entry can decompress to more
// than it declares), so the running total of actually-extracted bytes is
// re-checked as each entry comes out.
const parseZipLimitEnv = (name, fallback) => {
  const parsed = Number.parseInt(process.env[name], 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};
const ZIP_MAX_ENTRIES = parseZipLimitEnv('ZIP_MAX_ENTRIES', 200);
const ZIP_MAX_ENTRY_UNCOMPRESSED_BYTES = parseZipLimitEnv('ZIP_MAX_ENTRY_UNCOMPRESSED_BYTES', 25 * 1024 * 1024); // 25MB per file
const ZIP_MAX_TOTAL_UNCOMPRESSED_BYTES = parseZipLimitEnv('ZIP_MAX_TOTAL_UNCOMPRESSED_BYTES', 100 * 1024 * 1024); // 100MB whole archive

const normalizeZipEntryName = (entryName) => entryName.replace(/\\/g, '/');

const isSafeZipEntryName = (entryName) => {
  const normalized = normalizeZipEntryName(entryName);
  return Boolean(normalized)
    && !normalized.startsWith('/')
    && !normalized.includes('\0')
    && !normalized.split('/').some(part => part === '..');
};

/**
 * Extract text from different file types using DocumentLoader
 * Keeps original file binary unchanged — loader only extracts text for AI
 */
const extractTextFromBuffer = async (buffer, fileType, modelId, signal = null, fileName = '') => {
  try {
    if (signal?.aborted) return '';

    // Vision extraction is shared with the knowledge-base ingest path. This was
    // an inline closure naming google/gemini-2.0-flash-001 — a model since
    // retired from OpenRouter — so image uploads were silently failing here too.
    const visionApiCall = fileType === 'image' ? createVisionCallback({ signal }) : null;

    // Use DocumentLoader for unified extraction
    const pdfOcrCall = fileType === 'pdf' ? createPdfOcrCallback({ signal }) : null;
    const doc = await loadDocument(buffer, fileName, visionApiCall, pdfOcrCall);
    return doc.content;
  } catch (err) {
    console.error(`[DocumentLoader] Text extraction failed for ${fileName}:`, err.message);
    throw err;
  }
};

/**
 * NEW: Send file content directly to LLM and store response
 * Returns: { fileContent, llmAnalysis, tokensUsed }
 */
const analyzeFileWithLLM = async (extractedText, fileName, fileType, modelId, signal = null) => {
  try {
    // SKIP LLM analysis - store file content only
    // AI will analyze during query (when needed)

    return {
      fileContent: extractedText,
      llmAnalysis: `File: ${fileName} (${fileType})

Content length: ${extractedText.length} characters

Preview:
${extractedText.slice(0, 1000)}

Upload timestamp: ${new Date().toISOString()}

File ready for queries.`,
      tokensUsed: 0,
    };
  } catch (err) {
    console.error('[FileUpload] File analysis skipped:', err);
    throw err;
  }
};

/**
 * Store file + LLM response in RAG (globally, not per-topic)
 * This allows RAG to retrieve past file analyses for any query
 */
const saveFileToRAG = async (fileName, fileType, fileContent, llmAnalysis, userId, topicId, signal = null, ragEnabled = true, provider = 'openrouter', onProgress = null, fileBuffer = null, blobUrl = null) => {
  let ragRecord = null;
  let fileRecord = null;
  let totalEmbedTokens = 0;
  let chunksStored = false;
  const fileHash = getFileHash(fileName, fileContent);
  try {
    const sanitizedContent = (fileContent || '').replace(/\0/g, '');
    const sanitizedAnalysis = (llmAnalysis || '').replace(/\0/g, '');
    const { embedText } = require('./rag.service');

    if (ragEnabled) {
      const chunks = chunkContent(sanitizedContent, 2000, fileType);
      const chunkVectors = [];
      let chunkSpace = null;

      const embedChunkWithRetry = async (text, chunkIndex, totalChunks) => {
        try {
          return await embedText(text, 'openrouter', 3, signal, userId);
        } catch (err) {
          if (err?.code === 'EMBED_INPUT_TOO_LONG') {
            let fallbackChunks = chunkContent(text, 1000, fileType);
            if (fallbackChunks.length <= 1) {
              console.warn(`[FileUpload] Chunk ${chunkIndex + 1}/${totalChunks} still oversized after token split; forcing hard split.`);
              const adaptiveResult = await tryEmbedWithAdaptiveSplit({
                text,
                fileType,
                signal,
                userId,
                embedText,
              });
              if (adaptiveResult?.vector) return adaptiveResult;
              return null;
            }

            console.warn(`[FileUpload] Chunk ${chunkIndex + 1}/${totalChunks} exceeded embedding context; retrying with ${fallbackChunks.length} smaller chunk(s).`);
            for (let j = 0; j < fallbackChunks.length; j++) {
              if (signal?.aborted) throw new Error('Upload cancelled by user');
              try {
                const fallbackResult = await embedText(fallbackChunks[j], 'openrouter', 3, signal, userId);
                if (fallbackResult?.vector) {
                  return fallbackResult;
                }
              } catch (subErr) {
                if (subErr?.code === 'EMBED_INPUT_TOO_LONG') {
                  continue;
                }
                throw subErr;
              }
            }
            return null;
          }
          throw err;
        }
      };

      // Dense embedding cap: For massive text files (e.g. 5MB-20MB with thousands of chunks),
      // embed the top 40 representative chunks with concurrency to complete within seconds
      // and prevent Vercel 300s lambda timeout.
      const MAX_DENSE_EMBED_CHUNKS = 40;
      const chunksToEmbedCount = Math.min(chunks.length, MAX_DENSE_EMBED_CHUNKS);

      // Embed top chunks with bounded concurrency (concurrency = 6)
      const EMBED_CONCURRENCY = 6;
      let completedEmbeddings = 0;

      const embedIndices = Array.from({ length: chunksToEmbedCount }, (_, i) => i);
      const embedResults = await mapConcurrent(embedIndices, EMBED_CONCURRENCY, async (i) => {
        if (signal?.aborted) throw new Error('Upload cancelled by user');
        const res = await embedChunkWithRetry(chunks[i], i, chunks.length);
        completedEmbeddings++;
        if (onProgress) {
          const pct = Math.round((completedEmbeddings / chunksToEmbedCount) * 100);
          onProgress({ type: 'progress', phase: 'embedding', percent: pct, message: `Embedding content (${completedEmbeddings}/${chunksToEmbedCount} chunks)...` });
        }
        return res;
      });

      for (let i = 0; i < chunksToEmbedCount; i++) {
        const result = embedResults[i];
        if (result) {
          chunkVectors.push(result.vector);
          if (!chunkSpace) chunkSpace = result.space;
          totalEmbedTokens += result.tokensUsed;
        } else {
          chunkVectors.push(null);
        }
      }

      const fileVector = chunkVectors.find(v => v !== null) || null;

      // Fill remaining chunks with fallback fileVector to ensure full text searchability
      while (chunkVectors.length < chunks.length) {
        chunkVectors.push(fileVector);
      }

      // Every chunk here goes through the same embedText call, so one space
      // describes them all. Recorded so search can refuse to score these rows
      // against a query vector from a different model.
      const embeddingSpace = chunkSpace || LEGACY_SPACE;

      // PostgREST safety: Truncate RPC parameter to <= 300KB and omit raw base64 if > 3.5MB
      // to avoid Supabase PostgREST HTTP payload limit crashes on massive files
      const safeRpcContent = sanitizedContent.length > 300000
        ? sanitizedContent.slice(0, 300000) + `\n\n... [Truncated for RPC storage: ${sanitizedContent.length} chars total] ...`
        : sanitizedContent;

      const rawFileB64 = (fileBuffer && !blobUrl && fileBuffer.length <= 3.5 * 1024 * 1024)
        ? fileBuffer.toString('base64')
        : null;

      const { data: ragData, error: ragError } = await supabase
        .rpc('insert_rag_document', {
          p_user_id: userId, p_topic_id: topicId || null,
          p_file_name: fileName, p_file_hash: fileHash,
          p_file_type: fileType, p_original_content: safeRpcContent,
          p_llm_analysis: sanitizedAnalysis, p_embedding: fileVector,
          p_original_file_b64: rawFileB64,
          p_embedding_space: embeddingSpace,
        });

      if (ragError) throw ragError;
      // Supabase RPC returns SETOF uuid as [{ insert_rag_document: 'uuid' }], extract properly
      let insertedId;
      if (Array.isArray(ragData)) {
        const first = ragData[0];
        insertedId = (typeof first === 'object' && first !== null)
          ? Object.values(first)[0]
          : first;
      } else {
        insertedId = ragData;
      }
      ragRecord = { id: insertedId };

      // Update full sanitizedContent directly in uploaded_files_rag to guarantee 100% full file persistence
      if (ragRecord.id) {
        try {
          const updatePayload = { original_content: sanitizedContent };
          if (blobUrl) updatePayload.blob_url = blobUrl;
          await supabase
            .from('uploaded_files_rag')
            .update(updatePayload)
            .eq('id', ragRecord.id);
        } catch (colErr) {
          console.warn(`[FileUpload] Full original_content column update failed: ${colErr.message}`);
        }
      }

      if (chunks.length > 1) {
        const safeFileContent = sanitizedContent.length > 300000
          ? sanitizedContent.slice(0, 300000) + `\n\n... [Full content indexed in ${chunks.length} chunks] ...`
          : sanitizedContent;

        const fileInsertPayload = {
          user_id: userId, topic_id: topicId,
          file_name: fileName, file_type: fileType,
          content_text: safeFileContent, provider: DEFAULT_PROVIDER,
          embedding: fileVector, embedding_space: embeddingSpace,
        };
        if (blobUrl) fileInsertPayload.blob_url = blobUrl;

        const { data: fr, error: fileErr } = await supabase
          .from('uploaded_files').insert(fileInsertPayload).select('id').single();

        if (!fileErr && fr) {
          fileRecord = fr;
          // Insert rag_chunks in safe batches of 50 rows to avoid HTTP payload limits
          const RAG_CHUNK_BATCH_SIZE = 50;
          for (let b = 0; b < chunks.length; b += RAG_CHUNK_BATCH_SIZE) {
            const batchRows = chunks.slice(b, b + RAG_CHUNK_BATCH_SIZE).map((text, idx) => ({
              file_id: fileRecord.id,
              chunk_text: text,
              provider: DEFAULT_PROVIDER,
              embedding: chunkVectors[b + idx] || fileVector,
              embedding_space: embeddingSpace,
              chunk_index: b + idx,
            }));
            const { error: chunkErr } = await supabase.from('rag_chunks').insert(batchRows);
            if (chunkErr) {
              console.warn(`[FileUpload] rag_chunks batch insert error: ${chunkErr.message}`);
              break;
            }
          }
          chunksStored = true;
          console.log(`[FileUpload] Stored ${chunks.length} chunks for: ${fileName}`);
        }
      }

      const codeExts = ['js','ts','py','java','cpp','go','rb'];
      const ext = fileName.split('.').pop().toLowerCase();
      if (codeExts.includes(ext)) {
        await supabase.from('code_files').delete().eq('file_name', fileName).eq('topic_id', topicId);
        await supabase.from('code_files').insert({
          user_id: userId, topic_id: topicId, file_name: fileName,
          file_type: fileType, content: fileContent, language: detectLanguage(fileName),
          file_hash: fileHash, rag_record_id: ragRecord?.id || null,
        });
      }

      console.log(`[FileUpload] Stored in RAG: ${fileName} (hash: ${fileHash}, chunks: ${chunks.length}, embedTokens: ${totalEmbedTokens}, blob: ${Boolean(blobUrl)})`);
      }
      return { ragId: ragRecord?.id || null, fileId: fileRecord?.id || null, embedTokens: totalEmbedTokens };
    } catch (err) {
      const isAbort = err.message === 'Upload cancelled by user' || err.name === 'AbortError' || err.name === 'CanceledError';
      if (isAbort) console.log(`[FileUpload] Aborted by user: ${fileName}`);
      else console.error(`[FileUpload] Failed: ${fileName} - ${err.message}`);
      // Clean up partial data on abort
      if (isAbort) {
      if (ragRecord?.id) {
        await supabase.from('uploaded_files_rag').delete().eq('id', ragRecord.id);
      }
      if (fileRecord?.id) {
        await supabase.from('uploaded_files').delete().eq('id', fileRecord.id);
      }
    }
    throw err;
  }
};

/**
 * Map over an array concurrently with a concurrency limit
 */
const mapConcurrent = async (items, concurrency, fn) => {
  const results = [];
  const executing = new Set();

  for (const [index, item] of items.entries()) {
    const promise = fn(item, index)
      .then(result => ({ index, result }))
      .catch(err => {
        // Swallow to prevent unhandled rejections from concurrent workers
        return { index, error: err };
      });
    executing.add(promise);
    promise.finally(() => executing.delete(promise));

    if (executing.size >= concurrency) {
      // Wait for at least one to finish
      await Promise.race(executing);
    }
  }

  // Wait for all remaining
  const settled = await Promise.allSettled(executing);
  for (const s of settled) {
    if (s.status === 'fulfilled' && s.value && !s.value.error) results.push(s.value);
  }

  // Re-sort by original index
  results.sort((a, b) => a.index - b.index);
  return results.map(r => r.result);
};

/**
 * Process ZIP file - extract all supported files and analyze each
 * Uses concurrent workers (default: 3) to speed up large ZIPs
 */
const processZipFile = async (filePath, fileName, userId, topicId, modelId, signal, ragEnabled, onProgress = null) => {
  const CONCURRENCY = 5; // process 5 files at a time inside ZIP
  const zip = await JSZip.loadAsync(fs.readFileSync(filePath));
  const skipped = [];
  const savedRagIds = [];    // track uploaded_files_rag IDs for cleanup on abort
  const savedFileIds = [];   // track uploaded_files IDs for cleanup on abort

  // Filter to processable entries first
  const entries = Object.values(zip.files).filter(entry => {
    if (signal?.aborted) throw { name: 'AbortError' };
    if (entry.dir) return false;

    const entryName = normalizeZipEntryName(entry.name);
    if (!isSafeZipEntryName(entryName)) {
      skipped.push(entry.name);
      return false;
    }

    if (getSupportedFileType(entryName) === 'other') {
      skipped.push(entryName);
      return false;
    }

    return true;
  });

  if (entries.length > ZIP_MAX_ENTRIES) {
    throw new Error(`ZIP contains ${entries.length} files, which exceeds the ${ZIP_MAX_ENTRIES}-file limit per upload.`);
  }

  // Declared sizes come from the ZIP's own central directory and aren't
  // trustworthy on their own, but they reject an obvious bomb before any CPU
  // is spent decompressing.
  let declaredTotalBytes = 0;
  for (const entry of entries) {
    const declaredSize = entry._data?.uncompressedSize;
    if (typeof declaredSize !== 'number') continue;
    if (declaredSize > ZIP_MAX_ENTRY_UNCOMPRESSED_BYTES) {
      throw new Error(`"${normalizeZipEntryName(entry.name)}" declares an uncompressed size over the ${Math.round(ZIP_MAX_ENTRY_UNCOMPRESSED_BYTES / (1024 * 1024))}MB per-file limit.`);
    }
    declaredTotalBytes += declaredSize;
  }
  if (declaredTotalBytes > ZIP_MAX_TOTAL_UNCOMPRESSED_BYTES) {
    throw new Error(`ZIP declares ${Math.round(declaredTotalBytes / (1024 * 1024))}MB uncompressed, over the ${Math.round(ZIP_MAX_TOTAL_UNCOMPRESSED_BYTES / (1024 * 1024))}MB total limit.`);
  }

  console.log(`[FileUpload] ZIP has ${entries.length} processable entries (concurrency=${CONCURRENCY})`);

  let validResults = [];
  let completedCount = 0;
  const total = entries.length;
  // Declared sizes above are only a pre-check; this is the real running total,
  // checked against actual decompressed bytes as each entry extracts.
  let extractedTotalBytes = 0;
  let sizeLimitMessage = null;

  try {
    onProgress?.({ type: 'progress', phase: 'extracting', percent: 5, message: `ZIP contains ${total} processable files. Starting...` });

    // Process entries concurrently with bounded concurrency
    const results = await mapConcurrent(entries, CONCURRENCY, async (entry) => {
      const entryName = normalizeZipEntryName(entry.name);
      const innerType = getSupportedFileType(entryName);

      try {
        if (signal?.aborted) throw { name: 'AbortError' };
        // A cap already tripped in another concurrent entry — stop starting new work.
        if (sizeLimitMessage) throw { name: 'AbortError' };

        const buffer = await entry.async('nodebuffer');

        if (buffer.length > ZIP_MAX_ENTRY_UNCOMPRESSED_BYTES) {
          sizeLimitMessage = `"${entryName}" decompressed past the ${Math.round(ZIP_MAX_ENTRY_UNCOMPRESSED_BYTES / (1024 * 1024))}MB per-file limit.`;
          throw { name: 'AbortError' };
        }
        extractedTotalBytes += buffer.length;
        if (extractedTotalBytes > ZIP_MAX_TOTAL_UNCOMPRESSED_BYTES) {
          sizeLimitMessage = `ZIP exceeded the ${Math.round(ZIP_MAX_TOTAL_UNCOMPRESSED_BYTES / (1024 * 1024))}MB total uncompressed limit during extraction.`;
          throw { name: 'AbortError' };
        }

        const extractedText = await extractTextFromBuffer(buffer, innerType, modelId, signal, entryName);

        if (!extractedText || extractedText.length < 10) {
          skipped.push(entryName);
          completedCount++;
          onProgress?.({ type: 'progress', phase: 'processing', percent: Math.round((completedCount / total) * 90) + 5, message: `[${completedCount}/${total}] Skipped empty: ${entryName}` });
          return null;
        }

        const { llmAnalysis } = await analyzeFileWithLLM(extractedText, entryName, innerType, modelId, signal);

        const saveResult = await saveFileToRAG(
          `${fileName}/${entryName}`,
          innerType,
          extractedText,
          llmAnalysis,
          userId,
          topicId,
          signal,
          ragEnabled,
          'openrouter'
        );

        if (saveResult.ragId) savedRagIds.push(saveResult.ragId);
        if (saveResult.fileId) savedFileIds.push(saveResult.fileId);

        completedCount++;
        onProgress?.({ type: 'progress', phase: 'processing', percent: Math.round((completedCount / total) * 90) + 5, message: `[${completedCount}/${total}] Processed: ${entryName}` });

        return {
          fileName: entryName,
          fileType: innerType,
          ragId: saveResult.ragId,
          tokensUsed: saveResult.embedTokens,
        };
      } catch (err) {
        const isAbort = err.name === 'AbortError' || err.name === 'CanceledError' || err?.message === 'Upload cancelled by user';
        if (!isAbort) console.error(`[FileUpload] Error processing ${entryName}:`, err.message);
        skipped.push(entryName);
        completedCount++;
        onProgress?.({ type: 'progress', phase: 'processing', percent: Math.round((completedCount / total) * 90) + 5, message: `[${completedCount}/${total}] Error: ${entryName}` });
        return null;
      }
    });

    validResults = results.filter(Boolean);

    // If signal was aborted during concurrent processing, clean up orphans
    if (signal?.aborted) {
      console.log('[FileUpload] ZIP aborted — cleaning up orphaned RAG entries...');
      onProgress?.({ type: 'progress', phase: 'error', percent: 0, message: 'Upload cancelled. Cleaning up...' });
      await cleanupOrphanedRagEntries(savedRagIds, savedFileIds);
      throw { name: 'AbortError', message: 'Upload cancelled by user' };
    }

    // A size cap tripped mid-extraction — fail the whole ZIP rather than
    // silently keeping the entries that happened to finish first. Falls
    // through to the generic catch below, which cleans up savedRagIds/savedFileIds.
    if (sizeLimitMessage) {
      throw new Error(sizeLimitMessage);
    }
  } catch (err) {
    // On abort/timeout/error, clean up orphaned RAG entries
    const isAbort = err.name === 'AbortError' || err.message === 'Upload cancelled by user';
    if (!isAbort) {
      console.error('[FileUpload] ZIP processing interrupted — cleaning up orphaned RAG entries...');
      onProgress?.({ type: 'progress', phase: 'error', percent: 0, message: 'Upload interrupted. Cleaning up...' });
      await cleanupOrphanedRagEntries(savedRagIds, savedFileIds);
    }
    throw err;
  }

  if (validResults.length === 0) {
    throw new Error('ZIP did not contain any processable files');
  }

  const summary = validResults
    .map(r => `• ${r.fileName} (${r.fileType})`)
    .join('\n')
    .slice(0, 4000);

  onProgress?.({ type: 'progress', phase: 'complete', percent: 100, message: `ZIP processed: ${validResults.length} files ready` });

  return {
    fileName,
    fileType: 'zip',
    processedFiles: validResults.length,
    skippedFiles: skipped.length,
    totalTokensUsed: validResults.reduce((sum, r) => sum + r.tokensUsed, 0),
    extractedText: `ZIP "${fileName}" uploaded. ${validResults.length} file(s) parsed:\n${summary}`,
    message: `✅ ZIP processed. ${validResults.length} files ready for queries.`
  };
};


/**
 * Main: Process uploaded file
 */
const processUploadedFile = async (filePathOrBuffer, fileName, fileType, userId, topicId, modelId, signal = null, ragEnabled = true, onProgress = null, blobUrl = null) => {
  let isTempFile = false;
  let tempFilePath = null;
  try {
    if (signal?.aborted) {
      if (typeof filePathOrBuffer === 'string') cleanupTempFile(filePathOrBuffer);
      throw new Error('Upload cancelled by user');
    }
    console.log(`[FileUpload] Processing: ${fileName} (blob: ${Boolean(blobUrl)})`);

    let buffer;
    if (typeof filePathOrBuffer === 'string') {
      tempFilePath = filePathOrBuffer;
      isTempFile = true;
      if (fileType === 'zip') {
        const result = await processZipFile(tempFilePath, fileName, userId, topicId, modelId, signal, ragEnabled, onProgress);
        cleanupTempFile(tempFilePath);
        return result;
      }
      buffer = fs.readFileSync(tempFilePath);
    } else if (Buffer.isBuffer(filePathOrBuffer)) {
      buffer = filePathOrBuffer;
    } else if (blobUrl) {
      onProgress?.({ type: 'progress', phase: 'downloading', percent: 5, message: 'Fetching private file from storage...' });
      const { fetchPrivateBlobBuffer } = require('./blobStorage.service');
      buffer = await fetchPrivateBlobBuffer(blobUrl);
    } else {
      throw new Error('No valid file source or blob URL provided for processing');
    }

    // 1. Extract text from file
    onProgress?.({ type: 'progress', phase: 'extracting', percent: 15, message: 'Extracting text from file...' });
    const extractedText = await extractTextFromBuffer(buffer, fileType, modelId, signal, fileName);

    if (!extractedText || extractedText.length < 10) {
      throw new Error('File is empty or unreadable');
    }

    // 2. Send directly to LLM (no embedding!)
    let llmAnalysis, tokensUsed = 0;
    if (!ragEnabled) {
      onProgress?.({ type: 'progress', phase: 'analyzing', percent: 30, message: 'Analyzing file content...' });
      const result = await analyzeFileWithLLM(extractedText, fileName, fileType, modelId, signal);
      llmAnalysis = result.llmAnalysis;
      tokensUsed = result.tokensUsed;

      if (isTempFile && tempFilePath) cleanupTempFile(tempFilePath);

      onProgress?.({ type: 'progress', phase: 'complete', percent: 100, message: 'File processed successfully' });

      return {
        fileName,
        fileType,
        ragId: null,
        blobUrl,
        contentLength: extractedText.length,
        tokensUsed,
        extractedText: extractedText.slice(0, 5000),
        message: `✅ File "${fileName}" uploaded. Content ready for chat.`
      };
    }

    // Only reach here if ragEnabled = true
    onProgress?.({ type: 'progress', phase: 'analyzing', percent: 20, message: 'Preparing file for RAG storage...' });

    llmAnalysis = `File: ${fileName} (${fileType})

Content length: ${extractedText.length} characters

Preview:
${extractedText.slice(0, 1000)}

Upload timestamp: ${new Date().toISOString()}

File ready for queries.`;

    // 3. Store in RAG — wrap onProgress to map embedding 0-100% → overall 30-95%
    onProgress?.({ type: 'progress', phase: 'embedding', percent: 30, message: 'Embedding file content...' });
    const embedOnProgress = onProgress ? (data) => {
      if (data.type === 'progress') {
        const mapped = 30 + Math.round((data.percent / 100) * 65);
        onProgress({ ...data, percent: Math.min(mapped, 95) });
      }
    } : null;
    const saveResult = await saveFileToRAG(fileName, fileType, extractedText, llmAnalysis, userId, topicId, signal, ragEnabled, 'openrouter', embedOnProgress, buffer, blobUrl);
    const ragId = saveResult.ragId;
    tokensUsed = saveResult.embedTokens;

    // 4. Cleanup temp file if created
    if (isTempFile && tempFilePath) cleanupTempFile(tempFilePath);

    onProgress?.({ type: 'progress', phase: 'complete', percent: 100, message: 'File processed successfully' });

    console.log(`[FileUpload] Success: ${fileName} analyzed and stored (tokens: ${tokensUsed}, blob: ${Boolean(blobUrl)})`);

    return {
      fileName,
      fileType,
      ragId,
      blobUrl,
      contentLength: extractedText.length,
      tokensUsed,
      extractedText: extractedText.slice(0, 5000),
      message: `✅ File "${fileName}" uploaded successfully. You can now ask questions about it.`
    };
  } catch (err) {
    console.error('[FileUpload] Failed:', err);
    if (isTempFile && tempFilePath) cleanupTempFile(tempFilePath);
    throw err;
  }
};

/**
 * Safe cleanup of temp files
 */
const cleanupTempFile = (filePath) => {
  try {
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
  } catch (err) {
    console.warn(`[FileUpload] Could not delete temp file ${filePath}:`, err.message);
  }
};

/**
 * MODIFIED: Search uploaded files RAG for THIS TOPIC
 * Returns relevant file analyses from past uploads in this topic
 */
const searchUserFilesRAG = async (query, userId, topicId, signal = null, provider = 'openrouter') => {
  try {
    if (!userId || !topicId) return { results: [], embedTokens: 0 };

    // Generate embedding for the query
    const { embedText } = require('./rag.service');
    const embedResult = await embedText(query, 'openrouter', 3, signal, userId);
    if (!embedResult) {
      console.warn('[FileSearch] Embedding failed');
      return { results: [], embedTokens: 0 };
    }
    const queryVector = embedResult.vector;
    const embedTokens = embedResult.tokensUsed;
    const embedSpace = embedResult.space || LEGACY_SPACE;

    // Use DB-side vector search via IVFFLAT index (search_uploaded_files RPC)
    const { data, error } = await supabase.rpc('search_uploaded_files', {
      query_embedding: queryVector,
      user_id_param: userId,
      provider_param: provider,
      match_count: 5,
      topic_id_param: topicId,
      space_param: embedSpace,
    });

    if (error) {
      console.error('[FileSearch] RPC error:', error);
      return { results: [], embedTokens };
    }
    if (!data || data.length === 0) {
      console.warn('[FileSearch] No matching chunks found');
      return { results: [], embedTokens };
    }

    const results = data.map(r => ({
      file_id: r.file_id,
      file_name: r.file_name,
      chunk_text: trimTextByTokens(r.chunk_text, 2000),
      similarity: r.similarity,
    }));
    return { results, embedTokens };
  } catch (err) {
    console.error('[FileSearch] Failed:', err);
    return { results: [], embedTokens: 0 };
  }
};


/**
 * Delete uploaded file and its RAG records
 */
/**
 * Get full file content by file_id (for hybrid tool approach)
 * Returns the complete original_content so the AI can read it on demand
 */
const getFileContent = async (fileIdOrName, userId, topicId = null) => {
  try {
    if (!fileIdOrName || !userId) return null;

    const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(fileIdOrName).trim());
    let query = supabase
      .from('uploaded_files_rag')
      .select('id, file_name, file_type, original_content, original_file_data, llm_analysis, blob_url, created_at')
      .eq('user_id', userId);

    if (isUuid) {
      query = query.eq('id', fileIdOrName.trim());
    } else {
      query = query.ilike('file_name', fileIdOrName.trim());
    }

    if (topicId) {
      query = query.eq('topic_id', topicId);
    }

    let { data: records, error } = await query.order('created_at', { ascending: false }).limit(1);

    // Fallback: if topic-scoped query found nothing and topicId was passed, try user-wide
    if ((!records || records.length === 0) && topicId) {
      let fallbackQuery = supabase
        .from('uploaded_files_rag')
        .select('id, file_name, file_type, original_content, original_file_data, llm_analysis, blob_url, created_at')
        .eq('user_id', userId);
      if (isUuid) {
        fallbackQuery = fallbackQuery.eq('id', fileIdOrName.trim());
      } else {
        fallbackQuery = fallbackQuery.ilike('file_name', fileIdOrName.trim());
      }
      const fallbackRes = await fallbackQuery.order('created_at', { ascending: false }).limit(1);
      records = fallbackRes.data;
    }

    if (!records || records.length === 0) {
      return null;
    }

    const data = records[0];

    // Reconstruct full text from rag_chunks if original_content was truncated
    if (data && !data.blob_url && !data.original_file_data && data.original_content?.includes('Truncated for RPC storage')) {
      try {
        const { data: uFile } = await supabase
          .from('uploaded_files')
          .select('id')
          .eq('user_id', userId)
          .eq('file_name', data.file_name)
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle();

        if (uFile?.id) {
          const { data: chunks } = await supabase
            .from('rag_chunks')
            .select('chunk_text')
            .eq('file_id', uFile.id)
            .order('chunk_index', { ascending: true });

          if (chunks && chunks.length > 0) {
            data.original_content = chunks.map((c) => c.chunk_text).join('');
          }
        }
      } catch (chunkErr) {
        console.warn('[FileContent] Reassembly error:', chunkErr.message);
      }
    }

    return data;
  } catch (err) {
    console.error('[FileContent] Failed:', err);
    return null;
  }
};

/**
 * List uploaded files for a topic (no similarity filter)
 * Falls back to recent user uploads so newly created topics immediately see active files.
 * @param {string} userId
 * @param {string} topicId
 * @param {number} maxFiles - max files to return (default 200)
 */
const listUserFiles = async (userId, topicId, maxFiles = 200) => {
  try {
    if (!userId) return [];

    if (topicId) {
      const { data: topicFiles, error: tErr } = await supabase
        .from('uploaded_files_rag')
        .select('id, file_name, file_type, created_at')
        .eq('user_id', userId)
        .eq('topic_id', topicId)
        .order('created_at', { ascending: false })
        .limit(maxFiles);

      if (!tErr && topicFiles && topicFiles.length > 0) {
        const files = topicFiles.map(r => ({
          file_id: r.id,
          file_name: r.file_name,
          file_type: r.file_type,
        }));
        return { files, totalCount: files.length };
      }
    }

    // Fallback: fetch recent user files across topic or null topic (last 2 hours)
    const { data: recentFiles, error, count } = await supabase
      .from('uploaded_files_rag')
      .select('id, file_name, file_type, created_at', { count: 'exact' })
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(maxFiles);

    if (error) {
      console.error('[listUserFiles] error:', error.message);
      return [];
    }

    const files = (recentFiles || []).map(r => ({
      file_id: r.id,
      file_name: r.file_name,
      file_type: r.file_type,
    }));

    return { files, totalCount: count || files.length };
  } catch (err) {
    console.error('[listUserFiles] Failed:', err);
    return { files: [], totalCount: 0 };
  }
};

/**
 * List ALL uploaded files for a user across all chats (cross-chat)
 * @param {string} userId
 * @param {number} maxFiles - max files to return (default 200)
 */
const listAllUserFiles = async (userId, maxFiles = 200) => {
  try {
    if (!userId) return { files: [], totalCount: 0 };

    const { data, error, count } = await supabase
      .from('uploaded_files_rag')
      .select('id, file_name, file_type, created_at', { count: 'exact' })
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(maxFiles);

    if (error) {
      console.error('[listAllUserFiles] error:', error.message);
      return { files: [], totalCount: 0 };
    }

    const files = (data || []).map(r => ({
      file_id: r.id,
      file_name: r.file_name,
      file_type: r.file_type,
      created_at: r.created_at,
    }));

    return { files, totalCount: count || files.length };
  } catch (err) {
    console.error('[listAllUserFiles] Failed:', err);
    return { files: [], totalCount: 0 };
  }
};

/**
 * Get file content by ID only (cross-chat, no topicId required)
 */
const getFileContentById = async (fileId, userId) => {
  try {
    if (!fileId || !userId) return null;

    const { data, error } = await supabase
      .from('uploaded_files_rag')
      .select('id, file_name, file_type, original_content, original_file_data, llm_analysis, blob_url, created_at')
      .eq('id', fileId)
      .eq('user_id', userId)
      .single();

    if (error) {
      console.error('[FileContentById] error:', error.message);
      return null;
    }

    if (data && !data.blob_url && !data.original_file_data && data.original_content?.includes('Truncated for RPC storage')) {
      try {
        const { data: uFile } = await supabase
          .from('uploaded_files')
          .select('id')
          .eq('user_id', userId)
          .eq('file_name', data.file_name)
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle();

        if (uFile?.id) {
          const { data: chunks } = await supabase
            .from('rag_chunks')
            .select('chunk_text')
            .eq('file_id', uFile.id)
            .order('chunk_index', { ascending: true });

          if (chunks && chunks.length > 0) {
            data.original_content = chunks.map((c) => c.chunk_text).join('');
          }
        }
      } catch (chunkErr) {
        console.warn('[FileContentById] Reassembly error:', chunkErr.message);
      }
    }

    return data;
  } catch (err) {
    console.error('[FileContentById] Failed:', err);
    return null;
  }
};

const deleteUploadedFile = async (fileId, userId) => {
  try {
    const { data: fileRec } = await supabase
      .from('uploaded_files_rag')
      .select('id, file_name, topic_id, blob_url')
      .eq('id', fileId)
      .eq('user_id', userId)
      .maybeSingle();

    if (fileRec?.blob_url) {
      const { deleteBlobFromStorage } = require('./blobStorage.service');
      await deleteBlobFromStorage(fileRec.blob_url);
    }

    if (fileRec?.file_name && fileRec?.topic_id) {
      await supabase
        .from('uploaded_files')
        .delete()
        .eq('user_id', userId)
        .eq('topic_id', fileRec.topic_id)
        .eq('file_name', fileRec.file_name);
    }
  } catch (lookupErr) {
    console.warn('[deleteUploadedFile] Lookup before delete failed:', lookupErr.message);
  }

  const { error } = await supabase
    .from('uploaded_files_rag')
    .delete()
    .eq('id', fileId)
    .eq('user_id', userId);

  if (error) throw error;
};

/**
 * Save AI-generated file content to DB (topic-specific)
 * Appends timestamp if fileName already exists for same user+topic
 */
const saveGeneratedFile = async (userId, topicId, fileName, content, fileType) => {
  try {
    if (!userId || !fileName || !content) return null;

    // Check for duplicate name → append timestamp
    const { data: existing } = await supabase
      .from('uploaded_files_rag')
      .select('id')
      .eq('user_id', userId)
      .eq('topic_id', topicId)
      .eq('file_name', fileName)
      .maybeSingle();

    let finalName = fileName;
    if (existing) {
      const now = new Date();
      const ts = `${now.getFullYear()}${String(now.getMonth()+1).padStart(2,'0')}${String(now.getDate()).padStart(2,'0')}_${String(now.getHours()).padStart(2,'0')}${String(now.getMinutes()).padStart(2,'0')}${String(now.getSeconds()).padStart(2,'0')}`;
      const dot = fileName.lastIndexOf('.');
      if (dot > 0) {
        finalName = `${fileName.substring(0, dot)}_${ts}${fileName.substring(dot)}`;
      } else {
        finalName = `${fileName}_${ts}`;
      }
    }

    const { data, error } = await supabase
      .from('uploaded_files_rag')
      .insert({
        file_name: finalName,
        file_type: fileType || 'generated',
        original_content: content,
        llm_analysis: content,
        user_id: userId,
        topic_id: topicId,
        created_at: new Date().toISOString(),
      })
      .select()
      .single();

    if (error) {
      console.error('[saveGeneratedFile] error:', error.message);
      return null;
    }

    return {
      file_id: data.id,
      file_name: data.file_name,
      file_type: data.file_type,
      created_at: data.created_at,
    };
  } catch (err) {
    console.error('[saveGeneratedFile] Failed:', err);
    return null;
  }
};

/**
 * Save AI-generated binary file (image, PPTX, etc.) to DB
 * Stores both text description in original_content and binary in original_file_data via RPC
 */
const saveGeneratedBinaryFile = async (userId, topicId, fileName, textContent, fileType, binaryBuffer) => {
  try {
    if (!userId || !fileName || !binaryBuffer) return null;

    const { data: existing } = await supabase
      .from('uploaded_files_rag')
      .select('id')
      .eq('user_id', userId)
      .eq('topic_id', topicId || null)
      .eq('file_name', fileName)
      .maybeSingle();

    let finalName = fileName;
    if (existing) {
      const now = new Date();
      const ts = `${now.getFullYear()}${String(now.getMonth()+1).padStart(2,'0')}${String(now.getDate()).padStart(2,'0')}_${String(now.getHours()).padStart(2,'0')}${String(now.getMinutes()).padStart(2,'0')}${String(now.getSeconds()).padStart(2,'0')}`;
      const dot = fileName.lastIndexOf('.');
      finalName = dot > 0 ? `${fileName.substring(0, dot)}_${ts}${fileName.substring(dot)}` : `${fileName}_${ts}`;
    }

    const fileHash = getFileHash(finalName, (textContent || '') + binaryBuffer.length.toString());

    const { data, error } = await supabase.rpc('insert_rag_document', {
      p_user_id: userId,
      p_topic_id: topicId || null,
      p_file_name: finalName,
      p_file_hash: fileHash,
      p_file_type: fileType,
      p_original_content: textContent || '',
      p_llm_analysis: textContent || '',
      p_embedding: null,
      p_original_file_b64: binaryBuffer.toString('base64'),
    });

    if (error) {
      console.error('[saveGeneratedBinaryFile] RPC error:', error.message);
      return null;
    }

    let insertedId;
    if (Array.isArray(data)) {
      const first = data[0];
      insertedId = (typeof first === 'object' && first !== null) ? Object.values(first)[0] : first;
    } else {
      insertedId = data;
    }

    console.log(`[saveGeneratedBinaryFile] Saved ${fileType} file: ${finalName} (id: ${insertedId})`);
    return {
      file_id: insertedId,
      file_name: finalName,
      file_type: fileType,
      created_at: new Date().toISOString(),
    };
  } catch (err) {
    console.error('[saveGeneratedBinaryFile] Failed:', err);
    return null;
  }
};

/**
 * Clean up orphaned RAG entries when ZIP processing is interrupted
 * Deletes from uploaded_files (cascades to rag_chunks) and uploaded_files_rag
 */
const cleanupOrphanedRagEntries = async (ragIds, fileIds) => {
  if (!ragIds.length && !fileIds.length) return;

  try {
    if (fileIds.length) {
      const { error } = await supabase
        .from('uploaded_files')
        .delete()
        .in('id', fileIds);
      if (error) console.warn('[Cleanup] Failed to delete uploaded_files:', error.message);
    }

    if (ragIds.length) {
      const { error } = await supabase
        .from('uploaded_files_rag')
        .delete()
        .in('id', ragIds);
      if (error) console.warn('[Cleanup] Failed to delete uploaded_files_rag:', error.message);
    }

    console.log(`[Cleanup] Removed ${ragIds.length} RAG + ${fileIds.length} file orphaned records`);
  } catch (err) {
    console.warn('[Cleanup] Error during orphan cleanup:', err.message);
  }
};

module.exports = {
  processUploadedFile,
  searchUserFilesRAG,
  getFileContent,
  getFileContentById,
  listUserFiles,
  listAllUserFiles,
  deleteUploadedFile,
  saveGeneratedFile,
  saveGeneratedBinaryFile,
  getTempDir,
  ensureUploadDir,
  getSupportedFileType,
  isRiskyFileType,
  BLOCKED_RISKY_EXTENSIONS,
  getFileHash,
  analyzeFileWithLLM,
  processZipFile, // exported for unit tests to exercise the ZIP safety limits directly
};
