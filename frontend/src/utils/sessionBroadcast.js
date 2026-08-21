// ============================================================
// FILE: frontend/src/utils/sessionBroadcast.js
// PURPOSE: Tell other open tabs that this session has ended
// ============================================================

// Must be localStorage, not sessionStorage. `storage` events only reach
// documents that share the storage area, and sessionStorage is scoped to a
// single tab — so a sessionStorage write is never seen by anyone.
const BROADCAST_KEY = 'session_ended';

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

    if (window.location.pathname === '/login') return;
    // sessionStorage is correct here — the notice belongs to this tab only.
    sessionStorage.setItem('logout_reason', reason);
    sessionStorage.removeItem('csrf_token');
    window.location.href = '/login';
  };

  window.addEventListener('storage', handler);
  return () => window.removeEventListener('storage', handler);
};
