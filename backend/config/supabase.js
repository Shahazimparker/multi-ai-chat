// ============================================================
// FILE: backend/config/supabase.js
// PURPOSE: Initialises Supabase client using service_role key
// CHANGE: Add SUPABASE_URL and SUPABASE_SERVICE_KEY in .env
// NOTE: service_role bypasses RLS — NEVER expose this key to frontend
// ============================================================

const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY,   // service_role key (not anon key)
  {
    auth: { persistSession: false },  // backend is stateless
  }
);

module.exports = supabase;
