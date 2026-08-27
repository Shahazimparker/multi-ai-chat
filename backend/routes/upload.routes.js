// FILE: backend/routes/upload.routes.js
// PURPOSE: Handle file uploads

const express = require('express');
const router = express.Router();
const multer = require('multer');
const rateLimit = require('express-rate-limit');
const path = require('path');
const fs = require('fs');
const os = require('os');
const crypto = require('crypto');
const { createRateLimitStore } = require('../services/rateLimitStore.service');

// ── Rate limiting ────────────────────────────────────────────
// Postgres-backed (see rateLimitStore.service.js) so counts survive across
// Vercel's per-instance memory instead of resetting on every cold start.
// Baseline for every /api/upload/* route, keyed by IP. Must stay well above
// the frontend's 2s poll of /status/:sessionId (~30 req/min per tab) so a user
// with several tabs open, or an office behind one NAT address, is not blocked.
const uploadBaseLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 150,
  message: { error: 'Too many upload requests. Please slow down.' },
  standardHeaders: true,
  legacyHeaders: false,
  store: createRateLimitStore('upload-base'),
});

// Stricter cap for the expensive endpoints (parsing, OCR, file generation).
// Applied *after* requireAuth, so req.user.id is always set and we can key per
// account rather than per IP — shared-IP users get independent budgets.
const uploadHeavyLimiter = rateLimit({
  windowMs: 5 * 60 * 1000,
  max: 30,
  keyGenerator: (req) => req.user?.id || 'anonymous',
  message: { error: 'Too many file processing requests. Please wait a few minutes.' },
  standardHeaders: true,
  legacyHeaders: false,
  store: createRateLimitStore('upload-heavy'),
});

router.use(uploadBaseLimiter);

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
// Finished sessions are kept briefly so a reconnecting client can read the final status.
const FINISHED_TTL_MS = 60 * 1000;
// `ts` is refreshed on every progress update, so a processing session only goes stale
// if its worker died (crash, unhandled rejection). Without this, such a session would
// pin its entry — and its AbortController — in the Map forever.
const PROCESSING_STALE_MS = 30 * 60 * 1000;

// Clean stale sessions every 60s. Unref'd so this timer never holds the process open.
setInterval(() => {
  const now = Date.now();
  for (const [id, s] of uploadSessions) {
    const age = now - s.ts;
    if (s.status !== 'processing') {
      if (age > FINISHED_TTL_MS) uploadSessions.delete(id);
    } else if (age > PROCESSING_STALE_MS) {
      console.warn(`[Upload] Evicting stale processing session ${id} (idle ${Math.round(age / 1000)}s)`);
      try {
        s.controller?.abort();
      } catch { /* controller already settled — nothing to release */ }
      uploadSessions.delete(id);
    }
  }
}, 60000).unref();

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
const {
  processUploadedFile,
  searchUserFilesRAG,
  getFileContent,
  getFileContentById,
  deleteUploadedFile,
  getSupportedFileType,
  isRiskyFileType,
  listAllUserFiles,
  saveGeneratedFile,
} = require('../services/fileUpload.service');
const { generateImage } = require('../services/imageGeneration.service');
const { generatePPT } = require('../services/pptGeneration.service');
const { handleUpload } = require('@vercel/blob/client');
const { isBlobConfigured, fetchPrivateBlobBuffer, isValidVercelBlobUrl } = require('../services/blobStorage.service');


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

// Vercel Serverless Functions hard-cap the request body at ~4.5MB regardless of
// this limit — anything larger never reaches multer, it's rejected by the
// platform first. Keep a safety margin below that cap for multipart overhead.
const MAX_UPLOAD_BYTES = 4 * 1024 * 1024; // 4MB

const upload = multer({
  storage,
  limits: { fileSize: MAX_UPLOAD_BYTES },
});

// Wraps upload.single('file') so a MulterError (e.g. LIMIT_FILE_SIZE) returns a
// clean 400 with a clear message instead of falling through to the generic
// 500 handler in server.js.
const uploadSingle = (req, res, next) => {
  upload.single('file')(req, res, (err) => {
    if (!err) return next();
    if (err.code === 'LIMIT_FILE_SIZE') {
      return res.status(400).json({
        error: `File is too large. Maximum upload size is ${MAX_UPLOAD_BYTES / (1024 * 1024)}MB.`,
      });
    }
    return res.status(400).json({ error: err.message || 'File upload failed' });
  });
};

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
 * GET /api/upload/config
 * Returns storage configuration (whether private Vercel Blob is active)
 */
