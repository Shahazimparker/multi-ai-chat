import axios from 'axios';
import {
  broadcastLogout,
  listenForLogout,
  getCsrfToken,
  clearCsrfToken,
} from '../utils/sessionBroadcast';

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
  const csrfToken = getCsrfToken();
  if (csrfToken && ['post', 'put', 'delete', 'patch'].includes(config.method)) {
    config.headers['X-CSRF-Token'] = csrfToken;
  }
  return config;
});

let isRedirecting = false;

// A 403 can mean several unrelated things — disabled account, expired account,
// not an admin — and none of those are fixed by retrying or by signing in
// again. Only the CSRF middleware stamps this code, and that failure means
// exactly one thing: the token this client sent is not one the server accepts.
const isCsrfFailure = (error) =>
  error.response?.status === 403 && error.response?.data?.code === 'CSRF_TOKEN_INVALID';

// By the time a response interceptor sees it, config.headers is an AxiosHeaders
// instance that has normalised the key we wrote, so read it through the API
// rather than by the literal name we set.
const sentCsrfToken = (config) => {
  const headers = config?.headers;
  if (!headers) return undefined;
  if (typeof headers.get === 'function') return headers.get('X-CSRF-Token');
  return headers['X-CSRF-Token'] ?? headers['x-csrf-token'];
};

api.interceptors.response.use(
  (response) => response,
  (error) => {
    // The server mints a CSRF cookie when it rejects an authenticated session
    // that has none, so on a same-host deploy we now hold a good token that we
    // did not have a moment ago. Replaying is safe: the middleware turned the
    // request away before any handler ran, so nothing happened server-side.
    // Bounded to one attempt, and only when the token actually changed — so a
    // token the server keeps refusing falls through to the redirect below.
    if (isCsrfFailure(error) && error.config && !error.config.csrfRetried) {
      const fresh = getCsrfToken();
      if (fresh && fresh !== sentCsrfToken(error.config)) {
        error.config.csrfRetried = true;
        return api.request(error.config);
      }
    }

    // Signing in re-issues a token, so an unrecoverable CSRF failure is the one
    // 403 worth treating like an expired session. Login is exempt from the CSRF
    // check, so this can never turn into a redirect loop.
    if (error.response?.status === 401 || isCsrfFailure(error)) {
      // Drop the shared idle clock too, so the next sign-in starts fresh
      // instead of inheriting this session's deadline.
      localStorage.removeItem('last_activity');
      clearCsrfToken();
      if (window.location.pathname !== '/login' && !isRedirecting) {
        isRedirecting = true;
        broadcastLogout('expired');
        sessionStorage.setItem('logout_reason', 'expired');
        window.location.href = '/login';
        setTimeout(() => { isRedirecting = false; }, 3000);
      }
    }
    return Promise.reject(error);
  }
);

listenForLogout();

export default api;
