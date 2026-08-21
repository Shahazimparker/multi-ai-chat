// ============================================================
// FILE: backend/controllers/auth.controller.js
// PURPOSE: Handles login, logout, session verification
//          Returns JWT token on successful login
// ============================================================

const bcrypt = require('bcryptjs');
const supabase = require('../config/supabase');
const { issueAuthCookie, clearAuthCookie } = require('../utils/authCookie');

// ── Login identifier validation ────────────────────────────
// The identifier is interpolated into a PostgREST filter string, where `,`
// separates OR terms, `()` group them and `*`/`%` are LIKE wildcards. Anything
// outside this charset is rejected before it can reach a query, so a caller
// cannot inject extra predicates or turn the lookup into a wildcard match.
// `_` is permitted because usernames legitimately contain it — the exact-match
// re-check in `login` below neutralises its LIKE-wildcard meaning.
const IDENTIFIER_PATTERN = /^[A-Za-z0-9._+@-]{1,254}$/;
const isSafeIdentifier = (value) => typeof value === 'string' && IDENTIFIER_PATTERN.test(value);

// ── Per-account failed-attempt tracking (complements IP rate limiter) ──
const failMap = new Map();             // username → { count, lockedUntil, lastFail }
const MAX_FAILS = 5;                   // lock after 5 failed attempts
const LOCK_DURATION_MS = 15 * 60 * 1000; // 15 minutes
const ATTEMPT_WINDOW_MS = 15 * 60 * 1000; // failures older than this stop counting

const minutesUntil = (timestamp) => Math.ceil((new Date(timestamp) - Date.now()) / 1000 / 60);

/**
 * In-memory lock check — fast path for recent brute-force, no DB round trip.
 * Returns minutes remaining, or null when not locked.
 */
const checkAccountLock = (identifier) => {
  const key = String(identifier || '').toLowerCase();
  const entry = failMap.get(key);
  if (!entry) return null;

  if (entry.lockedUntil && Date.now() < entry.lockedUntil) {
    return Math.ceil((entry.lockedUntil - Date.now()) / 1000 / 60);
  }
  if (entry.lockedUntil) failMap.delete(key); // lock expired
  return null;
};

/**
 * Record a failed login attempt.
 *
 * The in-memory counter is always updated. The DB lock is only written when the
 * caller resolved a real user, and is keyed by that user's primary key — never
 * by a caller-supplied pattern. A pattern-based UPDATE here previously let an
 * unauthenticated caller lock every account in the system at once.
 *
 * @param {string} identifier - what the caller typed (username or email)
 * @param {string|null} userId - resolved user id, or null when no user matched
 */
const recordFailedAttempt = async (identifier, userId = null) => {
  const key = String(identifier || '').toLowerCase();

  const now = Date.now();
  const entry = failMap.get(key) || { count: 0, lockedUntil: null, lastFail: 0 };

  // Sliding window: attempts older than ATTEMPT_WINDOW_MS no longer count toward
  // the lock, so a few failures spread over months can't accumulate into one.
  if (!entry.lockedUntil && now - entry.lastFail > ATTEMPT_WINDOW_MS) {
    entry.count = 0;
  }

  entry.count++;
  entry.lastFail = now;
  if (entry.count >= MAX_FAILS) {
    entry.lockedUntil = now + LOCK_DURATION_MS;
  }
  failMap.set(key, entry);

  // Persist to DB when threshold is reached — only ever for a known account.
  if (entry.count >= MAX_FAILS && userId) {
    try {
      const { error } = await supabase
        .from('users')
        .update({ locked_until: new Date(Date.now() + LOCK_DURATION_MS).toISOString() })
        .eq('id', userId);
      if (error) console.error('[Auth] DB lock persist error:', error.message);
    } catch (err) {
      console.error('[Auth] DB lock persist error:', err.message);
    }
  }
};

/**
 * Clear failed attempts — clears the in-memory counter and, when a user id is
 * supplied, the persisted DB lock for exactly that account.
 *
 * @param {string} identifier - username or email used at login
 * @param {string|null} userId - resolved user id
 */
const clearFailedAttempts = async (identifier, userId = null) => {
  failMap.delete(String(identifier || '').toLowerCase());
  if (!userId) return;

  try {
    const { error } = await supabase
      .from('users')
      .update({ locked_until: null })
      .eq('id', userId);
    if (error) console.error('[Auth] DB lock clear error:', error.message);
  } catch (err) {
    console.error('[Auth] DB lock clear error:', err.message);
  }
};

// Periodic cleanup of stale entries (runs hourly).
// Evicts both expired locks and counting-only entries that never reached MAX_FAILS —
// without the second case, every username that ever failed a login would be retained
// for the lifetime of the process, which is an unbounded, attacker-controlled map.
setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of failMap) {
    const lockExpired = entry.lockedUntil && now >= entry.lockedUntil;
    const countStale = !entry.lockedUntil && now - entry.lastFail > ATTEMPT_WINDOW_MS;
    if (lockExpired || countStale) failMap.delete(key);
  }
}, 60 * 60 * 1000).unref();

/**
 * POST /api/auth/login
 * Body: { username, password }
 */
const login = async (req, res) => {
  try {
    const { username, password, rememberMe } = req.body;
    if (!username || !password) {
      return res.status(400).json({ error: 'Username and password required' });
    }

    // Reject identifiers that could alter the PostgREST filter before any query runs.
    // Same generic response as a wrong password — this must not be an oracle.
    if (!isSafeIdentifier(username)) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    // Per-account lock — in-memory fast path, no DB round trip
    const minsLeft = checkAccountLock(username);
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

    // Re-assert an exact (case-insensitive) match. `ilike` still treats `_` as a
    // single-character wildcard, so a row can come back that isn't the account
    // the caller named; without this, `a_min` would resolve to `admin`.
    const identifier = username.toLowerCase();
    const isExactMatch = user
      && (String(user.username || '').toLowerCase() === identifier
        || String(user.email || '').toLowerCase() === identifier);

    if (error || !user || !isExactMatch) {
      // No user id — the in-memory counter still ticks, but nothing is locked in the DB.
      await recordFailedAttempt(username);
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    // Persisted lock (admin-initiated, or carried over from a previous process)
    if (user.locked_until) {
      if (new Date(user.locked_until) > new Date()) {
        return res.status(429).json({
          error: `Account locked due to too many failed attempts. Try again in ${minutesUntil(user.locked_until)} minute(s).`,
        });
      }
      // Expired — clear it for exactly this account
      await supabase.from('users').update({ locked_until: null }).eq('id', user.id);
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
      await recordFailedAttempt(username, user.id);
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    // Success — clear failed attempts for this account (in-memory + DB)
    await clearFailedAttempts(username, user.id);

    // Mint the auth cookie. The window is the user's session_minutes and slides
    // forward on each request from here on — see middleware/auth.js.
    issueAuthCookie(res, user, rememberMe);

    // Generate CSRF token for defense-in-depth
    const { generateCsrfToken } = require('../middleware/csrf');
    const csrfToken = generateCsrfToken();

    res.json({
      csrfToken,
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
  clearAuthCookie(res);
  res.json({ message: 'Logged out successfully' });
};

module.exports = { login, getMe, logout, checkAccountLock, recordFailedAttempt, clearFailedAttempts };
