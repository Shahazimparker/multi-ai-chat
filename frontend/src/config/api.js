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

// ── Attach JWT + CSRF token to every request ──────────────
api.interceptors.request.use((config) => {
  const token = localStorage.getItem('auth_token') ||
    sessionStorage.getItem('auth_token');
  if (token) config.headers.Authorization = `Bearer ${token}`;

  // Attach CSRF token for mutating requests
  const csrfToken = sessionStorage.getItem('csrf_token');
  if (csrfToken && ['post', 'put', 'delete', 'patch'].includes(config.method)) {
    config.headers['X-CSRF-Token'] = csrfToken;
  }
  return config;
});

// ── Global response error handling ─────────────────────────
let isRedirecting = false; // guards against redirect loops across multiple tabs
let redirectTimeout = null;

api.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 401) {
      // Always clear stale tokens — prevents them from being re-sent on next requests
      localStorage.removeItem('auth_token');
      sessionStorage.removeItem('auth_token');
      sessionStorage.removeItem('csrf_token');

      // Already on login page — just clear tokens, don't redirect
      if (window.location.pathname === '/login') {
        return Promise.reject(error);
      }

      if (!isRedirecting) {
        isRedirecting = true;
        sessionStorage.setItem('logged_out', 'true'); // signal other tabs
        window.location.href = '/login';

        // Safety: reset flag after 3s if redirect failed (e.g., SPA router intercepted)
        redirectTimeout = setTimeout(() => { isRedirecting = false; }, 3000);
      }
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
