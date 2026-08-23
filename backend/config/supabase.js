// ============================================================
// FILE: backend/config/supabase.js
// PURPOSE: Initialises Supabase client using service_role key
// CHANGE: Add SUPABASE_URL and SUPABASE_SERVICE_KEY in .env
// NOTE: service_role bypasses RLS — NEVER expose this key to frontend
// ============================================================

const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = process.env.SUPABASE_URL || 'https://placeholder.supabase.co';
const supabaseKey = process.env.SUPABASE_SERVICE_KEY || 'placeholder-key';

const supabase = createClient(
  supabaseUrl,
  supabaseKey,
  {
    auth: { persistSession: false },  // backend is stateless
  }
);

module.exports = supabase;