router.get('/config', (req, res) => {
  const blobActive = isBlobConfigured();
  res.json({
    blobEnabled: blobActive,
    maxFileSizeBytes: blobActive ? 50 * 1024 * 1024 : MAX_UPLOAD_BYTES,
    maxFileSizeLabel: blobActive ? '50MB' : '4MB',
  });
});

/**
 * POST /api/upload/blob-handler
 * Direct browser-to-blob client upload token generator (@vercel/blob/client)
 */
router.post('/blob-handler', uploadHeavyLimiter, (req, res, next) => {
  if (req.body?.type === 'blob.generate-client-token') {
    return requireAuth(req, res, next);
  }
  next();
}, async (req, res) => {
  try {
    const jsonResponse = await handleUpload({
      body: req.body,
      request: req,
      onBeforeGenerateToken: async (pathname, clientPayload) => {
        if (!req.user || !req.user.id) {
          throw new Error('Unauthorized');
        }

        if (pathname && isRiskyFileType(pathname)) {
          const ext = path.extname(pathname).slice(1);
          throw new Error(`Files of type ".${ext}" are executable or system binaries and cannot be uploaded for security reasons.`);
        }

        return {
          access: 'private',
          addRandomSuffix: true,
          tokenPayload: JSON.stringify({
            userId: req.user.id,
            uploadedAt: Date.now(),
          }),
        };
      },
      onUploadCompleted: async ({ blob, tokenPayload }) => {
        console.log('[BlobHandler] Direct upload completed webhook:', blob.url);
      },
    });

    return res.json(jsonResponse);
  } catch (err) {
    console.error('[BlobHandler] Token generation error:', err.message);
    return res.status(400).json({ error: err.message });
  }
});

/**
 * POST /api/upload/process-blob
 * Process and embed a file already uploaded directly to private Vercel Blob
 */
router.post('/process-blob', requireAuth, uploadHeavyLimiter, uploadTimeout, async (req, res) => {
  let sessionId = null;
  let abortController = null;
  let updateSession = null;

  const { blobUrl, fileName, topicId, modelId, ragEnabled } = req.body;

  if (!blobUrl || !fileName) {
    return res.status(400).json({ error: 'blobUrl and fileName are required' });
  }

  if (!isValidVercelBlobUrl(blobUrl, ['uploads/', 'knowledge/'])) {
    return res.status(400).json({ error: 'Invalid or unauthorized blob storage URL' });
  }

  abortController = new AbortController();
  sessionId = crypto.randomUUID();
  uploadSessions.set(sessionId, {
    controller: abortController,
    userId: req.user.id,
    status: 'processing',
    progress: 0,
    message: 'Starting file processing...',
    phase: 'downloading',
    result: null,
    error: null,
    ts: Date.now(),
  });

  updateSession = (updates) => {
    const s = uploadSessions.get(sessionId);
    if (s) Object.assign(s, updates, { ts: Date.now() });
  };

  try {
    const onDisconnect = () => {
      console.log('[Upload:Blob] Client disconnected. Processing continues in background.');
    };
    req.on('close', onDisconnect);
    req.on('aborted', onDisconnect);
    res.on('close', onDisconnect);

    const safeFileName = sanitizeFilename(fileName);

    if (isRiskyFileType(safeFileName)) {
      updateSession({ status: 'error', error: 'Blocked file type' });
      return res.status(400).json({ error: `Files of type ".${path.extname(safeFileName).slice(1)}" are executable or system binaries and cannot be uploaded for security reasons.` });
    }

    const fileType = getSupportedFileType(safeFileName);

    if (fileType === 'other') {
      updateSession({ status: 'error', error: 'Unsupported file type' });
      return res.status(400).json({ error: `Unsupported file type for "${fileName}". Supported: text, code, PDF, Word, Excel/CSV, images and ZIP.` });
    }

    // SSE setup
    try {
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
      });
      res.flushHeaders();
    } catch (sseErr) {
      console.error('[Upload:Blob] SSE setup failed:', sseErr);
      if (!res.headersSent) {
        return res.status(500).json({ error: 'SSE setup failed' });
      }
    }
    try {
      if (res.socket) res.socket.setNoDelay(true);
    } catch (noDelayErr) {
      console.error('[Upload:Blob] setNoDelay failed:', noDelayErr);
    }

    const sendProgress = (data) => {
      if (data.type === 'progress') {
        updateSession({ progress: data.percent, message: data.message || '', phase: data.phase || 'processing' });
      }
      if (!res.writableEnded && !res.destroyed) {
        try {
          res.write(`data: ${JSON.stringify(data)}\n\n`);
        } catch (writeErr) {
          console.error('[Upload:Blob] SSE write error:', writeErr);
        }
      }
    };

    sendProgress({ type: 'init', sessionId, percent: 0, message: 'Processing uploaded file from storage...' });

    const isRagEnabled = ragEnabled === 'true' || ragEnabled === true;

    const result = await processUploadedFile(
      null,
      safeFileName,
      fileType,
      req.user.id,
      topicId,
      modelId,
      abortController.signal,
      isRagEnabled,
      sendProgress,
      blobUrl
    );

    if (result.tokensUsed > 0) {
      const { error: tokenErr } = await supabase.rpc('increment_user_tokens', {
        user_id: req.user.id,
        token_amount: result.tokensUsed,
      });
      if (tokenErr) {
        console.warn('[Upload:Blob] Token deduction failed:', tokenErr.message);
      }
    }

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
    console.error(`[Upload:Blob] ${isAbort ? 'Aborted' : 'Error'}:`, err.message);

    if (!res.writableEnded && !res.destroyed) {
      try {
        res.write(`data: ${JSON.stringify({ type: isAbort ? 'aborted' : 'error', error: err.message || 'Blob processing failed' })}\n\n`);
        res.end();
      } catch (writeErr) {
        console.error('[Upload:Blob] Failed to send error via SSE:', writeErr);
      }
    }
  }
});

