// ============================================================
// FILE: backend/controllers/admin.controller.js
// PURPOSE: Admin operations — create/edit/delete users,
//          view analytics, token management
// PROTECTED: requireAuth + requireAdmin middleware
// ============================================================

const bcrypt = require('bcryptjs');
const supabase = require('../config/supabase');
const { clearFailedAttempts } = require('./auth.controller');

// ── GET /api/admin/users — list all users ──────────────────
const getUsers = async (req, res) => {
  const { data, error } = await supabase
    .from('users')
    .select('id, email, username, role, is_active, locked_until, total_tokens, used_tokens, per_query_limit, session_minutes, expires_at, created_at')
    .order('created_at', { ascending: false });

  if (error) return res.status(500).json({ error: error.message });

  // Attach is_login_locked flag — locked if locked_until is in the future
  const now = new Date();
  const usersWithLock = (data || []).map(u => ({
    ...u,
    is_login_locked: !!(u.locked_until && new Date(u.locked_until) > now),
  }));

  res.json({ users: usersWithLock });
};

// ── POST /api/admin/users — create new user ────────────────
const createUser = async (req, res) => {
  try {
    const {
      email, username, password, role = 'user',
      total_tokens = 100000, per_query_limit = 2000,
      session_minutes = 60, expires_at = null,
    } = req.body;

    if (!email || !username || !password) {
      return res.status(400).json({ error: 'email, username, and password required' });
    }

    const password_hash = await bcrypt.hash(password, 12);

    const { data, error } = await supabase
      .from('users')
      .insert({
        email, username: username.toLowerCase(), password_hash, role,
        total_tokens, per_query_limit, session_minutes,
        expires_at: expires_at || null,
        is_active: true,
      })
      .select('id, email, username, role')
      .single();

    if (error) {
      if (error.code === '23505') return res.status(409).json({ error: 'Email or username already exists' });
      return res.status(500).json({ error: error.message });
    }

    res.status(201).json({ user: data, message: 'User created successfully' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// ── PUT /api/admin/users/:id — update user ─────────────────
const updateUser = async (req, res) => {
  try {
    const { id } = req.params;
    const updates = {};
    const allowed = ['email', 'username', 'role', 'is_active', 'total_tokens', 'per_query_limit', 'session_minutes', 'expires_at'];

    allowed.forEach(field => {
      if (req.body[field] !== undefined) updates[field] = req.body[field];
    });

    // Handle password change
    if (req.body.password) {
      updates.password_hash = await bcrypt.hash(req.body.password, 12);
    }

    const { data, error } = await supabase
      .from('users')
      .update(updates)
      .eq('id', id)
      .select('id, email, username, role, is_active')
      .single();

    if (error) return res.status(500).json({ error: error.message });
    res.json({ user: data, message: 'User updated' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// ── DELETE /api/admin/users/:id — delete user ─────────────
const deleteUser = async (req, res) => {
  const { id } = req.params;

  // Prevent self-deletion
  if (id === req.user.id) {
    return res.status(400).json({ error: 'Cannot delete your own account' });
  }

  const { error } = await supabase.from('users').delete().eq('id', id);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ message: 'User deleted' });
};

// ── POST /api/admin/users/:id/reset-tokens — reset quota ──
const resetTokens = async (req, res) => {
  const { id } = req.params;
  const { total_tokens } = req.body;

  const { error } = await supabase
    .from('users')
    .update({ used_tokens: 0, ...(total_tokens ? { total_tokens } : {}) })
    .eq('id', id);

  if (error) return res.status(500).json({ error: error.message });
  res.json({ message: 'Token quota reset' });
};

// ── GET /api/admin/analytics — usage analytics ─────────────
const getAnalytics = async (req, res) => {
  try {
    // Top models by usage
    const { data: modelStats } = await supabase
      .from('query_analytics')
      .select('model')
      .not('model', 'is', null);

    const modelCounts = {};
    (modelStats || []).forEach(r => {
      modelCounts[r.model] = (modelCounts[r.model] || 0) + 1;
    });

    // Most common queries (from cache hit_count)
    const { data: topQueries } = await supabase
      .from('query_cache')
      .select('query_text, hit_count, model, last_hit_at')
      .order('hit_count', { ascending: false })
      .limit(20);

    // Daily usage (last 7 days)
    const { data: dailyUsage } = await supabase
      .from('query_analytics')
      .select('created_at, tokens_used, is_anonymous')
      .gte('created_at', new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString())
      .order('created_at', { ascending: true });

    // Total stats
    const { data: totals } = await supabase
      .from('query_analytics')
      .select('tokens_used, cache_hit');

    const totalTokens = (totals || []).reduce((s, r) => s + (r.tokens_used || 0), 0);
    const cacheHits = (totals || []).filter(r => r.cache_hit).length;
    const totalQueries = (totals || []).length;

    res.json({
      modelCounts,
      topQueries: topQueries || [],
      dailyUsage: dailyUsage || [],
      summary: {
        totalQueries,
        totalTokens,
        cacheHits,
        cacheHitRate: totalQueries ? ((cacheHits / totalQueries) * 100).toFixed(1) : 0,
      },
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// ── POST /api/admin/users/:id/unlock-login — clear brute-force lock ──
const unlockLogin = async (req, res) => {
  try {
    const { id } = req.params;

    const { data: user, error } = await supabase
      .from('users')
      .update({ locked_until: null })
      .eq('id', id)
      .select('username')
      .single();

    if (error || !user) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Also clear in-memory failMap
    clearFailedAttempts(user.username);

    res.json({ message: `Login unlocked for ${user.username}` });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// ── POST /api/admin/users/:id/lock-login — manually lock account (persisted to DB) ──
const lockLogin = async (req, res) => {
  try {
    const { id } = req.params;
    const lockDurationMs = 15 * 60 * 1000; // 15 minutes
    const lockedUntil = new Date(Date.now() + lockDurationMs).toISOString();

    const { data: user, error } = await supabase
      .from('users')
      .update({ locked_until: lockedUntil })
      .eq('id', id)
      .select('username')
      .single();

    if (error || !user) {
      return res.status(404).json({ error: 'User not found' });
    }

    res.json({ message: `Login locked for ${user.username} (15 min)` });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

module.exports = { getUsers, createUser, updateUser, deleteUser, resetTokens, getAnalytics, unlockLogin, lockLogin };
