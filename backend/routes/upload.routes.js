// FILE: backend/routes/upload.routes.js
// PURPOSE: Handle file uploads

const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { requireAuth } = require('../middleware/auth');
const { processUploadedFile, searchUserFiles, deleteUploadedFile } = require('../services/fileUpload.service');

// Ensure upload directory exists and use absolute path
const uploadDir = path.join(__dirname, '../uploads');
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
    const allowedTypes = ['text/plain', 'image/jpeg', 'image/png', 'application/pdf', 'application/zip', 'application/x-zip-compressed'];
    
    // Allow .docx by checking extension too
    const ext = file.originalname.split('.').pop().toLowerCase();
    if (['doc', 'docx', 'zip'].includes(ext) || allowedTypes.includes(file.mimetype)) {
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
      pdf: 'pdf',
      doc: 'doc',
      docx: 'doc',
      jpg: 'image',
      jpeg: 'image',
      png: 'image',
      zip: 'zip',
    };
    
    const fileType = fileTypeMap[ext];
    if (!fileType) return res.status(400).json({ error: 'Unsupported file type' });
    
    // Process file
    const result = await processUploadedFile(
      filePath,
      fileName,
      fileType,
      req.user.id,
      topicId,
      modelId,
      abortController.signal
    );
    
    res.json({
      success: true,
      fileId: result.fileId,
      fileName: result.fileName,
      fileType: result.fileType,
      charCount: result.charCount,
      chunkCount: result.chunkCount,
      extractedFiles: result.extractedFiles,
      skippedFiles: result.skippedFiles,
      message: result.fileType === 'zip'
        ? `ZIP processed: ${result.extractedFiles} files, ${result.chunkCount} chunks created`
        : `File processed: ${result.chunkCount} chunks created`,
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
    const { query } = req.query;
    if (!query) return res.status(400).json({ error: 'Query required' });
    
    const results = await searchUserFiles(query, req.user.id);
    
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
