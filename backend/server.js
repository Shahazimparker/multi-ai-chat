// ============================================================
// FILE: backend/server.js
// PURPOSE: Express app entry point — registers middleware & routes
// CHANGE: PORT, CORS origins for your domain
// ============================================================

require('dotenv').config();
const express  = require('express');
const cors     = require('cors');
const helmet   = require('helmet');
const morgan   = require('morgan');

// ── Route imports ──────────────────────────────────────────
const authRoutes    = require('./routes/auth.routes');
const chatRoutes    = require('./routes/chat.routes');
const adminRoutes   = require('./routes/admin.routes');
const historyRoutes = require('./routes/history.routes');

const app  = express();
const PORT = process.env.PORT || 5000;

// ── Security & logging middleware ──────────────────────────
app.use(helmet());                            // sets secure HTTP headers
app.use(morgan('dev'));                        // request logging
app.use(express.json({ limit: '10mb' }));     // parse JSON bodies (10MB for RAG docs)

// ── CORS — update FRONTEND_URL in .env for production ─────
app.use(cors({
  origin: process.env.FRONTEND_URL || 'http://localhost:3000',
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'],
}));

// ── Health check (used by Vercel / uptime monitors) ────────
app.get('/api/health', (req, res) => {
  res.json({ status: 'OK', timestamp: new Date().toISOString() });
});

// ── API routes ──────────────────────────────────────────────
app.use('/api/auth',    authRoutes);     // login, logout, verify
app.use('/api/chat',    chatRoutes);     // send message, stream
app.use('/api/admin',   adminRoutes);    // user management, analytics
app.use('/api/history', historyRoutes);  // chat history, topics

// ── 404 handler ─────────────────────────────────────────────
app.use((req, res) => {
  res.status(404).json({ error: 'Route not found' });
});

// ── Global error handler ────────────────────────────────────
app.use((err, req, res, next) => {
  console.error('[Error]', err.message);
  res.status(err.status || 500).json({
    error: err.message || 'Internal server error',
  });
});

if (process.env.NODE_ENV !== 'production') {
  app.listen(PORT, () => {
    console.log(`✅ Server running on port ${PORT}`);
  });
}

module.exports = app;