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
const {
  RAG_RERANK_ENABLED,
  RAG_RERANK_MODEL,
  RAG_RERANK_TIMEOUT_MS,
  RAG_RERANK_MIN_RELEVANCE,
} = require('../config/chatRuntime.config');
const { rerankDocuments, isCohereRateLimited } = require('./ai/cohere.service');

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

  // Trace and diagnostic exports (plain text; see documentLoader for why).
  trc: 'txt',
  trace: 'txt',
  err: 'txt',
  out: 'txt',
  audit: 'txt',
  slowlog: 'txt',
  diag: 'txt',
  syslog: 'txt',
  messages: 'txt',
  nohup: 'txt',

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

      // Spread the budget across the whole file rather than spending it all on
      // the first 40 chunks. Every un-embedded chunk is backfilled below with a
      // copy of another chunk's vector, so taking the first 40 of a 2,000-chunk
      // log meant 98% of it scored against a vector describing the file header —
      // vector search could not reach the body at all. An even stride keeps
      // chunk 0 (which carries the header row and any diagnostic profile) while
      // sampling the rest, so retrieval sees the whole file.
      const embedIndices = chunks.length <= MAX_DENSE_EMBED_CHUNKS
        ? Array.from({ length: chunksToEmbedCount }, (_, i) => i)
        : Array.from(
          { length: chunksToEmbedCount },
          (_, i) => Math.min(chunks.length - 1, Math.round((i * chunks.length) / chunksToEmbedCount))
        );
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

      // Place each vector at the chunk it was computed from. embedResults is
      // ordered by embedIndices, which is no longer 0..n-1 once the sampling
      // above strides across the file, so positional pushes would attach chunk
      // 250's vector to chunk 5.
      chunkVectors.length = chunks.length;
      chunkVectors.fill(null);

      for (let i = 0; i < embedIndices.length; i++) {
        const result = embedResults[i];
        if (!result) continue;
        chunkVectors[embedIndices[i]] = result.vector;
        if (!chunkSpace) chunkSpace = result.space;
        totalEmbedTokens += result.tokensUsed;
      }

      // Backfill gaps from the nearest embedded chunk rather than from the first
      // one: a chunk 900 rows into a log is far better represented by its own
      // neighbourhood than by the file header.
      const fileVector = chunkVectors.find(v => v !== null) || null;
      let lastSeen = fileVector;
      for (let i = 0; i < chunkVectors.length; i++) {
        if (chunkVectors[i]) lastSeen = chunkVectors[i];
        else chunkVectors[i] = lastSeen;
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
          if (blobUrl) {
            // Persist blob_url independently so it is never dropped even if content update fails
            await supabase
              .from('uploaded_files_rag')
              .update({ blob_url: blobUrl })
              .eq('id', ragRecord.id);
          }
          // Only update original_content directly if under 2.5MB to avoid Supabase PostgREST 413 Payload Too Large
          if (sanitizedContent.length <= 2500000) {
            await supabase
              .from('uploaded_files_rag')
              .update({ original_content: sanitizedContent })
              .eq('id', ragRecord.id);
          } else {
            // Not an error, but it decides where later reads get their text: with
            // no inline copy, resolveFullFileContent must fall back to Blob or
            // rag_chunks. Silence here made that look like data loss.
            console.log(`[FileUpload] ${fileName}: ${(sanitizedContent.length / 1048576).toFixed(1)}MB exceeds the 2.5MB inline column limit; full text served from ${blobUrl ? 'Blob' : 'rag_chunks'}.`);
          }
        } catch (colErr) {
          console.warn(`[FileUpload] original_content column update warning: ${colErr.message}`);
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
        // The link that makes deleting the RAG row take this row's chunks with
        // it. Opt-in migration (migration_link_uploaded_files_to_rag.sql), so
        // the insert falls back without it rather than failing the upload.
        if (ragLinkColumnExists && ragRecord?.id) fileInsertPayload.rag_record_id = ragRecord.id;

        let { data: fr, error: fileErr } = await supabase
          .from('uploaded_files').insert(fileInsertPayload).select('id').single();

        if (fileErr && ragLinkColumnExists && isMissingRagLinkColumn(fileErr)) {
          console.warn('[FileUpload] uploaded_files.rag_record_id not found — run database/migration_link_uploaded_files_to_rag.sql so deleting a file also deletes its chunks. Saving without it.');
          ragLinkColumnExists = false;
          delete fileInsertPayload.rag_record_id;
          ({ data: fr, error: fileErr } = await supabase
            .from('uploaded_files').insert(fileInsertPayload).select('id').single());
        }

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
        // Takes this file's rag_chunks with it (ON DELETE CASCADE).
        await supabase.from('uploaded_files').delete().eq('id', fileRecord.id);
      }
      // The bytes outlive the rows otherwise. A cancelled upload left its blob
      // in storage forever: nothing referenced it, so nothing would ever come
      // back to collect it, and the user's file stayed on disk after they asked
      // for it to stop. Last, and best-effort — a storage hiccup here must not
      // mask the abort the caller is waiting on.
      if (blobUrl) {
        try {
          const { deleteBlobFromStorage } = require('./blobStorage.service');
          await deleteBlobFromStorage(blobUrl);
        } catch (blobCleanupErr) {
          console.warn(`[FileUpload] Orphaned blob left after abort (${blobUrl}):`, blobCleanupErr.message);
        }
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
    // Clean up whatever this ZIP already wrote, however it ended.
    //
    // This used to skip the cleanup when the cause was an abort, on the
    // assumption that the `signal?.aborted` check after mapConcurrent had
    // already handled it. That holds only while every abort surfaces there:
    // one thrown on the way to it — mid-extraction, or past a size limit —
    // reached this catch instead and left every entry saved so far behind,
    // with its chunks still retrievable. Cleanup by recorded id is idempotent,
    // so running it in both places costs nothing and closes the gap.
    const isAbort = err.name === 'AbortError' || err.message === 'Upload cancelled by user';
    if (savedRagIds.length || savedFileIds.length) {
      console.log(`[FileUpload] ZIP ${isAbort ? 'cancelled' : 'interrupted'} — cleaning up orphaned RAG entries...`);
      onProgress?.({
        type: 'progress',
        phase: 'error',
        percent: 0,
        message: isAbort ? 'Upload cancelled. Cleaning up...' : 'Upload interrupted. Cleaning up...',
      });
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

// Markers a row carries when original_content holds a placeholder rather than
// the file itself. Both ends are scanned and nothing in between: the "File
// ready for queries." stub is a short string, and the truncation notice is
// appended after the 300k slice — so a head-only scan would miss exactly the
// case that matters most. Scanning the two ends rather than the whole value
// keeps this off the hot path; String.includes over an 18MB column ran on every
// file of every search.
const CONTENT_STUB_MARKERS = [
  'Truncated for RPC storage',
  'File ready for queries.',
];
const STUB_SCAN_CHARS = 2000;

/**
 * True when original_content is a placeholder (or absent) and the real bytes
 * have to be fetched from Blob, the Base64 column, or rag_chunks.
 */
const isContentIncomplete = (text) => {
  if (!text) return true;
  const ends = text.length <= STUB_SCAN_CHARS * 2
    ? text
    : text.slice(0, STUB_SCAN_CHARS) + text.slice(-STUB_SCAN_CHARS);
  return CONTENT_STUB_MARKERS.some((marker) => ends.includes(marker));
};

/**
 * Looks like a Base64 payload. Length must be a multiple of 4, which rules out
 * a single-line all-alphanumeric plain-text file that the character-class test
 * alone would happily decode into garbage.
 */
const looksLikeBase64 = (value) =>
  typeof value === 'string' &&
  value.length > 0 &&
  value.length % 4 === 0 &&
  /^[A-Za-z0-9+/]+={0,2}$/.test(value);

/**
 * Turn raw stored bytes into the SAME text the upload path produced.
 *
 * Vercel Blob holds the ORIGINAL file, not the extracted text — so for xlsx,
 * docx and pdf the stored bytes are a ZIP/PDF container. Decoding those with
 * toString('utf-8') yields the literal bytes ("PK\x03\x04...") rather than the
 * sheet, and every downstream reader — the profiler, the log miner, the keyword
 * scanner, the grep — then sees binary noise and reports nothing.
 *
 * That made the two storage routes behave differently for the same file: a
 * small upload kept its extracted text in `original_content` and analysed fine,
 * while the same file over the Blob threshold analysed as garbage. Re-running
 * the loader here is what makes the routes equivalent.
 *
 * Returns null (not garbage) when extraction fails, so the caller falls through
 * to the next strategy instead of storing and citing mojibake.
 */
const textFromStoredBuffer = async (buffer, fileName) => {
  if (!buffer || buffer.length === 0) return null;

  try {
    const { getLoaderType, loadDocument } = require('./documentLoader.service');
    const loaderType = getLoaderType(fileName || '');

    // Already text on disk — decode directly and skip the loader entirely.
    if (loaderType === 'text' || loaderType === 'code') {
      return buffer.toString('utf-8');
    }

    const loaded = await loadDocument(buffer, fileName);
    return loaded?.content || null;
  } catch (err) {
    console.warn(`[FileContent] Could not re-extract "${fileName}" from stored bytes:`, err.message);
    return null;
  }
};

/**
 * Helper to fetch complete file text across Vercel Blob, Base64 DB storage,
 * and paginated rag_chunks reassembly (guaranteeing >1000 chunks for 10MB-50MB files).
 *
 * Local columns are checked before any network call: a row whose
 * original_content is already the whole file must not trigger a Blob download,
 * which on a search over ten files meant serially pulling tens of megabytes.
 */
const resolveFullFileContent = async (fileRecord, userId) => {
  if (!fileRecord) return '';

  // 1. Local, complete content wins — no network, no decode.
  if (!isContentIncomplete(fileRecord.original_content)) {
    return fileRecord.original_content;
  }

  // 2. Base64 in original_file_data — still local.
  //    This column holds the ORIGINAL file bytes too, so it needs the same
  //    extraction as the Blob branch below. Decoding an xlsx straight to UTF-8
  //    here was the DB-upload half of the same parity bug.
  if (fileRecord.original_file_data) {
    try {
      const bin = fileRecord.original_file_data;
      if (looksLikeBase64(bin)) {
        const text = await textFromStoredBuffer(Buffer.from(bin, 'base64'), fileRecord.file_name);
        if (text) return text;
      }
    } catch (binErr) {
      console.warn('[FileContent] Base64 decode warning:', binErr.message);
    }
  }

  // 3. Private Vercel Blob — the first path that costs a round trip.
  if (fileRecord.blob_url) {
    try {
      const { fetchPrivateBlobBuffer } = require('./blobStorage.service');
      const buf = await fetchPrivateBlobBuffer(fileRecord.blob_url);
      // Extract rather than decode: the blob is the original file, so an xlsx
      // or docx has to go back through the loader to become text again.
      // On failure this falls through to rag_chunks below, which holds the
      // text that was extracted at upload time.
      const text = await textFromStoredBuffer(buf, fileRecord.file_name);
      if (text) return text;
    } catch (bErr) {
      console.warn('[FileContent] Blob fetch fallback warning:', bErr.message);
    }
  }

  if (fileRecord.file_name && userId) {
    try {
      let uFile = null;
      if (fileRecord.topic_id) {
        const { data: tf } = await supabase
          .from('uploaded_files')
          .select('id, blob_url')
          .eq('user_id', userId)
          .eq('topic_id', fileRecord.topic_id)
          .eq('file_name', fileRecord.file_name)
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle();
        uFile = tf;
      }
      if (!uFile) {
        const { data: uf } = await supabase
          .from('uploaded_files')
          .select('id, blob_url')
          .eq('user_id', userId)
          .eq('file_name', fileRecord.file_name)
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle();
        uFile = uf;
      }

      // If uploaded_files has blob_url, try fetching from Blob first
      const effectiveBlobUrl = fileRecord.blob_url || uFile?.blob_url;
      if (effectiveBlobUrl && !fileRecord.blob_url) {
        try {
          const { fetchPrivateBlobBuffer } = require('./blobStorage.service');
          const buf = await fetchPrivateBlobBuffer(effectiveBlobUrl);
          const text = await textFromStoredBuffer(buf, fileRecord.file_name);
          if (text) {
            // Auto-heal uploaded_files_rag table for future queries
            if (fileRecord.id) {
              supabase.from('uploaded_files_rag').update({ blob_url: effectiveBlobUrl }).eq('id', fileRecord.id).then(() => {});
            }
            return text;
          }
        } catch (bErr) {
          console.warn('[FileContent] Blob fetch from uFile fallback warning:', bErr.message);
        }
      }

      if (uFile?.id) {
        const allChunks = [];
        let from = 0;
        const pageSize = 1000;
        while (true) {
          const { data: chunks, error: chunkErr } = await supabase
            .from('rag_chunks')
            .select('chunk_text, chunk_index')
            .eq('file_id', uFile.id)
            .order('chunk_index', { ascending: true })
            .range(from, from + pageSize - 1);

          if (chunkErr || !chunks || chunks.length === 0) break;
          allChunks.push(...chunks);
          if (chunks.length < pageSize) break;
          from += pageSize;
        }

        if (allChunks.length > 0) {
          return allChunks.map((c) => c.chunk_text).join('');
        }
      }
    } catch (chunkErr) {
      console.warn('[FileContent] rag_chunks reassembly warning:', chunkErr.message);
    }
  }

  // Final fallback to whatever text is available
  return fileRecord.original_content || fileRecord.llm_analysis || '';
};

/**
 * MODIFIED: Search uploaded files RAG for THIS TOPIC
 * Returns relevant file analyses from past uploads in this topic
 */
const searchUserFilesRAG = async (query, userId, topicId, signal = null, provider = 'openrouter') => {
  try {
    if (!userId) return { results: [], embedTokens: 0 };

    const results = [];
    let embedTokens = 0;

    // 1. Direct Keyword / Regex Line Search across original_content (instant across all 32k+ lines)
    try {
      let fileQuery = supabase
        .from('uploaded_files_rag')
        .select('id, file_name, topic_id, original_content, original_file_data, blob_url')
        .eq('user_id', userId);

      if (topicId) {
        fileQuery = fileQuery.eq('topic_id', topicId);
      }

      let { data: files } = await fileQuery.order('created_at', { ascending: false }).limit(10);
      if ((!files || files.length === 0) && topicId) {
        const fallbackRes = await supabase
          .from('uploaded_files_rag')
          .select('id, file_name, topic_id, original_content, original_file_data, blob_url')
          .eq('user_id', userId)
          .order('created_at', { ascending: false })
          .limit(10);
        files = fallbackRes.data;
      }

      if (files && files.length > 0) {
        const queryLower = query.toLowerCase().trim();
        const terms = queryLower.split(/\s+/).filter(t => t.length > 1);

        // Each file can contribute up to 20 sampled snippets, so ten files could
        // push 200 windows downstream before anything trims them. Cap the grep
        // stage so the rerank and token budgets see a sane candidate set.
        const MAX_GREP_SNIPPETS = 60;

        for (const f of files) {
          if (results.length >= MAX_GREP_SNIPPETS) break;
          // Only reach for Blob/Base64/rag_chunks when the row's own content is
          // a placeholder. Fetching whenever blob_url merely existed re-downloaded
          // the whole file on every query even though the text was already here.
          let contentToSearch = f.original_content;
          if (isContentIncomplete(contentToSearch)) {
            contentToSearch = await resolveFullFileContent(f, userId);
          }
          if (!contentToSearch) continue;
          const lines = contentToSearch.split('\n');
          const matchedLineIndices = [];

          for (let i = 0; i < lines.length; i++) {
            const lineLower = lines[i].toLowerCase();
            if (lineLower.includes(queryLower) || (terms.length > 1 && terms.every(t => lineLower.includes(t)))) {
              matchedLineIndices.push(i);
              if (matchedLineIndices.length >= 300) break;
            }
          }

          // If no multi-term exact match, match significant terms
          if (matchedLineIndices.length === 0 && terms.length > 0) {
            for (let i = 0; i < lines.length; i++) {
              const lineLower = lines[i].toLowerCase();
              if (terms.some(t => t.length >= 3 && lineLower.includes(t))) {
                matchedLineIndices.push(i);
                if (matchedLineIndices.length >= 300) break;
              }
            }
          }

          // Balanced sampling if many matches: keep initial 5, final 10 (crash state), and 5 middle samples
          let selectedIndices = matchedLineIndices;
          if (matchedLineIndices.length > 20) {
            const head = matchedLineIndices.slice(0, 5);
            const tail = matchedLineIndices.slice(-10);
            const middleCandidates = matchedLineIndices.slice(5, -10);
            const mid = [];
            if (middleCandidates.length > 0) {
              const step = middleCandidates.length / 5;
              for (let s = 0; s < 5; s++) {
                mid.push(middleCandidates[Math.min(middleCandidates.length - 1, Math.floor(s * step))]);
              }
            }
            selectedIndices = Array.from(new Set([...head, ...mid, ...tail])).sort((a, b) => a - b);
          }

          // Extract surrounding context window (4 lines before and 4 lines after)
          const seenRanges = new Set();
          for (const idx of selectedIndices) {
            const startLine = Math.max(0, idx - 4);
            const endLine = Math.min(lines.length - 1, idx + 5);
            const rangeKey = `${startLine}-${endLine}`;
            if (seenRanges.has(rangeKey)) continue;
            seenRanges.add(rangeKey);

            const snippet = lines.slice(startLine, endLine + 1).join('\n');
            results.push({
              file_id: f.id,
              file_name: f.file_name,
              chunk_text: `[Lines ${startLine + 1} to ${endLine + 1} of ${lines.length}]\n${snippet}`,
              similarity: 1.0,
            });
            if (results.length >= MAX_GREP_SNIPPETS) break;
          }
        }
      }
    } catch (grepErr) {
      console.warn('[FileSearch] Keyword grep warning:', grepErr.message);
    }

    // 2. Vector Search complement
    try {
      const { embedText } = require('./rag.service');
      const embedResult = await embedText(query, 'openrouter', 3, signal, userId);
      if (embedResult?.vector) {
        embedTokens = embedResult.tokensUsed;
        const queryVector = embedResult.vector;
        const embedSpace = embedResult.space || LEGACY_SPACE;

        const { data, error } = await supabase.rpc('search_uploaded_files', {
          query_embedding: queryVector,
          user_id_param: userId,
          provider_param: provider,
          match_count: 5,
          topic_id_param: topicId || null,
          space_param: embedSpace,
        });

        if (!error && data && data.length > 0) {
          for (const r of data) {
            if (!results.some(existing => existing.file_id === r.file_id && existing.chunk_text.includes(r.chunk_text.slice(0, 50)))) {
              results.push({
                file_id: r.file_id,
                file_name: r.file_name,
                chunk_text: trimTextByTokens(r.chunk_text, 2000),
                similarity: r.similarity,
              });
            }
          }
        }
      }
    } catch (vectorErr) {
      console.warn('[FileSearch] Vector search warning:', vectorErr.message);
    }

    // 3. Cohere Cross-Encoder Rerank (with 429 rate limit resilience)
    if (results.length > 1 && RAG_RERANK_ENABLED && process.env.COHERE_API_KEY) {
      if (isCohereRateLimited()) {
        console.warn('[FileSearch] Cohere in 429 rate limit cooldown; continuing with un-reranked file matches.');
      } else {
        try {
          // Cap candidates to rerank at 25 to stay within a single search unit (100 docs)
          const candidatesToRerank = results.slice(0, 25);
          const { results: rerankResults, rateLimited } = await rerankDocuments(
            query,
            candidatesToRerank.map((r) => r.chunk_text || ''),
            process.env.COHERE_API_KEY,
            { model: RAG_RERANK_MODEL, signal, timeout: RAG_RERANK_TIMEOUT_MS }
          );

          if (rateLimited) {
            console.warn('[FileSearch] Cohere 429 rate limit hit during rerank; continuing without rerank input.');
          } else if (rerankResults && rerankResults.length > 0) {
            const rerankedList = rerankResults.map(({ index, relevanceScore }) => ({
              ...candidatesToRerank[index],
              rerankScore: relevanceScore,
            }));

            // Only filter below RAG_RERANK_MIN_RELEVANCE if at least one candidate clears it.
            // When the filter does bite, the un-scored tail is dropped along with the
            // rejected candidates — keeping it would leave a rank-30 passage nobody
            // scored ranked above a rank-5 passage the cross-encoder just rejected.
            const relevant = rerankedList.filter((item) => item.rerankScore >= RAG_RERANK_MIN_RELEVANCE);
            const remaining = results.slice(25);
            results.length = 0;
            if (relevant.length > 0) {
              results.push(...relevant);
            } else {
              results.push(...rerankedList, ...remaining);
            }
            console.log(`[FileSearch] Reranked ${candidatesToRerank.length} file candidates via ${RAG_RERANK_MODEL} (top score: ${results[0]?.rerankScore?.toFixed(3)})`);
          }
        } catch (rerankErr) {
          if (rerankErr?.name === 'AbortError' || rerankErr?.name === 'CanceledError') throw rerankErr;
          console.warn('[FileSearch] Cohere rerank unavailable (continuing with un-reranked results):', rerankErr.message);
        }
      }
    }

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
      .select('id, file_name, topic_id, file_type, original_content, original_file_data, llm_analysis, blob_url, created_at')
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
        .select('id, file_name, topic_id, file_type, original_content, original_file_data, llm_analysis, blob_url, created_at')
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

    // Resolve full content across Blob, Base64 DB, or paginated rag_chunks
    const fullContent = await resolveFullFileContent(data, userId);
    if (fullContent) data.original_content = fullContent;

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

// `source` ships as an opt-in migration
// (database/migration_add_file_source.sql). Until it is applied the column does
// not exist and PostgREST rejects any select or filter naming it, so every read
// falls back once and remembers for this process — an unapplied migration costs
// the generated/uploaded split, not the file list.
// uploaded_files.rag_record_id ships as an opt-in migration
// (database/migration_link_uploaded_files_to_rag.sql). Same one-shot latch as
// `source` below: probe once, remember for the process, keep working either way.
let ragLinkColumnExists = true;
const isMissingRagLinkColumn = (error) => {
  if (error?.code !== '42703' && error?.code !== 'PGRST204') return false;
  const text = `${error?.message || ''} ${error?.details || ''}`.toLowerCase();
  return text.includes('rag_record_id');
};

let sourceColumnExists = true;
// 42703 is Postgres "undefined column" (selects and filters); PGRST204 is
// PostgREST's "column not in the schema cache" (inserts and updates). Matched
// on the codes rather than on message text so an unrelated failure that happens
// to mention a source cannot switch the split off for the whole process.
const isMissingSourceColumn = (error) => {
  if (error?.code !== '42703' && error?.code !== 'PGRST204') return false;
  const text = `${error?.message || ''} ${error?.details || ''}`.toLowerCase();
  return text.includes('source');
};

/**
 * List uploaded files for a user — every chat by default, or one chat's when
 * `topicId` is given.
 * @param {string} userId
 * @param {number} maxFiles - max files to return (default 200)
 * @param {object} [opts]
 * @param {'generated'|'upload'} [opts.source] - only files of this origin
 * @param {string} [opts.topicId] - only files belonging to this conversation
 */
const listAllUserFiles = async (userId, maxFiles = 200, opts = {}) => {
  try {
    if (!userId) return { files: [], totalCount: 0 };

    const { source, topicId } = opts;

    const run = (withSource) => {
      let query = supabase
        .from('uploaded_files_rag')
        .select(
          withSource
            ? 'id, file_name, file_type, created_at, source'
            : 'id, file_name, file_type, created_at',
          { count: 'exact' },
        )
        .eq('user_id', userId);
      if (withSource && source) query = query.eq('source', source);
      if (topicId) query = query.eq('topic_id', topicId);
      return query.order('created_at', { ascending: false }).limit(maxFiles);
    };

    let { data, error, count } = await run(sourceColumnExists);

    if (error && sourceColumnExists && isMissingSourceColumn(error)) {
      console.warn('[listAllUserFiles] uploaded_files_rag.source column not found — run database/migration_add_file_source.sql to separate AI artifacts from user attachments. Listing every file.');
      sourceColumnExists = false;
      ({ data, error, count } = await run(false));
    }

    if (error) {
      console.error('[listAllUserFiles] error:', error.message);
      return { files: [], totalCount: 0 };
    }

    const files = (data || []).map(r => ({
      file_id: r.id,
      file_name: r.file_name,
      file_type: r.file_type,
      created_at: r.created_at,
      source: r.source || 'upload',
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
      .select('id, file_name, topic_id, file_type, original_content, original_file_data, llm_analysis, blob_url, created_at')
      .eq('id', fileId)
      .eq('user_id', userId)
      .single();

    if (error) {
      console.error('[FileContentById] error:', error.message);
      return null;
    }

    const fullContent = await resolveFullFileContent(data, userId);
    if (fullContent) data.original_content = fullContent;

    return data;
  } catch (err) {
    console.error('[FileContentById] Failed:', err);
    return null;
  }
};

/**
 * Delete a file everywhere it exists.
 *
 * "Everywhere" is the point: a chunked upload lives in uploaded_files_rag (the
 * row the UI lists), uploaded_files (the parent of its chunks), rag_chunks (what
 * RAG actually retrieves) and possibly Vercel Blob. Leaving the chunks behind
 * means a file the user deleted is still readable by the model, which is the
 * one thing deleting it was meant to prevent.
 */
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

    // Preferred: the explicit link, which names exactly this file's row.
    // rag_chunks cascades from uploaded_files, so this takes the chunks too.
    let unlinkedByLink = false;
    if (fileRec?.id && ragLinkColumnExists) {
      const { error: linkErr } = await supabase
        .from('uploaded_files')
        .delete()
        .eq('user_id', userId)
        .eq('rag_record_id', fileRec.id);

      if (linkErr && isMissingRagLinkColumn(linkErr)) {
        console.warn('[deleteUploadedFile] uploaded_files.rag_record_id not found — run database/migration_link_uploaded_files_to_rag.sql. Falling back to matching on name.');
        ragLinkColumnExists = false;
      } else if (linkErr) {
        console.warn('[deleteUploadedFile] Linked delete failed:', linkErr.message);
      } else {
        unlinkedByLink = true;
      }
    }

    // Legacy rows carry no link, so the pairing has to be guessed from the
    // name. `topic_id` is matched with .is() when null rather than skipped —
    // skipping is what used to strand the chunks of every unscoped upload.
    //
    // This can still take a same-named sibling's row in the same topic, which
    // is why it only runs when the link was unavailable: over-deleting chunks
    // costs a re-upload, while under-deleting leaves deleted content readable.
    if (!unlinkedByLink && fileRec?.file_name) {
      let query = supabase
        .from('uploaded_files')
        .delete()
        .eq('user_id', userId)
        .eq('file_name', fileRec.file_name);
      query = fileRec.topic_id
        ? query.eq('topic_id', fileRec.topic_id)
        : query.is('topic_id', null);
      const { error: legacyErr } = await query;
      if (legacyErr) console.warn('[deleteUploadedFile] Legacy delete failed:', legacyErr.message);
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

    const buildRow = (withSource) => ({
      file_name: finalName,
      file_type: fileType || 'generated',
      original_content: content,
      llm_analysis: content,
      user_id: userId,
      topic_id: topicId,
      created_at: new Date().toISOString(),
      ...(withSource ? { source: 'generated' } : {}),
    });

    let { data, error } = await supabase
      .from('uploaded_files_rag')
      .insert(buildRow(sourceColumnExists))
      .select()
      .single();

    if (error && sourceColumnExists && isMissingSourceColumn(error)) {
      console.warn('[saveGeneratedFile] uploaded_files_rag.source column not found — run database/migration_add_file_source.sql. Saving without it.');
      sourceColumnExists = false;
      ({ data, error } = await supabase
        .from('uploaded_files_rag')
        .insert(buildRow(false))
        .select()
        .single());
    }

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

    // insert_rag_document has no source parameter — changing its signature would
    // break every caller on an unmigrated database, so tag the row afterwards.
    // A failure here only misfiles the row into Attachments; the file is saved.
    if (insertedId && sourceColumnExists) {
      const { error: srcErr } = await supabase
        .from('uploaded_files_rag')
        .update({ source: 'generated' })
        .eq('id', insertedId);
      if (srcErr) {
        if (isMissingSourceColumn(srcErr)) {
          console.warn('[saveGeneratedBinaryFile] uploaded_files_rag.source column not found — run database/migration_add_file_source.sql.');
          sourceColumnExists = false;
        } else {
          console.warn('[saveGeneratedBinaryFile] source tag failed:', srcErr.message);
        }
      }
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
 * Store a binary the user attached to a message — today, an image pasted into
 * the composer. Deliberately not processUploadedFile: the model is already
 * being shown the image inline, so there is nothing to extract, embed, or
 * charge for. This exists purely so the paste survives the send and stays
 * viewable and downloadable in the chat's Attachments panel.
 *
 * @returns {Promise<{file_id, file_name, file_type, created_at}|null>}
 */
const saveUserAttachment = async (userId, topicId, fileName, buffer, fileType) => {
  try {
    if (!userId || !fileName || !buffer?.length) return null;

    const fileHash = getFileHash(fileName, `${buffer.length}:${buffer.subarray(0, 512).toString('base64')}`);
    // Pasted screenshots all arrive as "image.png"; a timestamp keeps them apart
    // in the panel list without a duplicate-name lookup on every paste.
    const dot = fileName.lastIndexOf('.');
    // 2026-08-30T11:00:13.123Z → 20260830T110013. The fractional seconds are
    // dropped BEFORE the separators go: slicing to a fixed width instead left
    // the trailing '.' on the stamp, naming every paste "..png".
    const stamp = new Date().toISOString().replace(/\.\d+Z$/, '').replace(/[-:]/g, '');
    const finalName = dot > 0
      ? `${fileName.slice(0, dot)}_${stamp}${fileName.slice(dot)}`
      : `${fileName}_${stamp}`;

    const { data, error } = await supabase.rpc('insert_rag_document', {
      p_user_id: userId,
      p_topic_id: topicId || null,
      p_file_name: finalName,
      p_file_hash: fileHash,
      p_file_type: fileType,
      p_original_content: `[Pasted ${fileType} attachment: ${finalName}]`,
      p_llm_analysis: '',
      p_embedding: null,
      p_original_file_b64: buffer.toString('base64'),
    });

    if (error) {
      console.error('[saveUserAttachment] RPC error:', error.message);
      return null;
    }

    let insertedId;
    if (Array.isArray(data)) {
      const first = data[0];
      insertedId = (typeof first === 'object' && first !== null) ? Object.values(first)[0] : first;
    } else {
      insertedId = data;
    }

    console.log(`[saveUserAttachment] Saved ${fileType} attachment: ${finalName} (id: ${insertedId})`);
    return {
      file_id: insertedId,
      file_name: finalName,
      file_type: fileType,
      created_at: new Date().toISOString(),
    };
  } catch (err) {
    console.error('[saveUserAttachment] Failed:', err);
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
  saveUserAttachment,
  getTempDir,
  ensureUploadDir,
  getSupportedFileType,
  isRiskyFileType,
  BLOCKED_RISKY_EXTENSIONS,
  getFileHash,
  analyzeFileWithLLM,
  processZipFile, // exported for unit tests to exercise the ZIP safety limits directly
  textFromStoredBuffer, // exported so the Blob/DB storage-parity tests can call it directly
  resolveFullFileContent,
};
