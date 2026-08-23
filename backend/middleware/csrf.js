// ============================================================
// FILE: backend/middleware/csrf.js
// PURPOSE: CSRF protection — double-submit cookie check on mutating requests.
// ============================================================
// This used to accept any header matching a character-class regex, which meant
// `X-CSRF-Token: aaaaaaaa` passed. The only real protection was the CORS
// preflight, and the auth cookie is deliberately SameSite=none in production
// (frontend and backend sit on different domains), so it is sent cross-site.
//
// The double-submit pattern closes that: the same random token goes out as a
// cookie AND has to come back in a header, and the two must match. The browser
// sends the cookie on a forged cross-site request, but the attacker cannot
// produce the header — reading the cookie is blocked by the same-origin policy,
// and a custom header forces a preflight the CORS allowlist rejects.
//
// Note the client cannot always source the header from the cookie: with the SPA
// and the API on separate hosts, document.cookie there never shows ours. Login
// therefore also returns the token in its JSON body, which CORS does expose to
// the allowlisted origin and to nobody else. Either way the cookie remains the
// server's side of the comparison.

const crypto = require('crypto');
const { getCookieValue } = require('../utils/cookies');
const {
  CSRF_COOKIE_NAME,
  generateCsrfToken,
  issueCsrfCookie,
} = require('../utils/authCookie');

// Cheap pre-filter so a malformed value is rejected before any comparison.
const TOKEN_REGEX = /^[a-zA-Z0-9_-]{8,128}$/;

// Lets the client tell a CSRF rejection apart from the other things that 403
// (disabled account, expired account, non-admin) without matching on prose.
// A CSRF failure is recoverable by signing in again; the others are not.
const CSRF_ERROR_CODE = 'CSRF_TOKEN_INVALID';

const MUTATING_METHODS = new Set(['POST', 'PUT', 'DELETE', 'PATCH']);

// Routes that mint the session and therefore cannot present a token yet.
const EXEMPT_PATHS = new Set(['/api/health', '/api/auth/login']);

// Anchored so a cookie whose name merely *ends* in auth_token (`x_auth_token`)
// is not mistaken for ours.
const hasAuthCookie = (req) => /(?:^|;\s*)auth_token=/.test(req.headers.cookie || '');

const isBearerCaller = (req) => Boolean(req.headers.authorization?.startsWith('Bearer '));

const hasAuthCredential = (req) => isBearerCaller(req) || hasAuthCookie(req);

// timingSafeEqual throws when the buffers differ in length, so the length check
// has to come first — and a length mismatch is already a definitive rejection.
const tokensMatch = (a, b) => {
  const bufA = Buffer.from(a, 'utf8');
  const bufB = Buffer.from(b, 'utf8');
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
};

const reject = (res, error) => res.status(403).json({ error, code: CSRF_ERROR_CODE });

const csrfProtection = (req, res, next) => {
  if (!MUTATING_METHODS.has(req.method)) return next();
  if (EXEMPT_PATHS.has(req.path)) return next();

  // Anonymous requests carry no ambient authority, so there is nothing for an
  // attacker to ride on and nothing to protect.
  if (!hasAuthCredential(req)) return next();

  // A Bearer caller is not a browser: it has no cookie jar for an attacker to
  // exploit, so there is no cross-site request to forge. Requiring a cookie
  // here would break API clients for no security gain.
  const isBearer = isBearerCaller(req);
  const cookieToken = getCookieValue(req.headers.cookie, CSRF_COOKIE_NAME);

  // Recovery hatch. A cookie session can legitimately hold a valid auth_token
  // and no csrf_token: sessions that predate this middleware, and any session
  // whose (deliberately non-httpOnly) CSRF cookie a privacy tool or the user
  // wiped. Without this, every write 403s forever with no way back short of
  // signing out. Mint one here so the client's next attempt succeeds.
  //
  // This request is still rejected below — nothing is let through unvalidated.
  // And it is not a hole an attacker can pry at: they can provoke the mint but
  // cannot read the Set-Cookie (it lands in the victim's jar, readable only by
  // our own origin), and the guard above means it can never overwrite a token
  // that is already working.
  if (!cookieToken && !isBearer && hasAuthCookie(req)) {
    // No maxAge — a session cookie. The sliding refresh in middleware/auth.js
    // knows rememberMe and will realign the lifetime on the next request.
    issueCsrfCookie(res);
  }

  const headerToken = req.headers['x-csrf-token'];
  if (!headerToken || typeof headerToken !== 'string') {
    return reject(res, 'CSRF token missing. Please retry.');
  }
  if (!TOKEN_REGEX.test(headerToken)) {
    return reject(res, 'Invalid CSRF token format');
  }

  if (!cookieToken) {
    if (isBearer) return next();
    return reject(res, 'CSRF cookie missing. Please retry.');
  }

  if (!tokensMatch(headerToken, cookieToken)) {
    return reject(res, 'CSRF token mismatch');
  }

  next();
};

module.exports = { csrfProtection, generateCsrfToken, CSRF_ERROR_CODE };
