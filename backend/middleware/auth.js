// ============================================================
// FILE: backend/middleware/auth.js
// PURPOSE: Verifies JWT token on protected routes
//          Also checks session validity and account expiry
// ============================================================

const jwt      = require('jsonwebtoken');
const supabase = require('../config/supabase');
const { getCookieValue } = require('../utils/cookies');
const {
  AUTH_COOKIE_NAME,
  CSRF_COOKIE_NAME,
  getSessionSeconds,
  issueAuthCookie,
  issueCsrfCookie,
  parseRememberMe,
} = require('../utils/authCookie');

// Re-mint the cookie once the token is past its half-life. Doing it on every
// request would re-sign a JWT and rewrite a Set-Cookie header for no reason;
// the half-life means it happens at most once per half session window, while
// still leaving a wide margin before the old token would have expired.
const REFRESH_AFTER_FRACTION = 0.5;

// Columns safe to attach to req.user — never select '*' here, it pulls
// the bcrypt password hash (and any future secret column) into the request.
// `timezone` requires database/migration_add_user_timezone.sql. Postgres fails
// the whole select on an unknown column, so that migration has to be applied
// before this code is deployed — schema first, then code, as usual.
const AUTH_USER_COLUMNS =
  'id, email, username, role, is_active, expires_at, total_tokens, used_tokens, per_query_limit, session_minutes, timezone';

/**
 * Builds the JWT + account-state guard.
 *
 * Strict mode (the default) rejects the request with the matching status.
 * Optional mode never rejects: any failure — missing, malformed or expired
 * token, unknown user, disabled or expired account — leaves `req.user` null
 * and the request continues as anonymous. Note that a disabled or expired
 * account is therefore downgraded to anonymous rather than being let through
 * with its user record attached.
 */
const createAuthMiddleware = ({ optional = false } = {}) => async (req, res, next) => {
  // Single exit point for every failure, so strict and optional modes can
  // never drift apart in which conditions they treat as a failure.
  const reject = (status, error) => {
    if (!optional) return res.status(status).json({ error });
    req.user = null;
    return next();
  };

  try {
    const authHeader = req.headers.authorization;
    const bearerToken = authHeader?.startsWith('Bearer ') ? authHeader.split(' ')[1] : null;
    const cookieToken = getCookieValue(req.headers.cookie, AUTH_COOKIE_NAME);
    const token = bearerToken || cookieToken;
    if (!token) return reject(401, 'No token provided');

    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    // Fetch fresh user data from DB (check is_active, expires_at)
    const { data: user, error } = await supabase
      .from('users')
      .select(AUTH_USER_COLUMNS)
      .eq('id', decoded.userId)
      .single();

    if (error || !user) return reject(401, 'User not found');
    if (!user.is_active) return reject(403, 'Account disabled');

    // Check account expiry
    if (user.expires_at && new Date(user.expires_at) < new Date()) {
      return reject(403, 'Account expired');
    }

    req.user = user;  // attach user to request object

    // Sliding session: an active user should not be logged out mid-task just
    // because a fixed clock started at login ran out. Only cookie-authenticated
    // requests are refreshed — a Bearer caller holds its own token and would
    // never see the new one.
    if (!bearerToken && cookieToken) {
      const csrfCookie = getCookieValue(req.headers.cookie, CSRF_COOKIE_NAME);
      const remember = parseRememberMe(decoded.rememberMe);
      const sessionSeconds = getSessionSeconds(user, remember);
      const secondsLeft = decoded.exp - Math.floor(Date.now() / 1000);
      if (secondsLeft < sessionSeconds * REFRESH_AFTER_FRACTION) {
        // Falsy for tokens minted before rememberMe was in the payload, which
        // degrades to a session cookie rather than failing the request.
        // The caller's existing CSRF token rides along so the refresh extends
        // its lifetime without invalidating requests already in flight.
        issueAuthCookie(res, user, decoded.rememberMe, csrfCookie);
      } else if (!csrfCookie) {
        // A valid session with no CSRF cookie — one that predates the
        // double-submit check, or whose cookie was wiped. The CSRF middleware
        // runs app-wide before this one, so it has already turned away any
        // write; repairing it here means a plain GET (the app issues one on
        // mount) heals the session before the user ever sees a 403.
        issueCsrfCookie(res, {
          maxAge: remember ? sessionSeconds * 1000 : undefined,
        });
      }
    }

    next();
  } catch (err) {
    if (err.name === 'TokenExpiredError') {
      return reject(401, 'Session expired. Please login again.');
    }
    return reject(401, 'Invalid token');
  }
};

// ── Verify JWT + session + account expiry ──────────────────
const requireAuth = createAuthMiddleware();

// ── Same checks, but anonymous requests are allowed through ──
const optionalAuth = createAuthMiddleware({ optional: true });

// ── Admin-only guard (use after requireAuth) ───────────────
const requireAdmin = (req, res, next) => {
  if (req.user?.role !== 'admin') {
    return res.status(403).json({ error: 'Admin access required' });
  }
  next();
};

module.exports = { requireAuth, optionalAuth, requireAdmin, AUTH_USER_COLUMNS };
