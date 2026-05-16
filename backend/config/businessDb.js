// ============================================================
// FILE: backend/config/businessDb.js
// PURPOSE: Initialises Supabase client for the BUSINESS database
// CHANGE: Add BIZ_SUPABASE_URL and BIZ_SUPABASE_SERVICE_KEY in .env
// NOTE: This is a SEPARATE Supabase instance for ERP/business data
// ============================================================

const { createClient } = require('@supabase/supabase-js');

const bizSupabase = createClient(
  process.env.BIZ_SUPABASE_URL,
  process.env.BIZ_SUPABASE_SERVICE_KEY,
  {
    auth: { persistSession: false },
  }
);

module.exports = bizSupabase;
