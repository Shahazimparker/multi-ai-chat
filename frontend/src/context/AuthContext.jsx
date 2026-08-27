import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import api from '../config/api';
import { useIdleLogout, markActivity, clearActivity, getLastActivity } from '../hooks/useIdleLogout';
import { broadcastLogout, setCsrfToken, clearCsrfToken } from '../utils/sessionBroadcast';

// The backend slides the auth cookie forward whenever a request comes in, so a
// user who is active but not triggering requests — reading a long answer, say —
// could still let the cookie lapse. A cheap periodic ping keeps the two clocks
// aligned. It only fires when there has actually been activity, so a genuinely
// idle session is still allowed to expire on its own.
const KEEPALIVE_INTERVAL_MS = 10 * 60 * 1000;

const AuthContext = createContext(null);

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.get('/auth/me')
      .then((res) => {
        setUser(res.data.user);
        // Restoring a session on reload counts as activity — otherwise a tab
        // reopened after the deadline would be signed out before it renders.
        markActivity();
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const login = useCallback(async (username, password, rememberMe = false) => {
    const res = await api.post('/auth/login', { username, password, rememberMe });
    const { csrfToken, user: userData } = res.data;
    // The server sets this same value as a cookie as well, and that cookie is
    // what request sites prefer. Keeping the body copy matters anyway: in
    // production the API is a different host, so its cookie is not visible to
    // document.cookie here and this is the only readable source.
    setCsrfToken(csrfToken);
    markActivity();
    setUser(userData);
    return userData;
  }, []);

  // Local state is dropped synchronously so existing `logout(); navigate(...)`
  // callers behave exactly as before; the returned promise lets the idle path
  // wait for the cookie to actually be cleared before it reloads the page.
  const logout = useCallback((reason = 'manual') => {
    // The token is dropped only once the request is on its way. Axios runs its
    // request interceptor in a microtask, so clearing it on the line below
    // would strip X-CSRF-Token off this very request — the server would reject
    // the logout and the auth cookie would outlive it.
    const request = api.post('/auth/logout').catch(() => {}).finally(clearCsrfToken);
    clearActivity();
    broadcastLogout(reason);
    setUser(null);
    return request;
  }, []);

  const handleIdle = useCallback(async () => {
    await logout('idle');
    sessionStorage.setItem('logout_reason', 'idle');
    // Hard navigation rather than router navigation: AuthProvider sits outside
    // BrowserRouter, and a full reload also discards any in-memory chat state.
    window.location.href = '/login';
  }, [logout]);

  // A "Remember me" session is a deliberate 30-day one; arming the 30-minute
  // idle timer on top of it would sign the user out long before the cookie the
  // server issued expires, making the checkbox do nothing for anyone who leaves
  // a tab open. Persistent sessions therefore opt out of the idle timer and
  // rely on the cookie's own expiry.
  useIdleLogout(Boolean(user) && !user?.rememberMe, handleIdle);

  useEffect(() => {
    if (!user) return undefined;

    let lastPing = Date.now();
    const id = setInterval(() => {
      if (getLastActivity() <= lastPing) return;  // nothing happened; let it lapse
      lastPing = Date.now();
      api.get('/auth/me').catch(() => {});        // 401s are handled by the interceptor
    }, KEEPALIVE_INTERVAL_MS);

    return () => clearInterval(id);
  }, [user]);

  const refreshTokenStats = useCallback(async () => {
    try {
      const res = await api.get('/auth/me');
      setUser(res.data.user);
    } catch {}
  }, []);

  return (
    <AuthContext.Provider value={{ user, loading, login, logout, refreshTokenStats }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be inside AuthProvider');
  return ctx;
};
