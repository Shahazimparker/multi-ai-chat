// FILE: backend/routes/upload.routes.js
// PURPOSE: Handle file uploads

const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { requireAuth } = require('../middleware/auth');
const supabase = require('../config/supabase');
const { processUploadedFile, searchUserFilesRAG, getFileContent, getFileContentById, deleteUploadedFile, getSupportedFileType, listAllUserFiles, saveGeneratedFile } = require('../services/fileUpload.service');


// Use OS temp dir so uploaded files don't trigger nodemon restarts
const uploadDir = path.join(os.tmpdir(), 'multi-ai-chat-uploads');
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
    // Determine file type via shared service (returns 'other' for unknown)
    const fileType = getSupportedFileType(req.file.originalname);

    // ── SSE setup ──
    try {
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
      });
      res.flushHeaders();
    } catch (sseErr) {
      console.error('[Upload] SSE setup failed:', sseErr);
      if (!res.headersSent) {
        return res.status(500).json({ error: 'SSE setup failed' });
      }
    }
    try {
      if (res.socket) res.socket.setNoDelay(true);
    } catch (noDelayErr) {
      console.error('[Upload] setNoDelay failed:', noDelayErr);
    }

    // Guard: if client disconnects, prevent further writes
    res.on('close', () => {
      console.log('[Upload] Response closed');
    });

    // Send initial progress event
    const sendProgress = (data) => {
      if (!res.writableEnded && !res.destroyed) {
        try {
          res.write(`data: ${JSON.stringify(data)}\n\n`);
        } catch (writeErr) {
          console.error('[Upload] SSE write error:', writeErr);
        }
      }
    };

    sendProgress({ type: 'progress', phase: 'starting', percent: 0, message: 'Starting file processing...' });

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
      abortController.signal,
      ragEnabled,
      sendProgress   // ← pass SSE progress callback
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

    // Send final done event
    sendProgress({
      type: 'done',
      success: true,
      ...result,
      message: result.message,
      extractedText: result.extractedText,
    });
    res.end();

  } catch (err) {
    console.error('[Upload] Error:', err.message, err.stack ? '\n' + err.stack : '');
    if (!res.writableEnded && !res.destroyed) {
      try {
        res.write(`data: ${JSON.stringify({ type: 'error', error: err.message || 'File upload failed' })}\n\n`);
        res.end();
      } catch (writeErr) {
        console.error('[Upload] Failed to send error via SSE:', writeErr);
      }
    }
  }
});

/**
 * GET /api/upload/files
 * List all uploaded files for the current user (cross-chat)
 */
router.get('/files', requireAuth, async (req, res) => {
  try {
    const result = await listAllUserFiles(req.user.id);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
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

/**
 * GET /api/upload/preview/:fileId
 * Preview file content by ID (cross-chat, no topicId required)
 */
router.get('/preview/:fileId', requireAuth, async (req, res) => {
  try {
    const { fileId } = req.params;
    const fileData = await getFileContentById(fileId, req.user.id);
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

/**
 * GET /api/upload/download/:fileId
 * Download file content as a text file (cross-chat, no topicId required)
 */
router.get('/download/:fileId', requireAuth, async (req, res) => {
  try {
    const { fileId } = req.params;
    const fileData = await getFileContentById(fileId, req.user.id);
    if (!fileData) {
      return res.status(404).json({ error: 'File not found or access denied' });
    }
    const content = fileData.original_content || fileData.llm_analysis || '';
    const fileName = fileData.file_name || `file_${fileId}.txt`;
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${fileName}.txt"`);
    res.send(content);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/upload/generate-file
 * Save AI-generated file content to DB (topic-specific)
 */
router.post('/generate-file', requireAuth, async (req, res) => {
  try {
    const { topicId, fileName, content, fileType } = req.body;
    if (!fileName || !content) {
      return res.status(400).json({ error: 'fileName and content are required' });
    }
    const result = await saveGeneratedFile(req.user.id, topicId || null, fileName, content, fileType);
    if (!result) {
      return res.status(500).json({ error: 'Failed to save generated file' });
    }
    res.json({ file: result });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
