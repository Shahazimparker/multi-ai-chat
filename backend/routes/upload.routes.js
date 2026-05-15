// FILE: backend/routes/upload.routes.js
// PURPOSE: Handle file uploads

const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { requireAuth } = require('../middleware/auth');
const supabase = require('../config/supabase');
const { processUploadedFile, searchUserFilesRAG, getFileContent, deleteUploadedFile, getSupportedFileType } = require('../services/fileUpload.service');


// Ensure upload directory exists and use absolute path
const uploadDir =
  process.env.VERCEL || process.env.NODE_ENV === 'production'
    ? '/tmp/uploads'
    : path.join(__dirname, '../uploads');
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

// Configure multer for file uploads
const storage = multer.diskStorage({
  destination: uploadDir,
  filename: (req, file, cb) => {
    cb(null, `${Date.now()}-${file.originalname}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 200 * 1024 * 1024 }, // 200MB limit (increased from 50MB for large ZIPs)
});

// ── Timeout middleware for upload routes ──
// Large ZIPs can take several minutes to extract + embed
const UPLOAD_TIMEOUT_MS = 10 * 60 * 1000; // 10 minutes
const uploadTimeout = (req, res, next) => {
  req.setTimeout(UPLOAD_TIMEOUT_MS, () => {
    console.error('[Upload] Request timed out after', UPLOAD_TIMEOUT_MS, 'ms');
    if (!res.headersSent) {
      res.status(503).json({ error: 'Upload processing timed out. Try a smaller file or fewer files inside the ZIP.' });
    }
  });
  next();
};

/**
 * POST /api/upload/file
 * Upload and process a file
 */
router.post('/file', requireAuth, uploadTimeout, upload.single('file'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No file provided' });

    const abortController = new AbortController();
    req.on('close', () => {
      if (!res.writableEnded) {
        console.log('[Upload] Request closed. Aborting file processing...');
        abortController.abort();
      }
    });

    const { topicId, modelId } = req.body;
    const fileName = req.file.originalname;
    const filePath = req.file.path;

    // Determine file type
    const ext = fileName.split('.').pop().toLowerCase();
    const fileTypeMap = {
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
      mjs: 'code',
      cjs: 'code',
      rb: 'code',
      go: 'code',
      cpp: 'code',
      java: 'code',
      py: 'code',
      ts: 'code',
      js: 'code',
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

    const fileType = fileTypeMap[ext];
    if (!fileType) return res.status(400).json({ error: 'Unsupported file type' });

    // Process file
    req.on('aborted', () => abortController.abort());
    const ragEnabled = req.body.ragEnabled === 'true' || req.body.ragEnabled === true;
    console.log('[Upload] ragEnabled:', ragEnabled, 'req.body:', req.body);

    const result = await processUploadedFile(
      req.file.path,
      req.file.originalname,
      getSupportedFileType(req.file.originalname),
      req.user.id,
      topicId,
      modelId,
      abortController.signal,  // ← NEW
      ragEnabled
    );

    // ── Deduct embedding tokens used during file upload ──
    if (result.tokensUsed > 0) {
      const { data: user } = await supabase
        .from('users')
        .select('used_tokens')
        .eq('id', req.user.id)
        .single();

      if (user) {
        await supabase
          .from('users')
          .update({ used_tokens: user.used_tokens + result.tokensUsed })
          .eq('id', req.user.id);
        console.log(`[Upload] Deducted ${result.tokensUsed} tokens for file embedding`);
      }
    }

    res.json({
      success: true,
      ...result,
      message: result.message,  // ← ADD: Show user-friendly message
      extractedText: result.extractedText,  // ← ADD: Send content to frontend
    });

  } catch (err) {
    console.error('[Upload] Error:', err.message);
    res.status(500).json({ error: err.message || 'File upload failed' });
  }
});

/**
 * GET /api/upload/search
 * Search in uploaded files
 */

router.get('/search', requireAuth, async (req, res) => {
  try {
    const { query, topicId } = req.query; // ← ADD topicId
    if (!query) return res.status(400).json({ error: 'Query required' });

    const searchResult = await searchUserFilesRAG(query, req.user.id, topicId);
    const results = searchResult.results || [];
    res.json({
      query,
      results,
      count: results.length,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * DELETE /api/upload/:fileId
 * Delete uploaded file
 */
router.delete('/:fileId', requireAuth, async (req, res) => {
  try {
    const { fileId } = req.params;

    await deleteUploadedFile(fileId, req.user.id);

    res.json({ message: 'File deleted successfully' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/upload/content/:fileId
 * Fetch full file content by file ID (used by hybrid tool approach)
 * The AI calls this via [GET_FILE:id=<fileId>] and the server fetches it
 */
router.get('/content/:fileId', requireAuth, async (req, res) => {
  try {
    const { fileId } = req.params;
    const { topicId } = req.query;

    if (!topicId) {
      return res.status(400).json({ error: 'topicId query parameter is required' });
    }

    const fileData = await getFileContent(fileId, req.user.id, topicId);

    if (!fileData) {
      return res.status(404).json({ error: 'File not found or access denied' });
    }

    res.json({
      id: fileData.id,
      file_name: fileData.file_name,
      file_type: fileData.file_type,
      content: fileData.original_content || fileData.llm_analysis || '',
      created_at: fileData.created_at,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
