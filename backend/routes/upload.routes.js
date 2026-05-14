// FILE: backend/routes/upload.routes.js
// PURPOSE: Handle file uploads

const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { requireAuth } = require('../middleware/auth');
const { processUploadedFile, searchUserFilesRAG, deleteUploadedFile, getSupportedFileType } = require('../services/fileUpload.service');


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
  limits: { fileSize: 50 * 1024 * 1024 }, // 50MB limit
  fileFilter: (req, file, cb) => {
    const allowedTypes = ['text/plain', 'text/csv', 'text/javascript', 'application/javascript', 'image/jpeg', 'image/png', 'application/pdf', 'application/zip', 'application/x-zip-compressed', 'application/x-rar-compressed', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'];

    // Allow by extension too
    const ext = file.originalname.split('.').pop().toLowerCase();
    if (['csv', 'xlsx', 'doc', 'docx', 'zip', 'js', 'mjs', 'cjs', 'html', 'json', 'css', 'xml', 'yml', 'yaml', 'md', 'sql', 'sh', 'bat', 'php', 'rs', 'swift', 'kt', 'vue', 'svelte', 'rb', 'go', 'cpp', 'java', 'py', 'ts'].includes(ext) || allowedTypes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error(`File type not allowed: ${file.mimetype}`));
    }
  },
});

/**
 * POST /api/upload/file
 * Upload and process a file
 */
router.post('/file', requireAuth, upload.single('file'), async (req, res) => {
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

    const results = await searchUserFilesRAG(query, req.user.id, topicId);
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

module.exports = router;
