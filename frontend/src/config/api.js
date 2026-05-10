// ============================================================
// FILE: frontend/src/config/api.js
// PURPOSE: Axios instance pre-configured with base URL & JWT
//          All API calls import from here, not raw axios
// CHANGE:  REACT_APP_API_URL in .env for production
// ============================================================

import axios from 'axios';
const API_BASE_URL = 'https://multi-ai-chat-backend.vercel.app/api';

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
api.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 401) {
      // Token expired — clear storage and redirect to login
      localStorage.removeItem('auth_token');
      sessionStorage.removeItem('auth_token');
      window.location.href = '/login';
    }
    return Promise.reject(error);
  }
);

export default api;
