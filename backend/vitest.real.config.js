const { defineConfig } = require('vitest/config');

// Real integration tests — uses actual .env, Supabase, and AI providers
// Run with: npx vitest run --config vitest.real.config.js
module.exports = defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['__tests__/integration-real/**/*.test.js'],
    testTimeout: 60000,
    hookTimeout: 60000,
    env: {
      // Load from .env — dotenv is required by server.js but vitest doesn't auto-load it
      // We set a flag so the test setup knows to load dotenv
      VITEST_REAL: 'true',
    },
    setupFiles: ['./__tests__/integration-real/setup.js'],
  },
});
