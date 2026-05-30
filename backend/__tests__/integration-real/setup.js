// Real integration test setup — loads .env for real API keys
require('dotenv').config();

console.log('[Real Tests] .env loaded');
console.log(`[Real Tests] SUPABASE_URL: ${process.env.SUPABASE_URL ? 'set' : 'NOT SET'}`);
console.log(`[Real Tests] GEMINI_API_KEY: ${process.env.GEMINI_API_KEY ? 'set' : 'NOT SET'}`);
