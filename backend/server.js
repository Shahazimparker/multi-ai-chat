// ============================================================
// FILE: backend/server.js
// PURPOSE: Express app entry point — registers middleware & routes
// CHANGE: PORT, CORS origins for your domain
// ============================================================

require('dotenv').config();

// Polyfill browser globals required by pdfjs-dist / pdf-parse in Node.js serverless runtimes
if (typeof global.DOMMatrix === 'undefined') {
  global.DOMMatrix = class DOMMatrix {};
}
if (typeof global.ImageData === 'undefined') {
  global.ImageData = class ImageData {};
}
if (typeof global.Path2D === 'undefined') {
  global.Path2D = class Path2D {};
}

const express  = require('express');
const cors     = require('cors');
const helmet   = require('helmet');
const morgan   = require('morgan');
const { csrfProtection } = require('./middleware/csrf');

// ── Sentry configuration ──
const { initSentry, sentryRequestHandler, sentryTracingHandler, sentryErrorHandler, Sentry } = require('./config/sentry');

// ── JWT_SECRET validation on startup ──
if (!process.env.JWT_SECRET || process.env.JWT_SECRET.length < 32 || process.env.JWT_SECRET === 'your_super_secret_jwt_key_min_32_chars_change_this') {
  if (process.env.NODE_ENV === 'production' && !process.env.VERCEL) {
    console.error('[FATAL] JWT_SECRET must be at least 32 characters long and not the placeholder.');
    process.exit(1);
  }
  const crypto = require('crypto');
  process.env.JWT_SECRET = (process.env.JWT_SECRET && process.env.JWT_SECRET.length >= 32 && process.env.JWT_SECRET !== 'your_super_secret_jwt_key_min_32_chars_change_this')
    ? process.env.JWT_SECRET
    : crypto.randomBytes(32).toString('hex');
  console.warn('[WARN] Using auto-generated 32-byte JWT_SECRET for this runtime.');
}

// ── Global crash logging ──
process.on('uncaughtException', (err) => {
  console.error('[FATAL] Uncaught Exception:', err);
  if (Sentry) Sentry.captureException(err);
  if (!process.env.VERCEL) process.exit(1);
});
process.on('unhandledRejection', (reason, promise) => {
  console.error('[FATAL] Unhandled Rejection at:', promise, 'reason:', reason);
  if (Sentry) Sentry.captureException(reason);
});

// ── Route imports ──────────────────────────────────────────
const authRoutes      = require('./routes/auth.routes');
const chatRoutes      = require('./routes/chat.routes');
const adminRoutes     = require('./routes/admin.routes');
const approvalRoutes  = require('./routes/approval.routes');
const historyRoutes   = require('./routes/history.routes');
const uploadRoutes    = require('./routes/upload.routes');
const knowledgeRoutes = require('./routes/knowledge.routes');

// ── Periodic cache cleanup (only on long-running servers, not serverless) ─
const { cleanupStaleCache } = require('./services/cache.service');
if (!process.env.VERCEL) {
  const CACHE_CLEANUP_INTERVAL = 24 * 60 * 60 * 1000; // 24h
  const cleanupTimer = setInterval(() => {
    cleanupStaleCache(30, 2).catch(err =>
      console.warn('[Cache] Periodic cleanup failed:', err.message)
    );
  }, CACHE_CLEANUP_INTERVAL);
  if (typeof cleanupTimer.unref === 'function') cleanupTimer.unref();
  // Run once on startup too
  cleanupStaleCache(30, 2).catch(err =>
    console.warn('[Cache] Startup cleanup failed:', err.message)
  );
}

const app  = express();
const PORT = process.env.PORT || 5000;

// ── Trust proxy — required behind Vercel / reverse proxies ─────
// Without this, express-rate-limit throws ERR_ERL_UNEXPECTED_X_FORWARDED_FOR
// because Vercel sets X-Forwarded-For but Express ignores it by default.
app.set('trust proxy', 1);

// ── Initialize Sentry (must be before other middleware) ────
initSentry(app);
app.use(sentryRequestHandler());
app.use(sentryTracingHandler());

// ── Security & logging middleware ──────────────────────────
app.use(helmet());                            // sets secure HTTP headers
// 'combined' (Apache-style) in production for parseable access logs; 'dev' is
// colourised and concise but strips the fields log aggregators expect.
app.use(morgan(process.env.NODE_ENV === 'production' ? 'combined' : 'dev'));
app.use(express.json({ limit: '10mb' }));     // parse JSON bodies (10MB for RAG docs)

// ── CORS — MUST run before CSRF so error responses get CORS headers ──
const allowedOrigins = [
  'http://localhost:3000',
  'http://localhost:5000',
  process.env.FRONTEND_URL,
].filter(Boolean);

app.use(cors({
  origin: (origin, cb) => {
    // Allow requests with no origin (server-to-server, curl, health checks, etc.)
    if (!origin) return cb(null, true);
    if (allowedOrigins.includes(origin)) return cb(null, true);
    cb(null, false); // no CORS headers — request continues to CSRF middleware
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-CSRF-Token'],
}));

// ── Handle OPTIONS preflight explicitly (required by Vercel serverless) ──
app.use((req, res, next) => {
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});
app.use(csrfProtection);

const supabase = require('./config/supabase');

// ── Health check (used by Vercel / uptime monitors) ────────
app.get('/api/health', async (req, res) => {
  try {
    const { error } = await supabase.from('users').select('id').limit(1);
    if (error) throw error;
    res.json({
      status: 'OK',
      database: 'connected',
      environment: process.env.NODE_ENV || 'development',
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    res.status(503).json({
      status: 'DEGRADED',
      database: 'disconnected',
      error: err.message,
      timestamp: new Date().toISOString(),
    });
  }
});

// ── API routes ──────────────────────────────────────────────
app.use('/api/auth',      authRoutes);     // login, logout, verify
app.use('/api/chat',      chatRoutes);     // send message, stream
app.use('/api/admin',     adminRoutes);    // user management, analytics
app.use('/api/approval',  approvalRoutes); // persistent human approvals
app.use('/api/history',   historyRoutes);  // chat history, topics
app.use('/api/upload',    uploadRoutes);   // file upload, search, delete
app.use('/api/knowledge', knowledgeRoutes); // Knowledge Base & RAG 2.0

// ── 404 handler ─────────────────────────────────────────────
app.use((req, res) => {
  res.status(404).json({ error: 'Route not found' });
});

// ── Sentry error handler (must be before other error handlers) ──
app.use(sentryErrorHandler());

// ── Global error handler ────────────────────────────────────
app.use((err, req, res, _next) => {
  console.error('[Error]', err.message);
  res.status(err.status || 500).json({
    error: err.message || 'Internal server error',
  });
});

if (process.env.NODE_ENV !== 'production' && !process.env.VERCEL) {
  app.listen(PORT, () => {
    console.log(`✅ Server running on port ${PORT}`);
  });
}

module.exports = app;
