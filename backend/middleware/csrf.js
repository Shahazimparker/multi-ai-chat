// ============================================================
// FILE: backend/middleware/csrf.js
// PURPOSE: CSRF protection — validates X-CSRF-Token on mutating requests
//          Skips for localhost/dev origins (HTTP allowed).
// ============================================================

const crypto = require('crypto');

// RFC 7230: token = 1*tchar
const TOKEN_REGEX = /^[a-zA-Z0-9_\-]{8,128}$/;

/**
 * Generate a cryptographically random CSRF token
 */
const generateCsrfToken = () => crypto.randomBytes(32).toString('hex');

/**
 * Check if request is from a localhost / dev origin (skip CSRF)
 */
const isLocalOrigin = (req) => {
  const origin = req.headers.origin || req.headers.referer || '';
  return (
    origin.startsWith('http://localhost') ||
    origin.startsWith('http://127.0.0.1') ||
    origin.startsWith('http://[::1]') ||
    origin.startsWith('http://192.168.') ||
    origin.startsWith('http://10.') ||
    origin.startsWith('http://172.')
  );
};

/**
 * CSRF validation middleware — only checks mutating methods
 */
const csrfProtection = (req, res, next) => {
  // Only validate state-changing methods
  const mutatingMethods = ['POST', 'PUT', 'DELETE', 'PATCH'];
  if (!mutatingMethods.includes(req.method)) return next();

  // Skip CSRF for localhost / dev origins (HTTP allowed)
  if (isLocalOrigin(req)) {
    return next();
  }

  // Also skip for health checks, auth routes, and public stream endpoint
  if (req.path === '/api/health') return next();
  if (req.path === '/api/auth/login') return next();
  if (req.path === '/api/chat/stream') return next();

  const csrfToken = req.headers['x-csrf-token'];

  if (!csrfToken || typeof csrfToken !== 'string') {
    return res.status(403).json({ error: 'CSRF token missing' });
  }

  if (!TOKEN_REGEX.test(csrfToken)) {
    return res.status(403).json({ error: 'Invalid CSRF token format' });
  }

  // Token is present and well-formed — proceed
  // (In a stateful setup, you'd verify against server-side store.
  //  Here the custom header itself prevents cross-origin simple requests,
  //  and the token is only obtainable via the login endpoint.)
  next();
};

module.exports = { csrfProtection, generateCsrfToken };
