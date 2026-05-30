import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import api from '../config/api';

const AuthContext = createContext(null);

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.get('/auth/me')
      .then((res) => setUser(res.data.user))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const login = useCallback(async (username, password, rememberMe = false) => {
    const res = await api.post('/auth/login', { username, password, rememberMe });
    const { csrfToken, user: userData } = res.data;
    if (csrfToken) sessionStorage.setItem('csrf_token', csrfToken);
    setUser(userData);
    return userData;
  }, []);

  const logout = useCallback(() => {
    api.post('/auth/logout').catch(() => {});
    sessionStorage.removeItem('csrf_token');
    setUser(null);
  }, []);

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
