// ============================================================
// FILE: backend/controllers/auth.controller.js
// PURPOSE: Handles login, logout, session verification
//          Returns JWT token on successful login
// ============================================================

const bcrypt = require('bcryptjs');
const supabase = require('../config/supabase');
const { issueAuthCookie, clearAuthCookie, parseRememberMe } = require('../utils/authCookie');

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
// Durable via login_attempt_counters (migration_add_rate_limiting.sql) rather
// than an in-memory Map — Vercel runs many short-lived instances, so a
// per-process counter gave every cold instance its own fresh budget and
// multiplied it across concurrent ones. Keyed on the identifier text (not a
// user id) because a nonexistent username still needs to accumulate failures;
// see the migration's comment on login_attempt_counters for why.
const MAX_FAILS = 5;                   // lock after 5 failed attempts
const LOCK_DURATION_MS = 15 * 60 * 1000; // 15 minutes
const ATTEMPT_WINDOW_MS = 15 * 60 * 1000; // failures older than this stop counting

const minutesUntil = (timestamp) => Math.ceil((new Date(timestamp) - Date.now()) / 1000 / 60);

/**
 * Durable lock check against login_attempt_counters — covers identifiers that
 * may not resolve to any real user, which have no users row to check instead.
 * (login()'s existing check of the already-fetched user.locked_until handles
 * the resolved-user case for free, without a second round trip.)
 * Returns minutes remaining, or null when not locked.
 */
const checkAccountLock = async (identifier) => {
  const key = String(identifier || '').toLowerCase();
  try {
    const { data, error } = await supabase
      .from('login_attempt_counters')
      .select('locked_until')
      .eq('identifier', key)
      .maybeSingle();
    if (error) throw error;
    if (data?.locked_until && new Date(data.locked_until) > new Date()) {
      return minutesUntil(data.locked_until);
    }
    return null;
  } catch (err) {
    // Fail open, same reasoning as rateLimitStore.service.js: a DB hiccup on
    // this check must not make login itself unusable for every real user.
    console.error('[Auth] checkAccountLock error:', err.message);
    return null;
  }
};

/**
 * Record a failed login attempt via the atomic record_login_failure RPC
 * (sliding window + lock decision happen in one DB round trip, avoiding the
 * classic read-then-write race under concurrent requests).
 *
 * The DB lock is mirrored onto users.locked_until only when the caller
 * resolved a real user, and only via that user's primary key — never by a
 * caller-supplied pattern. A pattern-based UPDATE here previously let an
 * unauthenticated caller lock every account in the system at once;
 * record_login_failure is keyed on the exact identifier text passed as a
 * parameterized RPC argument, not a LIKE pattern, so that can't recur.
 *
 * @param {string} identifier - what the caller typed (username or email)
 * @param {string|null} userId - resolved user id, or null when no user matched
 */
const recordFailedAttempt = async (identifier, userId = null) => {
  const key = String(identifier || '').toLowerCase();

  let lockedUntil;
  try {
    const { data, error } = await supabase.rpc('record_login_failure', {
      p_identifier: key,
      p_window_ms: ATTEMPT_WINDOW_MS,
      p_max_fails: MAX_FAILS,
      p_lock_ms: LOCK_DURATION_MS,
    });
    if (error) throw error;
    const row = Array.isArray(data) ? data[0] : data;
    lockedUntil = row?.locked_until || null;
  } catch (err) {
    // Fail open — an outage here means this one attempt goes uncounted, not
    // that login breaks for everyone else.
    console.error('[Auth] record_login_failure error:', err.message);
    return;
  }

  // Persist to DB when threshold is reached — only ever for a known account.
  if (lockedUntil && userId) {
    try {
      const { error } = await supabase
        .from('users')
        .update({ locked_until: lockedUntil })
        .eq('id', userId);
      if (error) console.error('[Auth] DB lock persist error:', error.message);
    } catch (err) {
      console.error('[Auth] DB lock persist error:', err.message);
    }
  }
};

/**
 * Clear failed attempts — resets the durable counter and, when a user id is
 * supplied, the persisted DB lock for exactly that account.
 *
 * @param {string} identifier - username or email used at login
 * @param {string|null} userId - resolved user id
 */
const clearFailedAttempts = async (identifier, userId = null) => {
  const key = String(identifier || '').toLowerCase();
  try {
    const { error } = await supabase.from('login_attempt_counters').delete().eq('identifier', key);
    if (error) console.error('[Auth] login_attempt_counters clear error:', error.message);
  } catch (err) {
    console.error('[Auth] login_attempt_counters clear error:', err.message);
  }

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

    // Per-account lock — durable check against login_attempt_counters
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

    // Re-assert an exact (case-insensitive) match. `ilike` still treats `_` as a
    // single-character wildcard, so a row can come back that isn't the account
    // the caller named; without this, `a_min` would resolve to `admin`.
    const identifier = username.toLowerCase();
    const isExactMatch = user
      && (String(user.username || '').toLowerCase() === identifier
        || String(user.email || '').toLowerCase() === identifier);

    if (error || !user || !isExactMatch) {
      // No user id — the identifier's own counter still ticks, but no users row is locked.
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

    // Success — clear failed attempts for this account
    await clearFailedAttempts(username, user.id);

    // Mint the auth cookie plus the matching CSRF cookie. The window is the
    // user's session_minutes and slides forward on each request from here on —
    // see middleware/auth.js. The CSRF token is returned in the body too so a
    // non-browser client can read it without parsing Set-Cookie.
    const { csrfToken } = issueAuthCookie(res, user, rememberMe);

    res.json({
      csrfToken,
      user: {
        rememberMe: parseRememberMe(rememberMe),
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

  // rememberMe is a property of the session, not the account, so it comes from
  // the JWT via the auth middleware rather than the users table. The client
  // uses it to suppress the idle-logout timer for persistent sessions.
  res.json({ user: user ? { ...user, rememberMe: Boolean(req.rememberMe) } : user });
};

/**
 * POST /api/auth/logout — client should discard JWT; we just confirm
 */
const logout = (req, res) => {
  clearAuthCookie(res);
  res.json({ message: 'Logged out successfully' });
};

module.exports = { login, getMe, logout, checkAccountLock, recordFailedAttempt, clearFailedAttempts };
