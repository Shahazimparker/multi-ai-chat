// ============================================================
// FILE: frontend/src/context/AuthContext.jsx
// PURPOSE: Global auth state — user, token, login/logout
//          Wraps entire app. Use useAuth() hook to access.
// ============================================================

import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import api from '../config/api';

const AuthContext = createContext(null);

export const AuthProvider = ({ children }) => {
  const [user,    setUser]    = useState(null);
  const [loading, setLoading] = useState(true); // initial token verification

  // ── Restore session on page load ──────────────────────────
  useEffect(() => {
    const token = localStorage.getItem('auth_token') ||
                  sessionStorage.getItem('auth_token');
    if (token) {
      api.get('/auth/me')
        .then(res => setUser(res.data.user))
        .catch(() => {
          localStorage.removeItem('auth_token');
          sessionStorage.removeItem('auth_token');
        })
        .finally(() => setLoading(false));
    } else {
      setLoading(false);
    }
  }, []);

  // ── Login ──────────────────────────────────────────────────
  const login = useCallback(async (username, password, rememberMe = false) => {
    const res = await api.post('/auth/login', { username, password });
    const { token, csrfToken, user: userData } = res.data;

    // rememberMe → localStorage (persists); else sessionStorage
    if (rememberMe) localStorage.setItem('auth_token', token);
    else            sessionStorage.setItem('auth_token', token);

    // CSRF token — always sessionStorage (cleared on tab close)
    if (csrfToken) sessionStorage.setItem('csrf_token', csrfToken);

    setUser(userData);
    return userData;
  }, []);

  // ── Logout ─────────────────────────────────────────────────
  const logout = useCallback(() => {
    localStorage.removeItem('auth_token');
    sessionStorage.removeItem('auth_token');
    sessionStorage.removeItem('csrf_token');
    setUser(null);
  }, []);

  // ── Refresh token stats (called after each AI response) ───
  const refreshTokenStats = useCallback(async () => {
    try {
      const res = await api.get('/auth/me');
      setUser(res.data.user);
    } catch {/* silent */}
  }, []);

  return (
    <AuthContext.Provider value={{ user, loading, login, logout, refreshTokenStats }}>
      {children}
    </AuthContext.Provider>
  );
};

// Custom hook
export const useAuth = () => {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be inside AuthProvider');
  return ctx;
};
