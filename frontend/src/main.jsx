// ============================================================
// FILE: frontend/src/main.jsx
// PURPOSE: React app entry — renders App into DOM
// ============================================================

import React from 'react';
import ReactDOM from 'react-dom/client';
import * as Sentry from '@sentry/react';
import { registerSW } from 'virtual:pwa-register';
import './index.css';
import App from './App';

// Register PWA Service Worker for offline capability & mobile install
registerSW({
  immediate: true,
  onNeedRefresh() {
    console.log('[PWA] New content available, updating...');
  },
  onOfflineReady() {
    console.log('[PWA] App is ready for offline usage');
  }
});

// Initialize Sentry for error tracking
if (import.meta.env.VITE_SENTRY_DSN) {
  Sentry.init({
    dsn: import.meta.env.VITE_SENTRY_DSN,
    environment: import.meta.env.MODE,
    integrations: [
      Sentry.browserTracingIntegration(),
      // This is a chat app: unmasked replay would ship every prompt, AI answer,
      // uploaded document preview and the admin user list (emails) to Sentry.
      Sentry.replayIntegration({
        maskAllText: true,
        blockAllMedia: true,
      }),
      Sentry.captureConsoleIntegration({ levels: ['error', 'warn'] }),
    ],
    // Performance Monitoring
    tracesSampleRate: import.meta.env.PROD ? 0.1 : 1.0,
    // Session Replay
    replaysSessionSampleRate: 0.1,
    replaysOnErrorSampleRate: 1.0,
  });
  console.log('✅ Sentry initialized for error tracking');
} else {
  console.log('Sentry DSN not configured - error tracking disabled');
}

const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
