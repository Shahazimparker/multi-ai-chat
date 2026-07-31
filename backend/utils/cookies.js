// ============================================================
// FILE: backend/utils/cookies.js
// PURPOSE: Minimal cookie header parsing shared by auth middleware and routes.
//          Avoids pulling in cookie-parser for the single value we read.
// ============================================================

/**
 * Read one cookie value out of a raw `Cookie:` header.
 *
 * @param {string|undefined} cookieHeader - req.headers.cookie
 * @param {string} key - cookie name to look up
 * @returns {string|null} decoded value, or null when absent
 */
const getCookieValue = (cookieHeader, key) => {
  if (!cookieHeader) return null;
  const parts = String(cookieHeader).split(';');
  for (const part of parts) {
    const [rawKey, ...rest] = part.trim().split('=');
    if (rawKey === key) return decodeURIComponent(rest.join('='));
  }
  return null;
};

module.exports = { getCookieValue };
