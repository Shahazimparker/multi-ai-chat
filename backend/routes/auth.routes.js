// ============================================================
// FILE: backend/routes/auth.routes.js
// PURPOSE: Authentication endpoints
// ============================================================

const express       = require('express');
const rateLimit     = require('express-rate-limit');
const router        = express.Router();
const { login, getMe, logout } = require('../controllers/auth.controller');
const { requireAuth }          = require('../middleware/auth');
const { createRateLimitStore } = require('../services/rateLimitStore.service');

// Rate limiter for login — prevents brute-force attacks. Backed by Postgres
// (not the in-memory default) so the budget is shared across every Vercel
// instance instead of resetting on each cold start — see rateLimitStore.service.js.
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 10,                   // max 10 attempts per window per IP
  message: { error: 'Too many login attempts. Try again in 15 minutes.' },
  standardHeaders: true,
  legacyHeaders: false,
  store: createRateLimitStore('login'),
});

router.post('/login',  loginLimiter, login);
router.get('/me',       requireAuth, getMe);
router.post('/logout',  requireAuth, logout);

module.exports = router;
