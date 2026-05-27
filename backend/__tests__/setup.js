// Global test setup — sets env vars and mocks external services
// This runs before every test file
// vitest globals (vi) are available because globals: true is set in vitest.config.js

// Set required env vars BEFORE any module loads supabase
process.env.SUPABASE_URL = 'https://test.supabase.co';
process.env.SUPABASE_SERVICE_KEY = 'test-service-key';
process.env.BIZ_SUPABASE_URL = 'https://test-biz.supabase.co';
process.env.BIZ_SUPABASE_SERVICE_KEY = 'test-biz-service-key';
process.env.JWT_SECRET = 'test-jwt-secret-minimum-32-chars!!';
process.env.FRONTEND_URL = 'http://localhost:3000';
