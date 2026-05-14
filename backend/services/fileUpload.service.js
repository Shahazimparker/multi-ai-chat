// FILE: backend/services/fileUpload.service.js
// PURPOSE: Handle file uploads, extract text, send directly to LLM, store responses in RAG
// CHANGES: 
//   1. NO embedding - direct LLM processing
//   2. /tmp storage for Vercel (read-only handling)
//   3. Store query+response pairs in RAG globally
//   4. Next query - retrieve past file responses for THIS topic
const calculateCosineSimilarity = (vecA, vecB) => {
  if (!vecA || !vecB) return 0;
  const dotProduct = vecA.reduce((sum, a, i) => sum + a * vecB[i], 0);
  const magA = Math.sqrt(vecA.reduce((sum, a) => sum + a * a, 0));
  const magB = Math.sqrt(vecB.reduce((sum, b) => sum + b * b, 0));
  return magA && magB ? dotProduct / (magA * magB) : 0;
};

const fs = require('fs');
const path = require('path');
const os = require('os');
const JSZip = require('jszip');
const pdfParse = require('pdf-parse');
const mammoth = require('mammoth');
const supabase = require('../config/supabase');
const { MODELS } = require('../config/models');
const { dispatchToAI } = require('./ai/dispatcher.service');
const { trimTextByTokens } = require('./tokenBudget.service');
const crypto = require('crypto');

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
  return SUPPORTED_FILE_TYPES[ext] || null;
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

    if (ragEnabled) {
      const fileVector = await embedText(sanitizedContent.slice(0, 2000), 'openrouter', 3, signal);
      console.log('[RAG Save] Final fileVector type:', typeof fileVector);
      console.log('[RAG Save] Final fileVector is array:', Array.isArray(fileVector));
      console.log('[RAG Save] Final fileVector length:', fileVector?.length);

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

      console.log(`[FileUpload] Stored in RAG: ${fileName} (hash: ${fileHash})`);
    }
    return ragRecord?.id || null;
  } catch (err) {
    console.error('[FileUpload] RAG storage failed:', err);
    throw err;
  }
};

/**
 * Process ZIP file - extract all supported files and analyze each
 */
const processZipFile = async (filePath, fileName, userId, topicId, modelId, signal, ragEnabled) => {
  const zip = await JSZip.loadAsync(fs.readFileSync(filePath));
  const results = [];
  const skipped = [];

  for (const entry of Object.values(zip.files)) {
    if (signal?.aborted) throw { name: 'AbortError' };
    if (entry.dir) continue;

    const entryName = normalizeZipEntryName(entry.name);
    if (!isSafeZipEntryName(entryName)) {
      skipped.push(entry.name);
      continue;
    }

    const innerType = getSupportedFileType(entryName);
    if (!innerType) {
      skipped.push(entryName);
      continue;
    }

    try {
      const buffer = await entry.async('nodebuffer');
      const extractedText = await extractTextFromBuffer(buffer, innerType, modelId, signal, entryName);

      if (!extractedText || extractedText.length < 10) {
        skipped.push(entryName);
        continue;
      }

      // Send to LLM
      const { llmAnalysis, tokensUsed } = await analyzeFileWithLLM(extractedText, entryName, innerType, modelId, signal);

      // Store in RAG
      const ragId = await saveFileToRAG(
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

      results.push({
        fileName: entryName,
        fileType: innerType,
        ragId,
        tokensUsed,
      });
    } catch (err) {
      console.error(`[FileUpload] Error processing ${entryName}:`, err.message);
      skipped.push(entryName);
    }
  }

  if (results.length === 0) {
    throw new Error('ZIP did not contain any processable files');
  }

  const summary = results
    .map(r => `• ${r.fileName} (${r.fileType})`)
    .join('\n')
    .slice(0, 4000);

  return {
    fileName,
    fileType: 'zip',
    processedFiles: results.length,
    skippedFiles: skipped.length,
    totalTokensUsed: results.reduce((sum, r) => sum + r.tokensUsed, 0),
    extractedText: `ZIP "${fileName}" uploaded. ${results.length} file(s) parsed:\n${summary}`,
    message: `✅ ZIP processed. ${results.length} files ready for queries.`
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
    let llmAnalysis, tokensUsed;
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
    tokensUsed = 0;

    await new Promise(resolve => setTimeout(resolve, 1000));

    // 3. Store in RAG
    const ragId = await saveFileToRAG(fileName, fileType, extractedText, llmAnalysis, userId, topicId, signal, ragEnabled, 'openrouter');


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
    if (!userId || !topicId) return [];

    // ✅ ADD: Generate embedding for query
    const { embedText } = require('./rag.service');

    const queryVector = await embedText(query, 'openrouter', 3, signal);
    console.log('[FileSearch] queryVector length:', queryVector?.length);



    if (!queryVector || queryVector.length === 0) {
      console.warn('[FileSearch] Invalid queryVector');
      return [];
    }

    // ✅ CHANGE: Use vector similarity search
    const { data, error } = await supabase
      .from('uploaded_files_rag')
      .select('id, file_name, file_hash, llm_analysis, original_content, created_at, embedding')
      .eq('user_id', userId)
      .eq('topic_id', topicId)
      .not('embedding', 'is', null)
      .limit(5);

    if (error) {
      console.error('[FileSearch] error:', error);
      return [];
    }
    console.log('[FileSearch] data fetched:', data?.length);
    if (!data || data.length === 0) {
      console.warn('[FileSearch] No documents found');
      return [];
    }
    const results = (data || [])
      .filter(doc => doc.embedding)
      .map(doc => {
        let embedding = doc.embedding;

        console.log('[FileSearch] doc.embedding type:', typeof doc.embedding);
        console.log('[FileSearch] Similarity calc:', queryVector.length, 'vs', doc.embedding?.length);
        if (typeof embedding === 'string') {
          try {
            embedding = JSON.parse(embedding);
          } catch {
            console.warn('[FileSearch] Failed to parse embedding');
            return null;
          }
        }
        return {
          ...doc,
          similarity: calculateCosineSimilarity(queryVector, embedding)
        };
      })
      .filter(doc => doc && doc.similarity > 0.3)
      .sort((a, b) => b.similarity - a.similarity);
    console.log('[FileSearch] Final results:', results.length);
    console.log('[FileSearch] Similarity scores:', results.map(r => r.similarity));


    //const relevantText = r.original_content || r.llm_analysis;

    return results.map(r => ({
      file_id: r.id,
      file_name: r.file_name,
      chunk_text: trimTextByTokens(r.original_content || r.llm_analysis, 300),
      similarity: r.similarity,
    }));

  } catch (err) {
    console.error('[FileSearch] Failed:', err);
    return [];
  }
};


/**
 * Delete uploaded file and its RAG records
 */
const deleteUploadedFile = async (fileId, userId) => {
  const { error } = await supabase
    .from('uploaded_files_rag')
    .delete()
    .eq('id', fileId)
    .eq('user_id', userId);

  if (error) throw error;
};

module.exports = {
  processUploadedFile,
  searchUserFilesRAG,
  deleteUploadedFile,
  getTempDir,
  ensureUploadDir,
  getSupportedFileType,
  getFileHash,
  analyzeFileWithLLM,
};