import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Replaces react-scripts (Create React App), which has been unmaintained since
// 2023 and was the source of every frontend audit finding.
export default defineConfig({
  plugins: [react()],

  server: {
    // Playwright configs and the backend CORS allowlist both assume :3000.
    port: 3000,
    strictPort: true,
    // Mirrors the old CRA `proxy` field so relative /api calls work in dev.
    proxy: {
      '/api': {
        target: 'http://localhost:5000',
        changeOrigin: true,
      },
    },
  },

  // CRA emitted to build/. Kept so frontend/vercel.json and .gitignore still apply.
  build: {
    outDir: 'build',
    sourcemap: true,
  },

  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./src/setupTests.js'],
    include: ['src/**/*.{test,spec}.{js,jsx}'],
    css: false,
  },
});
