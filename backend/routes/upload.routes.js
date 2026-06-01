// FILE: backend/routes/upload.routes.js
// PURPOSE: Handle file uploads

const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const os = require('os');
const crypto = require('crypto');

// ── Sanitize filename: strip path traversal, null bytes, CRLF ──
const sanitizeFilename = (name) => {
  if (!name || typeof name !== 'string') return 'untitled';
  // Strip path separators and drive letters
  let clean = name
    .replace(/[/\\]/g, '_')           // path separators → _
    .replace(/\0/g, '')               // null bytes
    .replace(/[\r\n]/g, '')           // CRLF injection
    .replace(/^[a-zA-Z]:/, '')        // Windows drive letter (C:)
    .replace(/\.\./g, '')             // parent dir traversal
    .replace(/["']/g, '');            // quotes (header injection)
  // Collapse multiple underscores and trim
  clean = clean.replace(/_+/g, '_').replace(/^_|_$/g, '');
  // Fallback if everything was stripped
  return clean || 'untitled';
};

// ── Upload session store — tracks active uploads for cancel, status polling, and resume ──
// Value: { controller, status, progress, message, phase, result, error }
const uploadSessions = new Map();
// Clean stale sessions every 60s
setInterval(() => {
  const now = Date.now();
  for (const [id, s] of uploadSessions) {
    if (s.status !== 'processing' && now - s.ts > 60000) uploadSessions.delete(id);
  }
}, 60000);

// ── MIME type map for download ──
const MIME_MAP = {
  txt: 'text/plain',
  csv: 'text/csv',
  json: 'application/json',
  xml: 'application/xml',
  html: 'text/html',
  htm: 'text/html',
  css: 'text/css',
  js: 'text/javascript',
  mjs: 'text/javascript',
  ts: 'application/typescript',
  py: 'text/x-python',
  java: 'text/x-java',
  rb: 'text/x-ruby',
  go: 'text/x-go',
  rs: 'text/x-rust',
  cpp: 'text/x-c++',
  c: 'text/x-c',
  h: 'text/x-c',
  sh: 'application/x-sh',
  yaml: 'text/yaml',
  yml: 'text/yaml',
  md: 'text/markdown',
  pdf: 'application/pdf',
  doc: 'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xls: 'application/vnd.ms-excel',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  ppt: 'application/vnd.ms-powerpoint',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  svg: 'image/svg+xml',
  webp: 'image/webp',
  zip: 'application/zip',
  gz: 'application/gzip',
  tar: 'application/x-tar',
  mp3: 'audio/mpeg',
  mp4: 'video/mp4',
};
const getMimeType = (fileName) => {
  const ext = path.extname(fileName).toLowerCase().replace('.', '');
  return MIME_MAP[ext] || 'application/octet-stream';
};
const { requireAuth } = require('../middleware/auth');
const supabase = require('../config/supabase');
const { processUploadedFile, searchUserFilesRAG, getFileContent, getFileContentById, deleteUploadedFile, getSupportedFileType, listAllUserFiles, saveGeneratedFile } = require('../services/fileUpload.service');
const { generateImage } = require('../services/imageGeneration.service');
const { generatePPT } = require('../services/pptGeneration.service');


// Use OS temp dir so uploaded files don't trigger nodemon restarts
const uploadDir = path.join(os.tmpdir(), 'multi-ai-chat-uploads');
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

// Configure multer for file uploads
const storage = multer.diskStorage({
  destination: uploadDir,
  filename: (req, file, cb) => {
    cb(null, `${Date.now()}-${sanitizeFilename(file.originalname)}`);
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
  let sessionId = null;
  let abortController = null;
  let updateSession = null;

  // Create session before try so catch can also update it
  if (req.file) {
    abortController = new AbortController();
    sessionId = crypto.randomUUID();
    uploadSessions.set(sessionId, {
      controller: abortController,
      status: 'processing',
      progress: 0,
      message: 'Starting...',
      phase: 'uploading',
      result: null,
      error: null,
      ts: Date.now(),
    });

    updateSession = (updates) => {
      const s = uploadSessions.get(sessionId);
      if (s) Object.assign(s, updates, { ts: Date.now() });
    };
  }

  try {
    if (!req.file) return res.status(400).json({ error: 'No file provided' });

    // Detect client disconnect but DON'T abort — upload continues in background
    const onDisconnect = () => {
      console.log('[Upload] Client disconnected (navigated away). Upload continues in background.');
    };
    req.on('close', onDisconnect);
    req.on('aborted', onDisconnect);
    res.on('close', onDisconnect);

    const { topicId, modelId } = req.body;
    const fileName = req.file.originalname;
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

    res.on('close', () => {
      console.log('[Upload] Response closed');
    });

    const sendProgress = (data) => {
      // Store progress in session for status polling
      if (data.type === 'progress') {
        updateSession({ progress: data.percent, message: data.message || '', phase: data.phase || 'processing' });
      }
      if (!res.writableEnded && !res.destroyed) {
        try {
          res.write(`data: ${JSON.stringify(data)}\n\n`);
        } catch (writeErr) {
          console.error('[Upload] SSE write error:', writeErr);
        }
      }
    };

    // Send sessionId to frontend so it can call cancel endpoint
    sendProgress({ type: 'init', sessionId, percent: 0, message: 'Starting file processing...' });

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
      sendProgress
    );

    // ── Deduct embedding tokens (atomic — no race condition) ──
    if (result.tokensUsed > 0) {
      const { error: tokenErr } = await supabase.rpc('increment_user_tokens', {
        user_id: req.user.id,
        token_amount: result.tokensUsed,
      });
      if (tokenErr) {
        console.warn('[Upload] Token deduction failed:', tokenErr.message);
      } else {
        console.log(`[Upload] Deducted ${result.tokensUsed} tokens for file embedding`);
      }
    }

    // Mark as done but keep in Map for 60s so frontend can poll status
    updateSession({ status: 'done', progress: 100, phase: 'complete', result });

    sendProgress({
      type: 'done',
      success: true,
      ...result,
      message: result.message,
      extractedText: result.extractedText,
    });
    res.end();

  } catch (err) {
    const isAbort = err.name === 'AbortError' || err.name === 'CanceledError' || err.message === 'Upload cancelled by user';
    updateSession({ status: isAbort ? 'aborted' : 'error', error: err.message });
    console.error(`[Upload] ${isAbort ? 'Aborted' : 'Error'}:`, err.message);

    // Safety-net: ensure temp file is cleaned even if service-layer cleanup was missed
    if (req.file?.path) {
      try {
        if (fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
      } catch (cleanupErr) {
        console.warn('[Upload] Failed to clean temp file:', cleanupErr.message);
      }
    }

    if (!res.writableEnded && !res.destroyed) {
      try {
        res.write(`data: ${JSON.stringify({ type: isAbort ? 'aborted' : 'error', error: err.message || 'File upload failed' })}\n\n`);
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
    const { query, topicId } = req.query;
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
 * Download original file if binary data exists, otherwise fall back to text
 */
router.get('/download/:fileId', requireAuth, async (req, res) => {
  try {
    const { fileId } = req.params;
    const fileData = await getFileContentById(fileId, req.user.id);
    if (!fileData) {
      return res.status(404).json({ error: 'File not found or access denied' });
    }
    const fileName = fileData.file_name || `file_${fileId}`;

    // If original binary data exists, serve it with correct MIME type
    if (fileData.original_file_data) {
      const safeName = sanitizeFilename(fileName);
      const mime = getMimeType(safeName);
      const bin = fileData.original_file_data;
      console.log(`[Download] fileId=${fileId} fileName=${safeName} binType=${typeof bin} binLen=${bin?.length || bin?.byteLength || '?'} isString=${typeof bin === 'string'} first100=${typeof bin === 'string' ? bin.slice(0, 100) : 'NOT STRING'}`);
      res.setHeader('Content-Type', mime);
      res.setHeader('Content-Disposition', `attachment; filename="${safeName}"`);
      // bin can be base64 string, Buffer, or bytea hex — normalize
      if (typeof bin === 'string' && /^[A-Za-z0-9+/=]+$/.test(bin)) {
        console.log('[Download] Decoding as base64');
        res.send(Buffer.from(bin, 'base64'));
      } else if (typeof bin === 'string' && bin.startsWith('\\x')) {
        console.log('[Download] Decoding as hex');
        res.send(Buffer.from(bin.slice(2), 'hex'));
      } else {
        console.log('[Download] Using as raw bytes, isBuffer:', Buffer.isBuffer(bin), 'isArray:', Array.isArray(bin));
        res.send(Buffer.from(bin));
      }
      return;
    }

    // Fallback: serve extracted text using original filename/extension
    const safeName = sanitizeFilename(fileName);
    const content = fileData.original_content || fileData.llm_analysis || '';
    const fallbackMime = getMimeType(safeName);
    const isTextLike = /^text\/|application\/(json|xml|javascript|typescript)/i.test(fallbackMime);
    res.setHeader('Content-Type', isTextLike ? `${fallbackMime}; charset=utf-8` : fallbackMime);
    res.setHeader('Content-Disposition', `attachment; filename="${safeName}"`);
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
    const { topicId, fileName, content, fileType, messageId } = req.body;
    if (!fileName || !content) {
      return res.status(400).json({ error: 'fileName and content are required' });
    }
    const safeFileName = sanitizeFilename(fileName);
    const result = await saveGeneratedFile(req.user.id, topicId || null, safeFileName, content, fileType);
    if (!result) {
      return res.status(500).json({ error: 'Failed to save generated file' });
    }
    if (messageId) {
      const { data: msgRow, error: msgFetchErr } = await supabase
        .from('messages')
        .select('id, generated_files')
        .eq('id', messageId)
        .eq('user_id', req.user.id)
        .single();

      if (!msgFetchErr && msgRow) {
        let existing = [];
        if (Array.isArray(msgRow.generated_files)) {
          existing = msgRow.generated_files;
        } else if (typeof msgRow.generated_files === 'string') {
          try { existing = JSON.parse(msgRow.generated_files); } catch { existing = []; }
          if (!Array.isArray(existing)) existing = [];
        }

        const alreadyExists = existing.some((f) => f?.file_id === result.file_id);
        if (!alreadyExists) {
          await supabase
            .from('messages')
            .update({ generated_files: [...existing, result] })
            .eq('id', messageId)
            .eq('user_id', req.user.id);
        }
      }
    }
    res.json({ file: result });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/upload/generate-image
 * Generate an AI image via DALL-E 3 and save to DB
 * Body: { prompt, topicId, size?, quality? }
 */
router.post('/generate-image', requireAuth, async (req, res) => {
  try {
    const { prompt, topicId, size, quality } = req.body;
    if (!prompt || typeof prompt !== 'string' || !prompt.trim()) {
      return res.status(400).json({ error: 'prompt is required' });
    }
    const result = await generateImage(prompt.trim(), req.user.id, topicId || null, { size, quality });
    res.json({ file: result });
  } catch (err) {
    console.error('[generate-image]', err.message);
    const status = err.message.includes('API key') ? 501 : 500;
    res.status(status).json({ error: err.message });
  }
});

/**
 * POST /api/upload/generate-ppt
 * Generate a PPTX from structured slide data and save to DB
 * Body: { title, slides: [{title, bullets?, content?}], subtitle?, topicId }
 */
router.post('/generate-ppt', requireAuth, async (req, res) => {
  try {
    const { title, slides, subtitle, topicId } = req.body;
    if (!title || typeof title !== 'string' || !title.trim()) {
      return res.status(400).json({ error: 'title is required' });
    }
    if (!Array.isArray(slides) || slides.length === 0) {
      return res.status(400).json({ error: 'slides array is required and must not be empty' });
    }
    const result = await generatePPT(title.trim(), slides, req.user.id, topicId || null, { subtitle });
    res.json({ file: result });
  } catch (err) {
    console.error('[generate-ppt]', err.message);
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/upload/status/:sessionId
 * Poll upload progress — used when user navigates back after browser back/forward
 */
router.get('/status/:sessionId', requireAuth, async (req, res) => {
  const { sessionId } = req.params;
  const session = uploadSessions.get(sessionId);
  if (!session) {
    return res.json({ active: false });
  }
  res.json({
    active: true,
    status: session.status,
    progress: session.progress,
    message: session.message,
    phase: session.phase,
  });
});

/**
 * POST /api/upload/cancel/:sessionId
 * Explicitly cancel an upload in progress — triggers abort signal which
 * causes saveFileToRAG / processZipFile to clean up partial DB records
 */
router.post('/cancel/:sessionId', requireAuth, async (req, res) => {
  const { sessionId } = req.params;
  const session = uploadSessions.get(sessionId);
  if (!session) {
    return res.status(404).json({ error: 'Upload session not found or already completed' });
  }
  console.log(`[Upload] Explicit cancel for session: ${sessionId}`);
  session.controller.abort();
  uploadSessions.delete(sessionId);
  // DB cleanup happens automatically inside saveFileToRAG / processZipFile catch block
  res.json({ success: true, message: 'Upload cancelled & DB cleaned' });
});

module.exports = router;
