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
const { trimTextByTokens } = require('./tokenBudget.service');
const crypto = require('crypto');

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
  pdf: 'pdf',
  doc: 'doc',
  docx: 'doc',
  jpg: 'image',
  jpeg: 'image',
  png: 'image',
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
    if (fileType === 'txt') {
      return buffer.toString('utf-8');
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
        const { GoogleGenerativeAI } = require('@google/generative-ai');
        const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
        const model = genAI.getGenerativeModel({ model: 'gemini-2.0-flash' });

        const result = await model.generateContent([
          'Extract all text and important information from this image. Be detailed.',
          {
            inlineData: {
              data: base64Image,
              mimeType: mimeType
            }
          }
        ]);

        const text = result.response.text();
        return text;
      } catch (err) {
        console.error('[Image] Vision API failed:', err.message);
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
const analyzFileWithLLM = async (extractedText, fileName, fileType, modelId, signal = null) => {
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
const saveFileToRAG = async (fileName, fileType, fileContent, llmAnalysis, userId, topicId, signal = null) => {
  try {
    const fileHash = getFileHash(fileName, fileContent);  // ← Use hash

    const { data: ragRecord, error: ragError } = await supabase
      .from('uploaded_files_rag')
      .insert({
        user_id: userId,
        topic_id: topicId,
        file_name: fileName,
        file_hash: fileHash,  // ← Store hash
        file_type: fileType,
        original_content: fileContent.slice(0, 8000),
        llm_analysis: llmAnalysis,
        created_at: new Date().toISOString(),
      })
      .select('id')
      .single();

    if (ragError) throw ragError;
    console.log(`[FileUpload] Stored in RAG: ${fileName} (hash: ${fileHash})`);
    return ragRecord.id;
  } catch (err) {
    console.error('[FileUpload] RAG storage failed:', err);
    throw err;
  }
};

/**
 * Process ZIP file - extract all supported files and analyze each
 */
const processZipFile = async (filePath, fileName, userId, topicId, modelId, signal = null) => {
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
      const { llmAnalysis, tokensUsed } = await analyzFileWithLLM(extractedText, entryName, innerType, modelId, signal);

      // Store in RAG
      const ragId = await saveFileToRAG(
        `${fileName}/${entryName}`,
        innerType,
        extractedText,
        llmAnalysis,
        userId,
        topicId,
        signal
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

  return {
    fileName,
    fileType: 'zip',
    processedFiles: results.length,
    skippedFiles: skipped.length,
    totalTokensUsed: results.reduce((sum, r) => sum + r.tokensUsed, 0),
  };
};

/**
 * Main: Process uploaded file
 */
const processUploadedFile = async (filePath, fileName, fileType, userId, topicId, modelId, signal = null) => {
  try {
    console.log(`[FileUpload] Processing: ${fileName}`);

    if (fileType === 'zip') {
      const result = await processZipFile(filePath, fileName, userId, topicId, modelId, signal);
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
    const { llmAnalysis, tokensUsed } = await analyzFileWithLLM(extractedText, fileName, fileType, modelId, signal);

    await new Promise(resolve => setTimeout(resolve, 1000));

    // 3. Store in RAG globally
    const ragId = await saveFileToRAG(fileName, fileType, extractedText, llmAnalysis, userId, topicId, signal);

    // 4. Cleanup temp file
    cleanupTempFile(filePath);

    console.log(`[FileUpload] Success: ${fileName} analyzed and stored (tokens: ${tokensUsed})`);

    return {
      fileName,
      fileType,
      ragId,
      contentLength: extractedText.length,
      tokensUsed,
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
const searchUserFilesRAG = async (query, userId, topicId, signal = null) => {
  try {
    if (!userId || !topicId) return [];

    const { data, error } = await supabase
      .from('uploaded_files_rag')
      .select('id, file_name, file_hash, llm_analysis, original_content, created_at')
      .eq('user_id', userId)
      .eq('topic_id', topicId)
      .order('created_at', { ascending: false })  // Latest first
      .limit(10);

    if (error) {
      console.error('[FileSearch] Error:', error);
      return [];
    }

    // Simple text matching
    const queryWords = query
      .toLowerCase()
      .split(/\s+/)
      .map(word => word.trim())
      .filter(word => word.length > 1);

    const results = (data || []).filter(doc => {
      const combined = `${doc.file_name} ${doc.llm_analysis} ${doc.original_content || ''}`.toLowerCase();
      return queryWords.some(word => combined.includes(word));
    });

    return results.map(r => {
      const relevantText = r.original_content || r.llm_analysis;

      return {
        file_id: r.id,
        file_name: r.file_name,
        file_hash: r.file_hash,
        chunk_text: trimTextByTokens(relevantText, 300),
        similarity: 0.85,
      };
    });
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
};