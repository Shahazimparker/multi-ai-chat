// ============================================================
// FILE: backend/utils/authCookie.js
// PURPOSE: Single place that mints, refreshes and clears the auth cookie
//          so login / sliding refresh / logout can never drift apart.
// ============================================================

const jwt = require('jsonwebtoken');
const crypto = require('crypto');

const AUTH_COOKIE_NAME = 'auth_token';
// Deliberately readable by JavaScript: the double-submit check needs the client
// to echo this value back in a header, which it cannot do if the cookie is
// httpOnly. That is not a downgrade — the token is not a credential on its own,
// it only proves the request came from a document that can read our cookies.
const CSRF_COOKIE_NAME = 'csrf_token';
const DEFAULT_SESSION_MINUTES = 60;
const REMEMBER_ME_DAYS = 30;
const REMEMBER_ME_SECONDS = REMEMBER_ME_DAYS * 24 * 60 * 60; // 30 days in seconds (2,592,000s)

const parseRememberMe = (value) =>
  value === true || value === 'true' || value === 1 || value === '1';

/**
 * The session window, in seconds.
 *
 * For Remember Me sessions: 30 days persistent window.
 * For regular sessions: idle window bounded by user's session_minutes (default 60m).
 */
const getSessionSeconds = (user, rememberMe = false) =>
  parseRememberMe(rememberMe)
    ? REMEMBER_ME_SECONDS
    : (user?.session_minutes || DEFAULT_SESSION_MINUTES) * 60;

// clearCookie only matches a cookie whose attributes line up with the ones it
// was set with, so both paths have to build these identically.
const buildCookieOptions = (extra = {}) => {
  const isProduction = process.env.NODE_ENV === 'production';
  return {
    httpOnly: true,
    secure: isProduction,
    sameSite: isProduction ? 'none' : 'lax',
    // The frontend and the API are on different *.vercel.app subdomains, and
    // vercel.app is on the Public Suffix List — so the browser treats them as
    // separate sites and this is a third-party cookie. SameSite=None is what
    // makes it send at all, but it is also what makes it a cookie Chrome drops
    // outright when third-party cookies are blocked (Incognito by default):
    // login would 200, the cookie would be discarded, and /me would 401 back to
    // the login screen. Partitioned (CHIPS) opts into being stored under a key
    // scoped to the top-level site, which those modes still permit. Only one
    // frontend uses this API, so per-site partitioning costs nothing.
    partitioned: isProduction,
    path: '/',
    ...extra,
  };
};

const generateCsrfToken = () => crypto.randomBytes(32).toString('hex');

/**
 * Mints a CSRF token and sets it as a JS-readable cookie.
 *
 * Always issued next to the auth cookie so the two share a lifetime. A session
 * whose auth cookie slid forward but whose CSRF cookie expired would fail every
 * write with no way to recover short of logging out.
 *
 * @returns {string} the token, so login can also return it in its JSON body
 */
const issueCsrfCookie = (res, { maxAge, reuseToken } = {}) => {
  // The sliding refresh passes the caller's current token back in. Minting a
  // fresh one there would 403 any request already in flight that had read the
  // old value — the header would no longer match the newly-set cookie.
  const token = reuseToken || generateCsrfToken();
  res.cookie(CSRF_COOKIE_NAME, token, buildCookieOptions({ httpOnly: false, maxAge }));
  return token;
};

/**
 * Signs a fresh JWT and attaches it as the auth cookie, plus a matching CSRF
 * cookie.
 *
 * `rememberMe` rides along inside the token because the refresh path has no
 * other way to tell a persistent session from a browser-session one.
 *
 * @param {string} [reuseCsrfToken] - carry an existing CSRF token forward
 *        instead of minting a new one; used by the sliding refresh.
 * @returns {{token: string, csrfToken: string}}
 */
const issueAuthCookie = (res, user, rememberMe, reuseCsrfToken) => {
  const remember = parseRememberMe(rememberMe);
  const seconds = getSessionSeconds(user, remember);

  const token = jwt.sign(
    { userId: user.id, role: user.role, rememberMe: remember },
    process.env.JWT_SECRET,
    { expiresIn: seconds }
  );

  // No maxAge => a session cookie, discarded when the browser closes.
  const maxAge = remember ? seconds * 1000 : undefined;
  res.cookie(AUTH_COOKIE_NAME, token, buildCookieOptions({ maxAge }));
  const csrfToken = issueCsrfCookie(res, { maxAge, reuseToken: reuseCsrfToken });

  return { token, csrfToken };
};

const clearAuthCookie = (res) => {
  res.clearCookie(AUTH_COOKIE_NAME, buildCookieOptions());
  res.clearCookie(CSRF_COOKIE_NAME, buildCookieOptions({ httpOnly: false }));
};

module.exports = {
  AUTH_COOKIE_NAME,
  CSRF_COOKIE_NAME,
  DEFAULT_SESSION_MINUTES,
  REMEMBER_ME_DAYS,
  REMEMBER_ME_SECONDS,
  parseRememberMe,
  getSessionSeconds,
  buildCookieOptions,
  generateCsrfToken,
  issueCsrfCookie,
  issueAuthCookie,
  clearAuthCookie,
};