/**
 * In-memory fallback chunk storage for local dev / single instance
 */
const inMemoryChunkStaging = new Map();
const CHUNK_STAGING_TTL_MS = 60 * 60 * 1000; // 1 hour TTL for abandoned staged uploads

const sweepExpiredChunkStaging = () => {
  const now = Date.now();
  for (const [uploadId, sess] of inMemoryChunkStaging) {
    if (now - (sess.createdAt || 0) > CHUNK_STAGING_TTL_MS) {
      inMemoryChunkStaging.delete(uploadId);
    }
  }
};

// Periodic TTL sweep every 15 minutes (unref'd to not hold Node process open)
setInterval(sweepExpiredChunkStaging, 15 * 60 * 1000).unref();

/**
 * Confirms the caller owns a chunked-upload session.
 *
 * The in-memory Map only exists on the instance that happened to serve the
 * earlier chunks, so on serverless it is usually empty and an ownership check
 * against it alone silently passes. upload_chunks_staging is the shared record,
 * so it is what actually has to be consulted before a session is written to,
 * finalized, or aborted.
 *
 * @returns {Promise<boolean>} false when the session belongs to another user
 */
const callerOwnsUploadSession = async (uploadId, req) => {
  if (req.user?.role === 'admin') return true;

  const memSession = inMemoryChunkStaging.get(uploadId);
  if (memSession && memSession.userId !== req.user.id) return false;

  try {
    const { data: existing } = await supabase
      .from('upload_chunks_staging')
      .select('user_id')
      .eq('upload_id', uploadId)
      .limit(1)
      .maybeSingle();
    if (existing && existing.user_id !== req.user.id) return false;
  } catch (ownErr) {
    // Table missing (local dev before the migration) — the in-memory check above
    // is then the only record there is, and it has already passed.
    console.warn('[Upload:Chunk] Ownership lookup warning:', ownErr.message);
  }

  return true;
};

/**
 * POST /api/upload/chunk/init
 * Initialize a chunked upload session for direct DB upload (upgDB)
 */
router.post('/chunk/init', requireAuth, uploadHeavyLimiter, async (req, res) => {
  try {
    sweepExpiredChunkStaging();
    const { fileName, fileSize, fileType, totalChunks } = req.body;
    if (!fileName) return res.status(400).json({ error: 'fileName is required' });

    if (isRiskyFileType(fileName)) {
      const ext = path.extname(fileName).slice(1);
      return res.status(400).json({ error: `Files of type ".${ext}" are executable or system binaries and cannot be uploaded for security reasons.` });
    }

    const detectedType = getSupportedFileType(fileName);
    if (detectedType === 'other') {
      return res.status(400).json({ error: `Unsupported file type for "${fileName}".` });
    }

    const uploadId = crypto.randomUUID();
    inMemoryChunkStaging.set(uploadId, {
      userId: req.user.id,
      fileName,
      fileType: detectedType,
      totalChunks: parseInt(totalChunks, 10) || 1,
      chunks: new Map(),
      createdAt: Date.now(),
    });

    res.json({
      uploadId,
      chunkSize: 2 * 1024 * 1024,
      totalChunks: parseInt(totalChunks, 10) || 1,
      fileName,
    });
  } catch (err) {
    console.error('[Upload:Chunk:Init] Failed:', err);
    res.status(500).json({ error: err.message || 'Failed to initialize chunk upload' });
  }
});

