// ============================================================
// FILE: frontend/src/config/api.js
// PURPOSE: Axios instance pre-configured with base URL & JWT
//          All API calls import from here, not raw axios
// CHANGE:  REACT_APP_API_URL in .env for production
// ============================================================

import axios from 'axios';
const API_BASE_URL = process.env.NODE_ENV === 'production'
  ? 'https://multi-ai-chat-backend.vercel.app/api'
  : 'http://localhost:5000/api';

const api = axios.create({
  baseURL: API_BASE_URL,
  timeout: 120000,
  headers: { 'Content-Type': 'application/json' },
});

// ── Attach JWT token to every request ─────────────────────
api.interceptors.request.use((config) => {
  const token = localStorage.getItem('auth_token') ||
    sessionStorage.getItem('auth_token');
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

// ── Global response error handling ─────────────────────────
let isRedirecting = false; // guards against redirect loops across multiple tabs
api.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 401 && !isRedirecting) {
      // Already on login page — don't loop
      if (window.location.pathname === '/login') {
        return Promise.reject(error);
      }
      isRedirecting = true;
      localStorage.removeItem('auth_token');
      sessionStorage.removeItem('auth_token');
      sessionStorage.setItem('logged_out', 'true'); // signal other tabs
      window.location.href = '/login';
    }
    return Promise.reject(error);
  }
);

// Listen for logout events from other tabs (same-origin storage sync)
window.addEventListener('storage', (e) => {
  if (e.key === 'logged_out' && e.newValue === 'true') {
    localStorage.removeItem('auth_token');
    sessionStorage.removeItem('auth_token');
    if (window.location.pathname !== '/login') {
      window.location.href = '/login';
    }
  }
});

export default api;
