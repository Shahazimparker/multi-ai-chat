// FILE: backend/services/fileUpload.service.js
// PURPOSE: Handle file uploads, extraction, embedding

const fs = require('fs');
const path = require('path');
const axios = require('axios');
const JSZip = require('jszip');
const pdfParse = require('pdf-parse');
const mammoth = require('mammoth');
const supabase = require('../config/supabase');
const { embedText } = require('./rag.service');
const { MODELS } = require('../config/models');
const { dispatchToAI } = require('./ai/dispatcher.service');
const { trimTextByTokens } = require('./tokenBudget.service');

const SUPPORTED_FILE_TYPES = {
  txt: 'txt',
  pdf: 'pdf',
  doc: 'doc',
  docx: 'doc',
  jpg: 'image',
  jpeg: 'image',
  png: 'image',
};

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
      // Plain text — read directly
      return buffer.toString('utf-8');
    }

    if (fileType === 'image') {
      // Image — use Gemini Vision API
      const base64Image = buffer.toString('base64');
      const ext = path.extname(fileName).toLowerCase();
      const mimeTypeMap = {
        '.jpg': 'image/jpeg',
        '.jpeg': 'image/jpeg',
        '.png': 'image/png',
      };
      const mimeType = mimeTypeMap[ext] || 'image/jpeg';

      // Use selected model for extraction if possible, fallback to gemini-1.5-flash-latest
      const extractionModelId = modelId || 'gemini-1.5-flash-latest';
      const modelConfig = MODELS[extractionModelId] || MODELS['gemini-1.5-flash-latest'] || Object.values(MODELS)[0];

      const visionMessages = [{
        role: 'user',
        content: [
          { type: 'text', text: 'Extract all text from this image. If it contains data or tables, represent them clearly. Be detailed.' },
          {
            type: 'image_url',
            image_url: { 
              url: `data:${mimeType};base64,${base64Image}`
            }
          }
        ]
      }];

      const { text } = await dispatchToAI(modelConfig, visionMessages, signal);
      return text;
    }

    if (fileType === 'pdf') {
      // PDF — use pdf-parse library
      const data = await pdfParse(buffer);

      return data.text; // Full PDF text
    }

    if (fileType === 'doc') {
      // DOC/DOCX — use mammoth library
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
 * Split text into chunks (for better RAG)
 */
const chunkText = (text, chunkSize = 500, overlap = 50) => {
  // Split by double newlines first to try and preserve paragraphs
  const paragraphs = text.split(/\n\s*\n/);
  let chunks = [];
  let currentChunk = "";

  for (const para of paragraphs) {
    if ((currentChunk.length + para.length) < chunkSize) {
      currentChunk += (currentChunk ? "\n\n" : "") + para;
    } else {
      if (currentChunk) chunks.push(currentChunk);
      currentChunk = para.slice(0, chunkSize);
    }
  }
  if (currentChunk) chunks.push(currentChunk);
  return chunks;
};

const saveExtractedBuffer = async ({ fileName, fileType, fileSize, extractedText, userId, topicId, provider, signal = null, sourceArchive = null }) => {
  if (!extractedText || extractedText.length < 10) {
    throw new Error(`${fileName} is empty or unreadable`);
  }

  const fileEmbedding = await embedText(extractedText.slice(0, 2000), provider, 3, signal);

  const { data: fileRecord, error: fileError } = await supabase
    .from('uploaded_files')
    .insert({
      user_id: userId,
      topic_id: topicId,
      file_name: fileName,
      file_type: fileType,
      file_size: fileSize,
      provider,
      content_text: extractedText,
      embedding: fileEmbedding,
      metadata: {
        extractedAt: new Date().toISOString(),
        charCount: extractedText.length,
        sourceArchive,
      },
    })
    .select('id')
    .single();

  if (fileError) throw fileError;

  const chunks = chunkText(extractedText);
  const chunkRecords = [];

  for (let i = 0; i < chunks.length; i++) {
    if (signal?.aborted) throw { name: 'AbortError' };

    const chunkEmbedding = await embedText(chunks[i], provider, 3, signal);
    chunkRecords.push({
      file_id: fileRecord.id,
      chunk_text: chunks[i],
      provider,
      embedding: chunkEmbedding,
      chunk_index: i,
    });
  }

  if (chunkRecords.length > 0) {
    const { error: chunkError } = await supabase
      .from('rag_chunks')
      .insert(chunkRecords);

    if (chunkError) throw chunkError;
  }

  return {
    fileId: fileRecord.id,
    fileName,
    fileType,
    chunkCount: chunks.length,
    charCount: extractedText.length,
  };
};

const processZipFile = async (filePath, fileName, userId, topicId, modelId, provider, signal = null) => {
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

    const buffer = await entry.async('nodebuffer');
    const extractedText = await extractTextFromBuffer(buffer, innerType, modelId, signal, entryName);
    const result = await saveExtractedBuffer({
      fileName: `${fileName}/${entryName}`,
      fileType: innerType,
      fileSize: buffer.length,
      extractedText,
      userId,
      topicId,
      provider,
      signal,
      sourceArchive: fileName,
    });
    results.push(result);
  }

  if (results.length === 0) {
    throw new Error('ZIP did not contain any supported readable files');
  }

  return {
    fileId: results[0].fileId,
    fileName,
    fileType: 'zip',
    chunkCount: results.reduce((sum, item) => sum + item.chunkCount, 0),
    charCount: results.reduce((sum, item) => sum + item.charCount, 0),
    extractedFiles: results.length,
    skippedFiles: skipped.length,
  };
};

