// ============================================================
// FILE: backend/controllers/admin.controller.js
// PURPOSE: Admin operations — create/edit/delete users,
//          view analytics, token management
// PROTECTED: requireAuth + requireAdmin middleware
// ============================================================

const bcrypt = require('bcryptjs');
const supabase = require('../config/supabase');
const { clearFailedAttempts } = require('./auth.controller');

// Closed role enum: the auth middleware only recognizes 'admin' and 'user', so
// writing any other string would create an account that can neither authenticate
// normally nor be administered.
const VALID_ROLES = ['user', 'admin'];
const MIN_PASSWORD_LENGTH = 8;

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
      total_tokens = 1000000, per_query_limit = 16000,
      session_minutes = 60, expires_at = null,
    } = req.body;

    if (!email || !username || !password) {
      return res.status(400).json({ error: 'email, username, and password required' });
    }
    if (!VALID_ROLES.includes(role)) {
      return res.status(400).json({ error: `Invalid role. Must be one of: ${VALID_ROLES.join(', ')}` });
    }
    if (typeof password !== 'string' || password.length < MIN_PASSWORD_LENGTH) {
      return res.status(400).json({ error: `Password must be at least ${MIN_PASSWORD_LENGTH} characters` });
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

    // Role is a closed enum — a free-form string would create an account the
    // auth middleware never recognizes as anything.
    if (updates.role !== undefined && !VALID_ROLES.includes(updates.role)) {
      return res.status(400).json({ error: `Invalid role. Must be one of: ${VALID_ROLES.join(', ')}` });
    }

    // Password policy.
    if (req.body.password !== undefined && req.body.password !== null && req.body.password !== '') {
      if (typeof req.body.password !== 'string' || req.body.password.length < MIN_PASSWORD_LENGTH) {
        return res.status(400).json({ error: `Password must be at least ${MIN_PASSWORD_LENGTH} characters` });
      }
      updates.password_hash = await bcrypt.hash(req.body.password, 12);
    }

    // Last-admin guard: refuse to strip the final active admin of their admin
    // rights (role change away from admin, or deactivation).
    const wouldRemoveAdmin = (updates.role !== undefined && updates.role !== 'admin')
      || updates.is_active === false;
    if (wouldRemoveAdmin) {
      const { data: target, error: targetErr } = await supabase
        .from('users')
        .select('role, is_active')
        .eq('id', id)
        .single();
      if (targetErr) return res.status(500).json({ error: targetErr.message });

      if (target && target.role === 'admin' && target.is_active !== false) {
        const { count, error: countErr } = await supabase
          .from('users')
          .select('id', { count: 'exact', head: true })
          .eq('role', 'admin')
          .eq('is_active', true);
        if (countErr) return res.status(500).json({ error: countErr.message });
        if ((count ?? 0) <= 1) {
          return res.status(400).json({ error: 'Cannot demote or deactivate the last active admin' });
        }
      }
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
  try {
    const { id } = req.params;

    // Prevent self-deletion
    if (id === req.user.id) {
      return res.status(400).json({ error: 'Cannot delete your own account' });
    }

    // Clean up all blobs stored in Vercel Blob for this user (chat uploads & knowledge documents)
    try {
      const [ragBlobs, docBlobs] = await Promise.all([
        supabase.from('uploaded_files_rag').select('blob_url').eq('user_id', id),
        supabase.from('knowledge_documents').select('blob_url').eq('user_id', id),
      ]);

      const urls = [
        ...(ragBlobs.data || []).map((r) => r.blob_url),
        ...(docBlobs.data || []).map((d) => d.blob_url),
      ].filter(Boolean);

      if (urls.length > 0) {
        const { deleteBlobFromStorage } = require('../services/blobStorage.service');
        await Promise.allSettled(urls.map((url) => deleteBlobFromStorage(url)));
      }
    } catch (blobErr) {
      console.warn('[Admin] User blob storage cleanup warning:', blobErr.message);
    }

    // Atomic, complete deletion: a single SECURITY DEFINER RPC removes the user
    // and every related row (memories, embeddings, knowledge base, approvals,
    // uploads, analytics, caches) in one transaction — no partial deletes.
    // See database/migration_delete_user_cascade.sql.
    const { error } = await supabase.rpc('delete_user_cascade', { p_user_id: id });
    if (error) return res.status(500).json({ error: error.message });

    res.json({ message: 'User deleted' });
  } catch (err) {
    console.error('[Admin] Delete user error:', err.message);
    res.status(500).json({ error: err.message });
  }
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
    // Aggregated in PostgreSQL (get_admin_analytics RPC). The previous four
    // unbounded select() calls each silently stopped at PostgREST's 1000-row
    // cap, so every total was wrong above that volume — see
    // database/migration_add_admin_analytics.sql.
    const { data, error } = await supabase.rpc('get_admin_analytics');
    if (error) return res.status(500).json({ error: error.message });
    res.json(data);
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
      .select('username, email')
      .single();

    if (error || !user) {
      return res.status(404).json({ error: 'User not found' });
    }

    // login_attempt_counters is keyed by the identifier *as typed at the login
    // form*, and login accepts either the username or the email — so a lockout
    // driven by attempts against the email address lives in a different row
    // than one driven by the username. Clearing only one of them leaves the
    // other row's future locked_until in place: the admin UI would show the
    // account unlocked (that flag reads users.locked_until, cleared above)
    // while checkAccountLock still 429s the user on their next sign-in.
    // Clear both identifiers so the two stores cannot drift apart.
    await clearFailedAttempts(user.username, id);
    if (user.email && String(user.email).toLowerCase() !== String(user.username || '').toLowerCase()) {
      await clearFailedAttempts(user.email, id);
    }

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
