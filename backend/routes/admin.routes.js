// ============================================================
// FILE: backend/routes/admin.routes.js
// PURPOSE: Admin-only endpoints for user & analytics management
// ============================================================

const express = require('express');
const router = express.Router();
const supabase = require('../config/supabase');
const { requireAuth, requireAdmin } = require('../middleware/auth');
const { sanitizeBody } = require('../middleware/sanitize');
const {
  getUsers, createUser, updateUser, deleteUser, resetTokens, getAnalytics, unlockLogin, lockLogin,
} = require('../controllers/admin.controller');

// All admin routes require both auth + admin role
router.use(requireAuth, requireAdmin);

router.get('/users', getUsers);
router.post('/users', sanitizeBody(['email', 'username']), createUser);
router.put('/users/:id', sanitizeBody(['email', 'username']), updateUser);
router.delete('/users/:id', deleteUser);
router.post('/users/:id/reset-tokens', resetTokens);
router.get('/analytics', getAnalytics);
router.post('/users/:id/unlock-login', unlockLogin);
router.post('/users/:id/lock-login', lockLogin);

router.get('/api-status', requireAuth, async (req, res) => {
  const status = {
    anthropic: process.env.ANTHROPIC_API_KEY ? 'active' : 'inactive',
    openai: process.env.OPENAI_API_KEY ? 'active' : 'inactive',
    groq: process.env.GROQ_API_KEY ? 'active' : 'inactive',
    gemini: process.env.GEMINI_API_KEY ? 'active' : 'inactive',
    openrouter: process.env.OPENROUTER_API_KEY ? 'active' : 'inactive',
    together: process.env.TOGETHER_API_KEY ? 'active' : 'inactive',
    anyapi: process.env.ANYAPI_API_KEY ? 'active' : 'inactive',
    supabase: 'checking...'
  };

  // Test Supabase. The Supabase client resolves (never rejects) on a failed
  // query — it returns `{ data, error }` — so checking only the thrown case
  // made this always report "active".
  try {
    const { error } = await supabase.from('users').select('count').limit(1);
    status.supabase = error ? 'inactive' : 'active';
  } catch {
    status.supabase = 'inactive';
  }

  res.json(status);
});

module.exports = router;
