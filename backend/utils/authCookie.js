// ============================================================
// FILE: backend/utils/authCookie.js
// PURPOSE: Single place that mints, refreshes and clears the auth cookie
//          so login / sliding refresh / logout can never drift apart.
// ============================================================

const jwt = require('jsonwebtoken');

const AUTH_COOKIE_NAME = 'auth_token';
const DEFAULT_SESSION_MINUTES = 60;

const parseRememberMe = (value) =>
  value === true || value === 'true' || value === 1 || value === '1';

/**
 * The session window, in seconds.
 *
 * Note this is now an *idle* window, not an absolute one: the middleware slides
 * it forward while the user keeps making requests. It bounds how long a session
 * can sit untouched before it dies, which is what the admin-facing "Session
 * Duration" field is meant to control.
 */
const getSessionSeconds = (user) =>
  (user?.session_minutes || DEFAULT_SESSION_MINUTES) * 60;

// clearCookie only matches a cookie whose attributes line up with the ones it
// was set with, so both paths have to build these identically.
const buildCookieOptions = (extra = {}) => {
  const isProduction = process.env.NODE_ENV === 'production';
  return {
    httpOnly: true,
    secure: isProduction,
    sameSite: isProduction ? 'none' : 'lax',
    path: '/',
    ...extra,
  };
};

/**
 * Signs a fresh JWT and attaches it as the auth cookie.
 *
 * `rememberMe` rides along inside the token because the refresh path has no
 * other way to tell a persistent session from a browser-session one.
 *
 * @returns {string} the signed token
 */
const issueAuthCookie = (res, user, rememberMe) => {
  const remember = parseRememberMe(rememberMe);
  const seconds = getSessionSeconds(user);

  const token = jwt.sign(
    { userId: user.id, role: user.role, rememberMe: remember },
    process.env.JWT_SECRET,
    { expiresIn: seconds }
  );

  // No maxAge => a session cookie, discarded when the browser closes.
  res.cookie(
    AUTH_COOKIE_NAME,
    token,
    buildCookieOptions({ maxAge: remember ? seconds * 1000 : undefined })
  );

  return token;
};

const clearAuthCookie = (res) => res.clearCookie(AUTH_COOKIE_NAME, buildCookieOptions());

module.exports = {
  AUTH_COOKIE_NAME,
  DEFAULT_SESSION_MINUTES,
  parseRememberMe,
  getSessionSeconds,
  buildCookieOptions,
  issueAuthCookie,
  clearAuthCookie,
};
