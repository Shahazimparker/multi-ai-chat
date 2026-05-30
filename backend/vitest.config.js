const { defineConfig } = require('vitest/config');

module.exports = defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['__tests__/**/*.test.js'],
    exclude: ['__tests__/integration-real/**'],
    setupFiles: ['./__tests__/setup.js'],
    coverage: {
      provider: 'v8',
      include: [
        'services/chatPipeline.service.js',
        'services/tokenAccounting.service.js',
        'services/chatCleanup.service.js',
        'services/compress.service.js',
        'services/similarity.service.js',
        'services/toolProcessor.service.js',
        'services/toolLoop.service.js',
        'services/orchestratorBrain.service.js',
        'services/humanApproval.service.js',
        'services/tokenBudget.service.js',
        'middleware/sanitize.js',
        'middleware/tokenCheck.js',
        'config/chatRuntime.config.js',
      ],
      thresholds: {
        lines: 70,
        functions: 70,
        branches: 60,
        statements: 70,
      },
    },
  },
});
