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
const pdfParse = require('pdf-parse');
const mammoth = require('mammoth');
const supabase = require('../config/supabase');
const { MODELS } = require('../config/models');
const { dispatchToAI } = require('./ai/dispatcher.service');
const { trimTextByTokens, estimateTokens } = require('./tokenBudget.service');
const crypto = require('crypto');

/**
 * chunkContent — split text into token-aware overlapping chunks
 * Uses estimateTokens() so each chunk stays within embedding model limits
 * @param {string} text
 * @param {number} maxTokens     max tokens per chunk (default 500 — safe for most embedding models)
 * @param {number} overlapTokens token overlap between chunks (default 50)
 * @returns {Array<string>}
 */
const chunkContent = (text, maxTokens = 500, overlapTokens = 50) => {
  if (!text) return [];

  // If entire text fits in one chunk, return as-is
  if (estimateTokens(text) <= maxTokens) return [text];

  const chunks = [];
  // Split into words, preserving whitespace for re-join
  const words = text.split(/(\s+)/);
  let startIdx = 0;

  while (startIdx < words.length) {
    let endIdx = startIdx;
    let runningTokens = 0;

    // Accumulate words until we hit maxTokens
    while (endIdx < words.length) {
      const wordTokens = estimateTokens(words[endIdx]);
      if (runningTokens + wordTokens > maxTokens) break;
      runningTokens += wordTokens;
      endIdx++;
    }

    // If no progress, force at least one word to prevent infinite loop
    if (endIdx === startIdx) {
      endIdx = startIdx + 2; // push at least one word (with its trailing space)
    }

    // Build chunk from words[startIdx .. endIdx)
    const chunk = words.slice(startIdx, endIdx).join('');
    chunks.push(chunk);

    if (endIdx >= words.length) break;

    // Backtrack by overlapTokens worth of words for next chunk
    let backtrackTokens = 0;
    let backtrackIdx = endIdx;
    while (backtrackIdx > startIdx) {
      backtrackTokens += estimateTokens(words[backtrackIdx - 1]);
      if (backtrackTokens > overlapTokens) break;
      backtrackIdx--;
    }
    startIdx = Math.max(backtrackIdx, startIdx + 2); // ensure forward progress
  }

  return chunks;
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

const SUPPORTED_FILE_TYPES = {
  txt: 'txt',
  csv: 'csv',
  xlsx: 'xlsx',
  pdf: 'pdf',
  doc: 'doc',
  docx: 'doc',
  jpg: 'image',
  jpeg: 'image',
  png: 'image',
  zip: 'zip',
  js: 'code',
  ts: 'code',
  py: 'code',
  java: 'code',
  cpp: 'code',
  go: 'code',
  rb: 'code',
  html: 'code',
  json: 'code',
  css: 'code',
  xml: 'code',
  yml: 'code',
  yaml: 'code',
  md: 'code',
  sql: 'code',
  sh: 'code',
  bat: 'code',
  php: 'code',
  rs: 'code',
  swift: 'code',
  kt: 'code',
  vue: 'code',
  svelte: 'code',
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
  const ext = path.extname(fileName).slice(1).toLowerCase();
  return SUPPORTED_FILE_TYPES[ext] || 'other';
};

const normalizeZipEntryName = (entryName) => entryName.replace(/\\/g, '/');

const isSafeZipEntryName = (entryName) => {
  const normalized = normalizeZipEntryName(entryName);
  return Boolean(normalized)
    && !normalized.startsWith('/')
    && !normalized.includes('\0')
    && !normalized.split('/').some(part => part === '..');
};

/**
 * Extract text from different file types
 */
const extractTextFromBuffer = async (buffer, fileType, modelId, signal = null, fileName = '') => {
  try {
    if (fileType === 'txt' || fileType === 'csv') {
      return buffer.toString('utf-8');
    }

    if (fileType === 'xlsx') {
      const XLSX = require('xlsx');
      const workbook = XLSX.read(buffer, { type: 'buffer' });
      const sheets = [];
      workbook.SheetNames.forEach(name => {
        const sheet = workbook.Sheets[name];
        const csv = XLSX.utils.sheet_to_csv(sheet);
        sheets.push(`[Sheet: ${name}]\n${csv}`);
      });
      return sheets.join('\n\n');
    }

    if (fileType === 'image') {
      const base64Image = buffer.toString('base64');
      const ext = path.extname(fileName).toLowerCase();
      const mimeTypeMap = {
        '.jpg': 'image/jpeg',
        '.jpeg': 'image/jpeg',
        '.png': 'image/png',
      };
      const mimeType = mimeTypeMap[ext] || 'image/jpeg';

      try {
        const { callOpenRouter } = require('./ai/openrouter.service');

        const result = await callOpenRouter(
          'google/gemini-2.0-flash-001',
          process.env.OPENROUTER_API_KEY,
          [{
            role: 'user',
            content: [
              {
                type: 'text',
                text: 'Extract all text and important information from this image. Be detailed.',
              },
              {
                type: 'image_url',
                image_url: {
                  url: `data:${mimeType};base64,${base64Image}`,
                },
              },
            ],
          }]
        );

        return result.text;
      } catch (err) {
        console.error('[Image] Vision API via OpenRouter failed:', err.message);
        return `[Image: ${fileName}] - Could not extract text. File uploaded for reference.`;
      }
    }

    if (fileType === 'pdf') {
      const data = await pdfParse(buffer);
      return data.text;
    }

    if (fileType === 'doc') {
      const result = await mammoth.extractRawText({ buffer });
      return result.value;
    }

    if (fileType === 'code') {
      return buffer.toString('utf-8');
    }

    // 'other' — best-effort text extraction for unknown file types
    if (fileType === 'other') {
      // Try UTF-8; if binary, return placeholder
      try {
        const text = buffer.toString('utf-8');
        // Check if it looks like a binary file (contains null bytes or high ratio of non-printable chars)
        const printable = text.replace(/[\x20-\x7E\n\r\t]/g, '').length;
        const nullBytes = text.indexOf('\0');
        if (nullBytes !== -1 || printable > text.length * 0.5) {
          return `[Binary file — content stored for reference. File size: ${(buffer.length / 1024).toFixed(1)} KB]`;
        }
        return text;
      } catch {
        return `[Binary file — content stored for reference. File size: ${(buffer.length / 1024).toFixed(1)} KB]`;
      }
    }

    throw new Error(`Unsupported file type: ${fileType}`);
  } catch (err) {
    console.error(`Text extraction failed for ${fileType}:`, err);
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
const saveFileToRAG = async (fileName, fileType, fileContent, llmAnalysis, userId, topicId, signal = null, ragEnabled = true, provider = 'openrouter') => {
  try {
    const fileHash = getFileHash(fileName, fileContent);

    // Strip null bytes (\u0000) from content to avoid PostgreSQL error
    const sanitizedContent = (fileContent || '').replace(/\0/g, '');
    const sanitizedAnalysis = (llmAnalysis || '').replace(/\0/g, '');

    const { embedText } = require('./rag.service');
    let ragRecord = null;
    let totalEmbedTokens = 0;  // ← track embedding tokens for this upload

    if (ragEnabled) {
      // ── CHUNKING: Split full content for better embedding coverage ──
      const chunks = chunkContent(sanitizedContent, 2000, 200);
      const chunkVectors = [];

      for (let i = 0; i < chunks.length; i++) {
        const result = await embedText(chunks[i], 'openrouter', 3, signal, userId);
        if (result) {
          chunkVectors.push(result.vector);
          totalEmbedTokens += result.tokensUsed;
        }
        // If embedding fails for a chunk, push null to maintain index alignment
        else chunkVectors.push(null);
      }

      // Use first valid vector as the file-level embedding (backward compat)
      const fileVector = chunkVectors.find(v => v !== null) || null;

      const { data, error: ragError } = await supabase
        .rpc('insert_rag_document', {
          p_user_id: userId,
          p_topic_id: topicId,
          p_file_name: fileName,
          p_file_hash: fileHash,
          p_file_type: fileType,
          p_original_content: sanitizedContent,
          p_llm_analysis: sanitizedAnalysis,
          p_embedding: fileVector,
        })
        .select('id')
        .single();

      if (ragError) throw ragError;
      ragRecord = data;

      // ── Store chunks in rag_chunks for granular search ──
      if (chunks.length > 1) {
        // Insert into uploaded_files (legacy table) for FK reference from rag_chunks
        const { data: fileRecord, error: fileErr } = await supabase
          .from('uploaded_files')
          .insert({
            user_id: userId,
            topic_id: topicId,
            file_name: fileName,
            file_type: fileType,
            content_text: sanitizedContent,
            provider: 'openrouter',
            embedding: fileVector,
          })
          .select('id')
          .single();

        if (!fileErr && fileRecord) {
          // Insert each chunk into rag_chunks
          const chunkRows = chunks.map((text, i) => ({
            file_id: fileRecord.id,
            chunk_text: text,
            provider: 'openrouter',
            embedding: chunkVectors[i] || fileVector,
            chunk_index: i,
          }));

          const { error: chunkErr } = await supabase
            .from('rag_chunks')
            .insert(chunkRows);

          if (chunkErr) {
            console.warn(`[FileUpload] Failed to store chunks in rag_chunks: ${chunkErr.message}`);
          } else {
            console.log(`[FileUpload] Stored ${chunks.length} chunks in rag_chunks for: ${fileName}`);
          }
        }
      }

      // Store in code_files if code (only when RAG is enabled)
      const codeExtensions = ['js', 'ts', 'py', 'java', 'cpp', 'go', 'rb'];
      const ext = fileName.split('.').pop().toLowerCase();

      if (codeExtensions.includes(ext)) {
        await supabase
          .from('code_files')
          .delete()
          .eq('file_name', fileName)
          .eq('topic_id', topicId);

        await supabase
          .from('code_files')
          .insert({
            user_id: userId,
            topic_id: topicId,
            file_name: fileName,
            file_type: fileType,
            content: fileContent,
            language: detectLanguage(fileName),
            file_hash: fileHash,
            rag_record_id: ragRecord?.id || null
          });
      }

      console.log(`[FileUpload] Stored in RAG: ${fileName} (hash: ${fileHash}, chunks: ${chunks.length}, embedTokens: ${totalEmbedTokens})`);
    }
    return { ragId: ragRecord?.id || null, embedTokens: totalEmbedTokens };
  } catch (err) {
    console.error('[FileUpload] RAG storage failed:', err);
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
    const promise = fn(item, index).then(result => ({ index, result }));
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
    if (s.status === 'fulfilled') results.push(s.value);
  }

  // Re-sort by original index
  results.sort((a, b) => a.index - b.index);
  return results.map(r => r.result);
};

/**
 * Process ZIP file - extract all supported files and analyze each
 * Uses concurrent workers (default: 3) to speed up large ZIPs
 */
const processZipFile = async (filePath, fileName, userId, topicId, modelId, signal, ragEnabled) => {
  const CONCURRENCY = 3; // process 3 files at a time inside ZIP
  const zip = await JSZip.loadAsync(fs.readFileSync(filePath));
  const skipped = [];

  // Filter to processable entries first
  const entries = Object.values(zip.files).filter(entry => {
    if (signal?.aborted) throw { name: 'AbortError' };
    if (entry.dir) return false;

    const entryName = normalizeZipEntryName(entry.name);
    if (!isSafeZipEntryName(entryName)) {
      skipped.push(entry.name);
      return false;
    }

    const innerType = getSupportedFileType(entryName);
    if (!innerType) {
      skipped.push(entryName);
      return false;
    }

    return true;
  });

  console.log(`[FileUpload] ZIP has ${entries.length} processable entries (concurrency=${CONCURRENCY})`);

  // Process entries concurrently with bounded concurrency
  const results = await mapConcurrent(entries, CONCURRENCY, async (entry) => {
    if (signal?.aborted) throw { name: 'AbortError' };

    const entryName = normalizeZipEntryName(entry.name);
    const innerType = getSupportedFileType(entryName);

    try {
      const buffer = await entry.async('nodebuffer');
      const extractedText = await extractTextFromBuffer(buffer, innerType, modelId, signal, entryName);

      if (!extractedText || extractedText.length < 10) {
        skipped.push(entryName);
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

      return {
        fileName: entryName,
        fileType: innerType,
        ragId: saveResult.ragId,
        tokensUsed: saveResult.embedTokens,
      };
    } catch (err) {
      console.error(`[FileUpload] Error processing ${entryName}:`, err.message);
      skipped.push(entryName);
      return null;
    }
  });

  const validResults = results.filter(Boolean);

  if (validResults.length === 0) {
    throw new Error('ZIP did not contain any processable files');
  }

  const summary = validResults
    .map(r => `• ${r.fileName} (${r.fileType})`)
    .join('\n')
    .slice(0, 4000);

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
const processUploadedFile = async (filePath, fileName, fileType, userId, topicId, modelId, signal = null, ragEnabled = true) => {

  try {
    console.log(`[FileUpload] Processing: ${fileName}`);

    if (fileType === 'zip') {
      const result = await processZipFile(filePath, fileName, userId, topicId, modelId, signal,ragEnabled);
      cleanupTempFile(filePath);
      return result;
    }

    // 1. Extract text from file
    const buffer = fs.readFileSync(filePath);
    const extractedText = await extractTextFromBuffer(buffer, fileType, modelId, signal, fileName);

    if (!extractedText || extractedText.length < 10) {
      throw new Error('File is empty or unreadable');
    }

    // 2. Send directly to LLM (no embedding!)
    let llmAnalysis, tokensUsed = 0;
    if (!ragEnabled) {
      const result = await analyzeFileWithLLM(extractedText, fileName, fileType, modelId, signal);
      llmAnalysis = result.llmAnalysis;
      tokensUsed = result.tokensUsed;

      cleanupTempFile(filePath);

      return {
        fileName,
        fileType,
        ragId: null,
        contentLength: extractedText.length,
        tokensUsed,
        extractedText: extractedText.slice(0, 5000),
        message: `✅ File "${fileName}" uploaded. Content ready for chat.`
      };
    }


    // Only reach here if ragEnabled = true
    llmAnalysis = `File: ${fileName} (${fileType})

Content length: ${extractedText.length} characters

Preview:
${extractedText.slice(0, 1000)}

Upload timestamp: ${new Date().toISOString()}

File ready for queries.`;

    await new Promise(resolve => setTimeout(resolve, 1000));

    // 3. Store in RAG — now returns { ragId, embedTokens }
    const saveResult = await saveFileToRAG(fileName, fileType, extractedText, llmAnalysis, userId, topicId, signal, ragEnabled, 'openrouter');
    const ragId = saveResult.ragId;
    tokensUsed = saveResult.embedTokens;  // ← actual embedding token cost

    // 4. Cleanup temp file
    cleanupTempFile(filePath);

    console.log(`[FileUpload] Success: ${fileName} analyzed and stored (tokens: ${tokensUsed})`);

    return {
      fileName,
      fileType,
      ragId,
      contentLength: extractedText.length,
      tokensUsed,
      extractedText: extractedText.slice(0, 5000),
      message: `✅ File "${fileName}" uploaded successfully. You can now ask questions about it.`
    };
  } catch (err) {
    console.error('[FileUpload] Failed:', err);
    cleanupTempFile(filePath);
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

    // Use DB-side vector search via IVFFLAT index (search_uploaded_files RPC)
    const { data, error } = await supabase.rpc('search_uploaded_files', {
      query_embedding: queryVector,
      user_id_param: userId,
      provider_param: provider,
      match_count: 5,
      topic_id_param: topicId,
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
const getFileContent = async (fileId, userId, topicId) => {
  try {
    if (!fileId || !userId || !topicId) return null;

    const { data, error } = await supabase
      .from('uploaded_files_rag')
      .select('id, file_name, file_type, original_content, llm_analysis, created_at')
      .eq('id', fileId)
      .eq('user_id', userId)
      .eq('topic_id', topicId)
      .single();

    if (error) {
      console.error('[FileContent] Fetch error:', error.message);
      return null;
    }

    return data;
  } catch (err) {
    console.error('[FileContent] Failed:', err);
    return null;
  }
};

/**
 * List uploaded files for a topic (no similarity filter)
 * @param {string} userId
 * @param {string} topicId
 * @param {number} maxFiles - max files to return (default 200)
 */
const listUserFiles = async (userId, topicId, maxFiles = 200) => {
  try {
    if (!userId || !topicId) return [];

    const { data, error, count } = await supabase
      .from('uploaded_files_rag')
      .select('id, file_name, file_type, created_at', { count: 'exact' })
      .eq('user_id', userId)
      .eq('topic_id', topicId)
      .order('created_at', { ascending: false })
      .limit(maxFiles);

    if (error) {
      console.error('[listUserFiles] error:', error.message);
      return [];
    }

    const files = (data || []).map(r => ({
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
      .select('id, file_name, file_type, original_content, llm_analysis, created_at')
      .eq('id', fileId)
      .eq('user_id', userId)
      .single();

    if (error) {
      console.error('[FileContentById] error:', error.message);
      return null;
    }

    return data;
  } catch (err) {
    console.error('[FileContentById] Failed:', err);
    return null;
  }
};

const deleteUploadedFile = async (fileId, userId) => {
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

module.exports = {
  processUploadedFile,
  searchUserFilesRAG,
  getFileContent,
  getFileContentById,
  listUserFiles,
  listAllUserFiles,
  deleteUploadedFile,
  saveGeneratedFile,
  getTempDir,
  ensureUploadDir,
  getSupportedFileType,
  getFileHash,
  analyzeFileWithLLM,
};