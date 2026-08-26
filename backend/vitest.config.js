const { defineConfig } = require('vitest/config');

module.exports = defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['__tests__/**/*.test.js'],
    exclude: ['__tests__/integration-real/**'],
    setupFiles: ['./__tests__/setup.js'],
    // Vitest's 5s default is too low here: tests that call vi.resetModules()
    // re-import the AI SDK graph (openai + groq + anthropic + google), which
    // alone costs ~1.6s cold in plain node and considerably more under
    // vitest's transform. Document generation (pptx, pdf, xlsx) is also slow.
    testTimeout: 30000,
    hookTimeout: 30000,
    fileParallelism: false,
    coverage: {
      provider: 'v8',
      include: [
        'services/chatPipeline.service.js',
        'services/tokenAccounting.service.js',
        'services/chatCleanup.service.js',
        'services/compress.service.js',
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
