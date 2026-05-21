// ============================================================
// FILE: backend/controllers/auth.controller.js
// PURPOSE: Handles login, logout, session verification
//          Returns JWT token on successful login
// ============================================================

const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const supabase = require('../config/supabase');

// ── Per-account failed-attempt tracking (complements IP rate limiter) ──
const failMap = new Map();             // username → { count, lockedUntil }
const MAX_FAILS = 5;                   // lock after 5 failed attempts
const LOCK_DURATION_MS = 15 * 60 * 1000; // 15 minutes

/**
 * Check if account is locked — checks both in-memory failMap AND DB locked_until
 */
const checkAccountLock = async (username) => {
  const key = username.toLowerCase();

  // 1. Check in-memory failMap (fast path for recent brute-force)
  const entry = failMap.get(key);
  if (entry) {
    if (entry.lockedUntil && Date.now() < entry.lockedUntil) {
      return Math.ceil((entry.lockedUntil - Date.now()) / 1000 / 60);
    }
    if (entry.lockedUntil) failMap.delete(key); // lock expired
  }

  // 2. Check DB locked_until (persisted/admin-initiated locks)
  try {
    const { data: user } = await supabase
      .from('users')
      .select('locked_until')
      .ilike('username', key)
      .single();

    if (user?.locked_until) {
      const until = new Date(user.locked_until);
      if (until > new Date()) {
        return Math.ceil((until - new Date()) / 1000 / 60);
      }
      // Expired — clear it
      await supabase.from('users').update({ locked_until: null }).ilike('username', key);
    }
  } catch (err) {
    console.error('[Auth] DB lock check error:', err.message);
  }

  return null;
};

/**
 * Record a failed login attempt — updates in-memory failMap AND persists to DB when threshold is reached
 */
const recordFailedAttempt = async (username) => {
  const key = username.toLowerCase();

  // In-memory tracking
  const entry = failMap.get(key) || { count: 0, lockedUntil: null };
  entry.count++;
  if (entry.count >= MAX_FAILS) {
    entry.lockedUntil = Date.now() + LOCK_DURATION_MS;
  }
  failMap.set(key, entry);

  // Persist to DB when threshold is reached
  if (entry.count >= MAX_FAILS) {
    try {
      await supabase
        .from('users')
        .update({ locked_until: new Date(Date.now() + LOCK_DURATION_MS).toISOString() })
        .ilike('username', key);
    } catch (err) {
      console.error('[Auth] DB lock persist error:', err.message);
    }
  }
};

/**
 * Clear failed attempts — clears both in-memory failMap AND DB locked_until
 */
const clearFailedAttempts = async (username) => {
  const key = username.toLowerCase();
  failMap.delete(key);

  try {
    await supabase
      .from('users')
      .update({ locked_until: null })
      .ilike('username', key);
  } catch (err) {
    console.error('[Auth] DB lock clear error:', err.message);
  }
};

// Periodic cleanup of stale entries (runs hourly)
setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of failMap) {
    if (entry.lockedUntil && now >= entry.lockedUntil) failMap.delete(key);
  }
}, 60 * 60 * 1000).unref();

/**
 * POST /api/auth/login
 * Body: { username, password }
 */
const login = async (req, res) => {
  try {
    const { username, password } = req.body;
    if (!username || !password) {
      return res.status(400).json({ error: 'Username and password required' });
    }

    // Check per-account lock before even querying DB (async — checks both failMap and DB)
    const minsLeft = await checkAccountLock(username);
    if (minsLeft !== null) {
      return res.status(429).json({
        error: `Account locked due to too many failed attempts. Try again in ${minsLeft} minute(s).`,
      });
    }

    // Fetch user by username or email
    const { data: user, error } = await supabase
      .from('users')
      .select('*')
      .or(`username.ilike.${username},email.ilike.${username}`)
      .single();

    if (error || !user) {
      await recordFailedAttempt(username);
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    // Check account status
    if (!user.is_active) {
      return res.status(403).json({ error: 'Account is disabled' });
    }
    if (user.expires_at && new Date(user.expires_at) < new Date()) {
      return res.status(403).json({ error: 'Account has expired' });
    }

    // Verify password
    const validPassword = await bcrypt.compare(password, user.password_hash);
    if (!validPassword) {
      await recordFailedAttempt(username);
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    // Success — clear failed attempts for this account (async — clears both failMap and DB)
    await clearFailedAttempts(username);

    // Create JWT — expires based on user's session_minutes setting
    const expiresInSeconds = (user.session_minutes || 60) * 60;
    const token = jwt.sign(
      { userId: user.id, role: user.role },
      process.env.JWT_SECRET,
      { expiresIn: expiresInSeconds }
    );

    // Return user info (no sensitive fields)
    res.json({
      token,
      user: {
        id: user.id,
        username: user.username,
        email: user.email,
        role: user.role,
        total_tokens: user.total_tokens,
        used_tokens: user.used_tokens,
        per_query_limit: user.per_query_limit,
        expires_at: user.expires_at,
      },

    });
  } catch (err) {
    console.error('[Auth] Login error:', err.message);
    res.status(500).json({ error: 'Login failed' });
  }
};

/**
 * GET /api/auth/me — returns current user data (token stats refreshed)
 */
const getMe = async (req, res) => {
  const { data: user } = await supabase
    .from('users')
    .select('id, username, email, role, total_tokens, used_tokens, per_query_limit, expires_at')
    .eq('id', req.user.id)
    .single();

  res.json({ user });
};

/**
 * POST /api/auth/logout — client should discard JWT; we just confirm
 */
const logout = (req, res) => {
  res.json({ message: 'Logged out successfully' });
};

module.exports = { login, getMe, logout, checkAccountLock, recordFailedAttempt, clearFailedAttempts };
