// Global test setup — loads .env and sets fallback env vars
// This runs before every test file
// vitest globals (vi) are available because globals: true is set in vitest.config.js

// Explicitly load .env before anything else
require('dotenv').config();

// Set fallback env vars ONLY if real .env values are not present
if (!process.env.SUPABASE_URL) process.env.SUPABASE_URL = 'https://test.supabase.co';
if (!process.env.SUPABASE_SERVICE_KEY) process.env.SUPABASE_SERVICE_KEY = 'test-service-key';
if (!process.env.BIZ_SUPABASE_URL) process.env.BIZ_SUPABASE_URL = 'https://test-biz.supabase.co';
if (!process.env.BIZ_SUPABASE_SERVICE_KEY) process.env.BIZ_SUPABASE_SERVICE_KEY = 'test-biz-service-key';
if (!process.env.JWT_SECRET) process.env.JWT_SECRET = 'test-jwt-secret-minimum-32-chars!!';
if (!process.env.FRONTEND_URL) process.env.FRONTEND_URL = 'http://localhost:3000';
