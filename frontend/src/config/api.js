import axios from 'axios';

// Single source of truth for the backend origin. Exported because a few call
// sites must use native XHR/fetch rather than this axios instance — upload
// progress events and SSE streaming — and they still need the same base URL.
//
// VITE_API_URL is the configuration point. The production default is only a
// fallback for deploys that forget to set it — the URL used to be hardcoded
// with no way to override it, which made every non-default environment wrong.
export const API_BASE_URL = import.meta.env.VITE_API_URL
  || (import.meta.env.PROD
    ? 'https://multi-ai-chat-backend.vercel.app/api'
    : 'http://localhost:5000/api');

const api = axios.create({
  baseURL: API_BASE_URL,
  timeout: 120000,
  headers: { 'Content-Type': 'application/json' },
  withCredentials: true,
});

api.interceptors.request.use((config) => {
  if (config.data instanceof FormData) {
    if (config.headers) {
      delete config.headers['Content-Type'];
      delete config.headers['content-type'];
    }
  }
  const csrfToken = sessionStorage.getItem('csrf_token');
  if (csrfToken && ['post', 'put', 'delete', 'patch'].includes(config.method)) {
    config.headers['X-CSRF-Token'] = csrfToken;
  }
  return config;
});

let isRedirecting = false;

api.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 401) {
      sessionStorage.removeItem('csrf_token');
      if (window.location.pathname !== '/login' && !isRedirecting) {
        isRedirecting = true;
        sessionStorage.setItem('logged_out', 'true');
        window.location.href = '/login';
        setTimeout(() => { isRedirecting = false; }, 3000);
      }
    }
    return Promise.reject(error);
  }
);

window.addEventListener('storage', (event) => {
  if (event.key === 'logged_out' && event.newValue === 'true') {
    if (window.location.pathname !== '/login') {
      window.location.href = '/login';
    }
  }
});

export default api;