/**
 * POST /api/upload/chunk/:uploadId
 * Upload a single chunk slice
 */
router.post('/chunk/:uploadId', requireAuth, uploadHeavyLimiter, async (req, res) => {
  try {
    const { uploadId } = req.params;
    const { chunkIndex, totalChunks, fileName, fileType, chunkData } = req.body;

    if (chunkIndex === undefined || !chunkData) {
      return res.status(400).json({ error: 'chunkIndex and chunkData are required' });
    }

    const parsedIndex = parseInt(chunkIndex, 10);
    const parsedTotal = parseInt(totalChunks, 10) || 1;

    if (!(await callerOwnsUploadSession(uploadId, req))) {
      return res.status(403).json({ error: 'Unauthorized: upload session belongs to another user' });
    }

    // Cache in memory for quick retrieval
    let memSession = inMemoryChunkStaging.get(uploadId);
    if (!memSession) {
      memSession = {
        userId: req.user.id,
        fileName: fileName || 'file',
        fileType: fileType || 'txt',
        totalChunks: parsedTotal,
        chunks: new Map(),
        createdAt: Date.now(),
      };
      inMemoryChunkStaging.set(uploadId, memSession);
    }
    memSession.chunks.set(parsedIndex, chunkData);

    // Persist to Supabase staging table for distributed Vercel serverless instances
    try {
      await supabase
        .from('upload_chunks_staging')
        .upsert({
          upload_id: uploadId,
          user_id: req.user.id,
          chunk_index: parsedIndex,
          total_chunks: parsedTotal,
          file_name: fileName || 'file',
          file_type: fileType || 'txt',
          chunk_data: chunkData,
          created_at: new Date().toISOString(),
        }, { onConflict: 'upload_id,chunk_index' });
    } catch (dbErr) {
      // If table doesn't exist yet, in-memory Map provides local fallback
      console.warn('[Upload:Chunk] DB staging write warning (using memory):', dbErr.message);
    }

    res.json({ success: true, uploadId, chunkIndex: parsedIndex });
  } catch (err) {
    console.error('[Upload:Chunk] Failed to save chunk:', err);
    res.status(500).json({ error: err.message || 'Failed to save chunk' });
  }
});

/**
 * POST /api/upload/chunk/:uploadId/finalize
 * Assemble chunks and process file directly into database (upgDB) with SSE streaming
 */