/**
 * Main: Process uploaded file
 */
const processUploadedFile = async (filePath, fileName, fileType, userId, topicId, modelId, signal = null) => {
  try {
    console.log(`[FileUpload] Processing: ${fileName}`);

    const modelConfig = MODELS[modelId] || MODELS['gemini-1.5-flash-latest'] || Object.values(MODELS)[0];
    const provider = modelConfig?.provider || 'openai';

    if (fileType === 'zip') {
      const result = await processZipFile(filePath, fileName, userId, topicId, modelId, provider, signal);
      fs.unlinkSync(filePath);
      console.log(`[FileUpload] Success: ${fileName} extracted ${result.extractedFiles} files`);
      return result;
    }

    // 1. Extract text from file
    const extractedText = await extractTextFromFile(filePath, fileType, modelId, signal);

    if (!extractedText || extractedText.length < 10) {
      throw new Error('File is empty or unreadable');
    }

    // 2. Create embedding for full text
    const fileEmbedding = await embedText(
      extractedText.slice(0, 2000), // Use first 2000 chars for speed
      provider,
      3,
      signal
    );

    // 3. Save file record to DB
    const { data: fileRecord, error: fileError } = await supabase
      .from('uploaded_files')
      .insert({
        user_id: userId,
        topic_id: topicId,
        file_name: fileName,
        file_type: fileType,
        file_size: fs.statSync(filePath).size,
        provider: provider,
        content_text: extractedText,
        embedding: fileEmbedding,
        metadata: {
          extractedAt: new Date().toISOString(),
          charCount: extractedText.length,
        },
      })
      .select('id')
      .single();

    if (fileError) throw fileError;

    // 4. Split into chunks and create embeddings
    const chunks = chunkText(extractedText);
    const chunkRecords = [];

    for (let i = 0; i < chunks.length; i++) {
      if (signal?.aborted) throw { name: 'AbortError' };

      const chunk = chunks[i];
      const chunkEmbedding = await embedText(chunk, provider, 3, signal);

      // Small delay to prevent hitting API rate limits (429) during heavy file processing
      if (chunks.length > 5) {
        try {
          await new Promise((resolve, reject) => {
          const t = setTimeout(resolve, 200);
          signal?.addEventListener('abort', () => {
            clearTimeout(t);
            reject({ name: 'AbortError' });
          }, { once: true });
        });
        } catch (err) { // Catch AbortError from cancelableDelay
          if (err.name === 'AbortError' || err.name === 'CanceledError') throw err; // Re-throw to break loop
          throw err; // Re-throw other errors
        }
      }

      chunkRecords.push({
        file_id: fileRecord.id,
        chunk_text: chunk,
        provider: provider,
        embedding: chunkEmbedding,
        chunk_index: i,
      });
    }

    // Batch insert chunks
    if (chunkRecords.length > 0) {
      const { error: chunkError } = await supabase
        .from('rag_chunks')
        .insert(chunkRecords);

      if (chunkError) throw chunkError;
    }

    // 5. Cleanup — delete temp file
    fs.unlinkSync(filePath);

    console.log(`[FileUpload] Success: ${fileName} processed`);

    return {
      fileId: fileRecord.id,
      fileName,
      fileType,
      chunkCount: chunks.length,
      charCount: extractedText.length,
    };
  } catch (err) {
    console.error('[FileUpload] Failed:', err);
    // Cleanup on error
    try { fs.unlinkSync(filePath); } catch { }
    throw err;
  }
};

/**
 * Search in user's uploaded files
 */
const searchUserFiles = async (query, userId, topicId = null, provider = 'openai', signal = null, precomputedEmbedding = null) => {
  try {
    if (!userId) return [];

    // Create embedding for query
    const queryEmbedding = precomputedEmbedding || await embedText(query, provider, 3, signal);
    if (!queryEmbedding) return [];

    // Search database
    const { data, error } = await Promise.race([
      supabase.rpc('search_uploaded_files', {
        query_embedding: queryEmbedding,
        user_id_param: userId,
        provider_param: provider,
        match_count: 5,
      }),
      new Promise((_, reject) => {
        if (signal?.aborted) reject({ name: 'AbortError' });
        signal?.addEventListener('abort', () => reject({ name: 'AbortError' }), { once: true });
      })
    ]);

    if (error) throw error;

    return (data || []).map(result => ({
      ...result,
      chunk_text: trimTextByTokens(result.chunk_text, 260),
    }));
  } catch (err) {
    console.error('File search failed:', err);
    return [];
  }
};

/**
 * Delete uploaded file
 */
const deleteUploadedFile = async (fileId, userId) => {
  // First delete all chunks
  await supabase.from('rag_chunks').delete().eq('file_id', fileId);

  // Then delete file record
  const { error } = await supabase
    .from('uploaded_files')
    .delete()
    .eq('id', fileId)
    .eq('user_id', userId); // Ensure user owns file

  if (error) throw error;
};

module.exports = {
  processUploadedFile,
  searchUserFiles,
  deleteUploadedFile,
  chunkText,
};

const extractTextFromFile = async (filePath, fileType, modelId, signal = null) => {
  const buffer = fs.readFileSync(filePath);
  return extractTextFromBuffer(buffer, fileType, modelId, signal, filePath);
};
