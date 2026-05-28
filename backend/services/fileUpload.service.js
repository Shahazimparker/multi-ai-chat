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
const { loadDocument } = require('./documentLoader.service');
const { splitText } = require('./textSplitter.service');

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
 * Extract text from different file types using DocumentLoader
 * Keeps original file binary unchanged — loader only extracts text for AI
 */
const extractTextFromBuffer = async (buffer, fileType, modelId, signal = null, fileName = '') => {
  try {
    if (signal?.aborted) return '';

    // Vision API wrapper for images
    const visionApiCall = async (base64Image, mimeType) => {
      if (fileType !== 'image') return null;

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
        return null;
      }
    };

    // Use DocumentLoader for unified extraction
    const doc = await loadDocument(buffer, fileName, visionApiCall);
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
const saveFileToRAG = async (fileName, fileType, fileContent, llmAnalysis, userId, topicId, signal = null, ragEnabled = true, provider = 'openrouter', onProgress = null, fileBuffer = null) => {
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

      for (let i = 0; i < chunks.length; i++) {
        if (signal?.aborted) throw new Error('Upload cancelled by user');
        if (onProgress) {
          const pct = Math.round(((i) / Math.max(chunks.length, 1)) * 100);
          onProgress({ type: 'progress', phase: 'embedding', percent: pct, message: `Embedding chunk ${i + 1}/${chunks.length} for ${fileName}` });
        }
        const result = await embedText(chunks[i], 'openrouter', 3, signal, userId);
        if (signal?.aborted) throw new Error('Upload cancelled by user');
        if (result) {
          chunkVectors.push(result.vector);
          totalEmbedTokens += result.tokensUsed;
        } else chunkVectors.push(null);
      }

      const fileVector = chunkVectors.find(v => v !== null) || null;

      const { data: ragData, error: ragError } = await supabase
        .rpc('insert_rag_document', {
          p_user_id: userId, p_topic_id: topicId || null,
          p_file_name: fileName, p_file_hash: fileHash,
          p_file_type: fileType, p_original_content: sanitizedContent,
          p_llm_analysis: sanitizedAnalysis, p_embedding: fileVector,
          p_original_file_b64: fileBuffer ? fileBuffer.toString('base64') : null,
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

      if (chunks.length > 1) {
        const { data: fr, error: fileErr } = await supabase
          .from('uploaded_files').insert({
            user_id: userId, topic_id: topicId,
            file_name: fileName, file_type: fileType,
            content_text: sanitizedContent, provider: 'openrouter',
            embedding: fileVector,
          }).select('id').single();

        if (!fileErr && fr) {
          fileRecord = fr;
          const { error: chunkErr } = await supabase
            .from('rag_chunks').insert(chunks.map((text, i) => ({
              file_id: fileRecord.id, chunk_text: text,
              provider: 'openrouter', embedding: chunkVectors[i] || fileVector,
              chunk_index: i,
            })));
          if (chunkErr) console.warn(`[FileUpload] rag_chunks error: ${chunkErr.message}`);
          else { chunksStored = true; console.log(`[FileUpload] Stored ${chunks.length} chunks for: ${fileName}`); }
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

      console.log(`[FileUpload] Stored in RAG: ${fileName} (hash: ${fileHash}, chunks: ${chunks.length}, embedTokens: ${totalEmbedTokens})`);
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

    const innerType = getSupportedFileType(entryName);
    if (!innerType) {
      skipped.push(entryName);
      return false;
    }

    return true;
  });

  console.log(`[FileUpload] ZIP has ${entries.length} processable entries (concurrency=${CONCURRENCY})`);

  let validResults = [];
  let completedCount = 0;
  const total = entries.length;

  try {
    onProgress?.({ type: 'progress', phase: 'extracting', percent: 5, message: `ZIP contains ${total} processable files. Starting...` });

    // Process entries concurrently with bounded concurrency
    const results = await mapConcurrent(entries, CONCURRENCY, async (entry) => {
      const entryName = normalizeZipEntryName(entry.name);
      const innerType = getSupportedFileType(entryName);

      try {
        if (signal?.aborted) throw { name: 'AbortError' };
        const buffer = await entry.async('nodebuffer');
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
const processUploadedFile = async (filePath, fileName, fileType, userId, topicId, modelId, signal = null, ragEnabled = true, onProgress = null) => {

  try {
    if (signal?.aborted) {
      cleanupTempFile(filePath);
      throw new Error('Upload cancelled by user');
    }
    console.log(`[FileUpload] Processing: ${fileName}`);

    if (fileType === 'zip') {
      const result = await processZipFile(filePath, fileName, userId, topicId, modelId, signal, ragEnabled, onProgress);
      cleanupTempFile(filePath);
      return result;
    }

    // 1. Extract text from file
    onProgress?.({ type: 'progress', phase: 'extracting', percent: 5, message: 'Extracting text from file...' });
    const buffer = fs.readFileSync(filePath);
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

      cleanupTempFile(filePath);

      onProgress?.({ type: 'progress', phase: 'complete', percent: 100, message: 'File processed successfully' });

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
    onProgress?.({ type: 'progress', phase: 'analyzing', percent: 20, message: 'Preparing file for RAG storage...' });

    llmAnalysis = `File: ${fileName} (${fileType})

Content length: ${extractedText.length} characters

Preview:
${extractedText.slice(0, 1000)}

Upload timestamp: ${new Date().toISOString()}

File ready for queries.`;

    await new Promise(resolve => setTimeout(resolve, 1000));

    // 3. Store in RAG — wrap onProgress to map embedding 0-100% → overall 30-95%
    onProgress?.({ type: 'progress', phase: 'embedding', percent: 30, message: 'Embedding file content...' });
    const embedOnProgress = onProgress ? (data) => {
      if (data.type === 'progress') {
        const mapped = 30 + Math.round((data.percent / 100) * 65);
        onProgress({ ...data, percent: Math.min(mapped, 95) });
      }
    } : null;
    const saveResult = await saveFileToRAG(fileName, fileType, extractedText, llmAnalysis, userId, topicId, signal, ragEnabled, 'openrouter', embedOnProgress, buffer);
    const ragId = saveResult.ragId;
    tokensUsed = saveResult.embedTokens;  // ← actual embedding token cost

    // 4. Cleanup temp file
    cleanupTempFile(filePath);

    onProgress?.({ type: 'progress', phase: 'complete', percent: 100, message: 'File processed successfully' });

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
      .select('id, file_name, file_type, original_content, original_file_data, llm_analysis, created_at')
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
  getFileHash,
  analyzeFileWithLLM,
};