router.post('/chunk/:uploadId/finalize', requireAuth, uploadHeavyLimiter, uploadTimeout, async (req, res) => {
  let sessionId = null;
  let abortController = null;
  let updateSession = null;

  try {
    const { uploadId } = req.params;
    const { topicId, modelId, ragEnabled } = req.body;

    if (!(await callerOwnsUploadSession(uploadId, req))) {
      return res.status(403).json({ error: 'Unauthorized: upload session belongs to another user' });
    }
    const memSession = inMemoryChunkStaging.get(uploadId);

    abortController = new AbortController();
    sessionId = crypto.randomUUID();

    uploadSessions.set(sessionId, {
      controller: abortController,
      userId: req.user.id,
      status: 'processing',
      progress: 0,
      message: 'Reassembling file chunks...',
      phase: 'uploading',
      result: null,
      error: null,
      createdAt: Date.now(),
    });

    updateSession = (updates) => {
      const sess = uploadSessions.get(sessionId);
      if (sess) {
        Object.assign(sess, updates);
        uploadSessions.set(sessionId, sess);
      }
    };

    const onDisconnect = () => {
      if (abortController) abortController.abort();
      updateSession({ status: 'aborted', error: 'Client disconnected' });
    };
    req.on('close', onDisconnect);
    res.on('close', onDisconnect);

    // ── Setup SSE ──
    try {
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
      });
      res.flushHeaders();
    } catch (sseErr) {
      console.error('[Upload:Chunk:Finalize] SSE setup failed:', sseErr);
    }

    try {
      if (typeof res.socket?.setNoDelay === 'function') res.socket.setNoDelay(true);
    } catch {
      // Ignore if setNoDelay is unsupported in the current runtime environment
    }

    const sendProgress = (data) => {
      if (data.type === 'progress') {
        updateSession({ progress: data.percent, message: data.message || '', phase: data.phase || 'processing' });
      }
      if (!res.writableEnded && !res.destroyed) {
        try {
          res.write(`data: ${JSON.stringify(data)}\n\n`);
        } catch (writeErr) {
          console.error('[Upload:Chunk:Finalize] SSE write error:', writeErr);
        }
      }
    };

    sendProgress({ type: 'init', sessionId, percent: 0, message: 'Reassembling file chunks...' });

    // Retrieve chunks: check in-memory first, fallback to Supabase upload_chunks_staging
    let fileName = 'file';
    let fileType = 'txt';
    let totalChunks = 1;
    let chunksList = [];

    if (memSession && memSession.chunks.size >= memSession.totalChunks) {
      fileName = memSession.fileName;
      fileType = memSession.fileType;
      totalChunks = memSession.totalChunks;
      for (let i = 0; i < totalChunks; i++) {
        const cData = memSession.chunks.get(i);
        if (cData) chunksList.push(Buffer.from(cData, 'base64'));
      }
    } else {
      // Fetch from Supabase staging table
      const { data: dbChunks, error: dbErr } = await supabase
        .from('upload_chunks_staging')
        .select('*')
        .eq('upload_id', uploadId)
        .eq('user_id', req.user.id)
        .order('chunk_index', { ascending: true });

      if (dbErr || !dbChunks || dbChunks.length === 0) {
        throw new Error('No uploaded chunks found for this upload session.');
      }

      fileName = dbChunks[0].file_name;
      fileType = dbChunks[0].file_type;
      totalChunks = dbChunks[0].total_chunks;

      if (dbChunks.length < totalChunks) {
        throw new Error(`Incomplete chunk upload: received ${dbChunks.length} of ${totalChunks} chunks.`);
      }

      chunksList = dbChunks.map((c) => Buffer.from(c.chunk_data, 'base64'));
    }

    const fileBuffer = Buffer.concat(chunksList);
    sendProgress({ type: 'progress', percent: 20, message: 'Processing direct database ingestion...' });

    // Cleanup staging table & memory
    inMemoryChunkStaging.delete(uploadId);
    try {
      await supabase.from('upload_chunks_staging').delete().eq('upload_id', uploadId).eq('user_id', req.user.id);
    } catch {
      // Ignore staging cleanup failure
    }

    const isRagEnabled = ragEnabled === 'true' || ragEnabled === true;
    const detectedType = getSupportedFileType(fileName);

    const result = await processUploadedFile(
      fileBuffer,
      fileName,
      detectedType,
      req.user.id,
      topicId || null,
      modelId || null,
      abortController.signal,
      isRagEnabled,
      sendProgress,
      null // blobUrl is null => stores raw file in PostgreSQL
    );

    if (result.tokensUsed > 0) {
      const { error: tokenErr } = await supabase.rpc('increment_user_tokens', {
        user_id: req.user.id,
        token_amount: result.tokensUsed,
      });
      if (!tokenErr) {
        console.log(`[Upload:Chunk:Finalize] Deducted ${result.tokensUsed} tokens for file embedding`);
      }
    }

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
    if (updateSession) updateSession({ status: isAbort ? 'aborted' : 'error', error: err.message });
    console.error(`[Upload:Chunk:Finalize] ${isAbort ? 'Aborted' : 'Error'}:`, err.message);

    if (!res.writableEnded && !res.destroyed) {
      try {
        res.write(`data: ${JSON.stringify({ type: isAbort ? 'aborted' : 'error', error: err.message || 'Chunk finalization failed' })}\n\n`);
        res.end();
      } catch (writeErr) {
        console.error('[Upload:Chunk:Finalize] Failed to send error via SSE:', writeErr);
      }
    }
  }
});

/**
 * POST /api/upload/chunk/:uploadId/abort
 * Cancel chunked upload and delete staging data
 */
