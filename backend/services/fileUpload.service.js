// FILE: backend/services/fileUpload.service.js
// PURPOSE: Handle file uploads, extraction, embedding

const fs = require('fs');
const path = require('path');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const supabase = require('../config/supabase');

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

/**
 * Extract text from different file types
 */
const extractTextFromFile = async (filePath, fileType) => {
  try {
    if (fileType === 'txt') {
      // Plain text — read directly
      return fs.readFileSync(filePath, 'utf-8');
    }
    
    if (fileType === 'image') {
      // Image — use Gemini Vision API
      const imageData = fs.readFileSync(filePath);
      const base64Image = imageData.toString('base64');
      
      const model = genAI.getGenerativeModel({ model: 'gemini-1.5-flash' });
      const result = await model.generateContent([
        {
          inlineData: {
            data: base64Image,
            mimeType: 'image/jpeg', // Adjust as needed
          },
        },
        { text: 'Extract all text and describe what you see. Be detailed.' },
      ]);
      
      return result.response.text();
    }
    
    if (fileType === 'pdf') {
      // PDF — use pdf-parse library
      const pdfParse = require('pdf-parse');
      const dataBuffer = fs.readFileSync(filePath);
      const data = await pdfParse(dataBuffer);
      
      return data.text; // Full PDF text
    }
    
    if (fileType === 'doc') {
      // DOC/DOCX — use mammoth library
      const mammoth = require('mammoth');
      const result = await mammoth.extractRawText({ path: filePath });
      
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
  const chunks = [];
  
  for (let i = 0; i < text.length; i += chunkSize - overlap) {
    chunks.push(text.slice(i, i + chunkSize));
  }
  
  return chunks;
};

/**
 * Create embeddings for text chunks
 */
const createEmbedding = async (text) => {
  try {
    const model = genAI.getGenerativeModel({ model: 'text-embedding-004' });
    const result = await model.embedContent(text);
    
    return result.embedding.values;
  } catch (err) {
    console.error('Embedding creation failed:', err);
    throw err;
  }
};

/**
 * Main: Process uploaded file
 */
const processUploadedFile = async (filePath, fileName, fileType, userId, topicId) => {
  try {
    console.log(`[FileUpload] Processing: ${fileName}`);
    
    // 1. Extract text from file
    const extractedText = await extractTextFromFile(filePath, fileType);
    
    if (!extractedText || extractedText.length < 10) {
      throw new Error('File is empty or unreadable');
    }
    
    // 2. Create embedding for full text
    const fileEmbedding = await createEmbedding(
      extractedText.slice(0, 2000) // Use first 2000 chars for speed
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
      const chunk = chunks[i];
      const chunkEmbedding = await createEmbedding(chunk);
      
      chunkRecords.push({
        file_id: fileRecord.id,
        chunk_text: chunk,
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
const searchUserFiles = async (query, userId, topicId = null) => {
  try {
    // Create embedding for query
    const queryEmbedding = await createEmbedding(query);
    
    // Search database
    const { data, error } = await supabase.rpc('search_uploaded_files', {
      query_embedding: queryEmbedding,
      user_id_param: userId,
      match_count: 5,
    });
    
    if (error) throw error;
    
    return data || [];
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
  createEmbedding,
};