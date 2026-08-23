// ============================================================
// FILE: frontend/src/utils/sessionBroadcast.js
// PURPOSE: Tell other open tabs that this session has ended
// ============================================================

// Must be localStorage, not sessionStorage. `storage` events only reach
// documents that share the storage area, and sessionStorage is scoped to a
// single tab — so a sessionStorage write is never seen by anyone.
const BROADCAST_KEY = 'session_ended';

// ── CSRF token ───────────────────────────────────────────────
// The server issues the token two ways at once: as a JS-readable cookie, and
// in the login response body. Both are needed, because which one is usable
// depends on where the app is deployed.
export const CSRF_COOKIE_NAME = 'csrf_token';
const CSRF_STORAGE_KEY = 'csrf_token';

// Built from the constant so the two cannot drift. The leading `^|;\s*` is
// load-bearing: without it this would happily match a different cookie whose
// name merely ends in ours, e.g. `xsrf_csrf_token`.
const CSRF_COOKIE_RE = new RegExp(`(?:^|;\\s*)${CSRF_COOKIE_NAME}=([^;]*)`);

/**
 * The token to echo back in X-CSRF-Token.
 *
 * Cookie first: it is the server's live value, every tab sees the same one,
 * and it repairs itself whenever the server re-issues it.
 *
 * But `document.cookie` only exposes cookies scoped to *this* host, and in
 * production the SPA and the API are separate deployments on separate hosts
 * (multi-ai-chat-frontend.vercel.app vs multi-ai-chat-backend.vercel.app), so
 * the API's cookie is invisible here. The browser still *sends* it — that is
 * what makes the server's double-submit comparison work — we simply cannot
 * read it. The login body carries the same value and CORS does let us read
 * that, so the stored copy is the cross-origin fallback.
 */
export const getCsrfToken = () => {
  const match = document.cookie.match(CSRF_COOKIE_RE);
  if (match) return decodeURIComponent(match[1]);
  try {
    return localStorage.getItem(CSRF_STORAGE_KEY) || null;
  } catch {
    return null;
  }
};

/**
 * Remembers the token from the login response.
 *
 * localStorage, not sessionStorage: a second tab inherits the auth cookie but
 * starts with an empty sessionStorage, and cross-origin it has no cookie to
 * fall back on — so it would have no token to send at all. Storing it is not
 * a downgrade: the token authenticates nothing by itself, and the cookie
 * holding the very same value is already deliberately readable by scripts.
 */
export const setCsrfToken = (token) => {
  if (!token) return;
  try {
    localStorage.setItem(CSRF_STORAGE_KEY, token);
  } catch {
    /* private mode — the cookie path may still work */
  }
};

export const clearCsrfToken = () => {
  try {
    localStorage.removeItem(CSRF_STORAGE_KEY);
  } catch {
    /* nothing stored to begin with */
  }
};

/**
 * Signals every other tab that the session is over.
 *
 * The writing tab does NOT receive its own `storage` event, so callers still
 * have to handle their own redirect.
 *
 * @param {'idle'|'expired'|'manual'} reason - shown on the login screen
 */
export const broadcastLogout = (reason) => {
  try {
    // Writing an identical value is a no-op that fires no event, so the
    // timestamp is load-bearing: it makes every logout a distinct value.
    localStorage.setItem(BROADCAST_KEY, JSON.stringify({ reason, at: Date.now() }));
  } catch {
    /* other tabs stay open; their own auth check will catch up */
  }
};

/**
 * Redirects this tab to the login screen when another tab logs out.
 *
 * @returns {Function} unsubscribe
 */
export const listenForLogout = () => {
  const handler = (event) => {
    if (event.key !== BROADCAST_KEY || !event.newValue) return;

    let reason = 'manual';
    try {
      reason = JSON.parse(event.newValue).reason || 'manual';
    } catch {
      /* keep the default */
    }

    // The token is deliberately NOT cleared here. The tab that logged out
    // already removed it from the shared localStorage, and racing it from a
    // second tab could strip the header off its in-flight logout request.
    if (window.location.pathname === '/login') return;
    // sessionStorage is correct here — the notice belongs to this tab only.
    sessionStorage.setItem('logout_reason', reason);
    window.location.href = '/login';
  };

  window.addEventListener('storage', handler);
  return () => window.removeEventListener('storage', handler);
};