router.post('/chunk/:uploadId/abort', requireAuth, uploadHeavyLimiter, async (req, res) => {
  const { uploadId } = req.params;
  if (!(await callerOwnsUploadSession(uploadId, req))) {
    return res.status(403).json({ error: 'Unauthorized: upload session belongs to another user' });
  }
  inMemoryChunkStaging.delete(uploadId);
  try {
    await supabase.from('upload_chunks_staging').delete().eq('upload_id', uploadId).eq('user_id', req.user.id);
  } catch {
    // Ignore staging cleanup failure on abort
  }
  res.json({ message: 'Chunk upload aborted and cleaned' });
});

/**
 * POST /api/upload/file
 * Upload and process a file
 */
router.post('/file', requireAuth, uploadHeavyLimiter, uploadTimeout, uploadSingle, async (req, res) => {
  let sessionId = null;
  let abortController = null;
  let updateSession = null;

  // Create session before try so catch can also update it
  if (req.file) {
    abortController = new AbortController();
    sessionId = crypto.randomUUID();
    uploadSessions.set(sessionId, {
      controller: abortController,
      userId: req.user.id,
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

    if (isRiskyFileType(fileName)) {
      updateSession({ status: 'error', error: 'Blocked file type' });
      try {
        if (fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
      } catch (cleanupErr) {
        console.warn('[Upload] Failed to clean temp file:', cleanupErr.message);
      }
      return res.status(400).json({ error: `Files of type ".${path.extname(fileName).slice(1)}" are executable or system binaries and cannot be uploaded for security reasons.` });
    }

    const fileType = getSupportedFileType(req.file.originalname);

    // An unrecognized extension falls into documentLoader's catch-all path, which
    // returns a "[Binary file]" placeholder or garbled decoded bytes instead of
    // failing — so instead of "processing" garbage, reject up front here.
    if (fileType === 'other') {
      updateSession({ status: 'error', error: 'Unsupported file type' });
      try {
        if (fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
      } catch (cleanupErr) {
        console.warn('[Upload] Failed to clean temp file:', cleanupErr.message);
      }
      return res.status(400).json({ error: `Unsupported file type for "${fileName}". Supported: text, logs, code, PDF, Word, Excel/CSV, images and ZIP.` });
    }

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

    // If stored in private Vercel Blob, fetch and stream it
    if (fileData.blob_url) {
      try {
        const safeName = sanitizeFilename(fileName);
        const mime = getMimeType(safeName);
        const buffer = await fetchPrivateBlobBuffer(fileData.blob_url);
        res.setHeader('Content-Type', mime);
        res.setHeader('Content-Disposition', `attachment; filename="${safeName}"`);
        return res.send(buffer);
      } catch (blobErr) {
        console.error(`[Upload:Download] Failed to fetch private blob ${fileData.blob_url}:`, blobErr.message);
        // Fall back to original_content if blob download fails
      }
    }

    // If original binary data exists in DB, serve it with correct MIME type
    if (fileData.original_file_data) {
      const safeName = sanitizeFilename(fileName);
      const mime = getMimeType(safeName);
      const bin = fileData.original_file_data;
      res.setHeader('Content-Type', mime);
      res.setHeader('Content-Disposition', `attachment; filename="${safeName}"`);
      // bin can be base64 string, Buffer, or bytea hex — normalize
      if (typeof bin === 'string' && /^[A-Za-z0-9+/=]+$/.test(bin)) {
        res.send(Buffer.from(bin, 'base64'));
      } else if (typeof bin === 'string' && bin.startsWith('\\x')) {
        res.send(Buffer.from(bin.slice(2), 'hex'));
      } else {
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
router.post('/generate-file', requireAuth, uploadHeavyLimiter, async (req, res) => {
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
router.post('/generate-image', requireAuth, uploadHeavyLimiter, async (req, res) => {
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
router.post('/generate-ppt', requireAuth, uploadHeavyLimiter, async (req, res) => {
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
  // Treat another user's session the same as no session — a 403 here would
  // confirm the ID is live, turning it into an existence oracle.
  if (!session || session.userId !== req.user.id) {
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
  // Same 404 whether the session doesn't exist or just isn't this user's —
  // a distinct "forbidden" response would confirm the ID is live.
  if (!session || session.userId !== req.user.id) {
    return res.status(404).json({ error: 'Upload session not found or already completed' });
  }
  console.log(`[Upload] Explicit cancel for session: ${sessionId}`);
  session.controller.abort();
  uploadSessions.delete(sessionId);
  // DB cleanup happens automatically inside saveFileToRAG / processZipFile catch block
  res.json({ success: true, message: 'Upload cancelled & DB cleaned' });
});

module.exports = router;
