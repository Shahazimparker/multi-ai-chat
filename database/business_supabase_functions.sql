-- ============================================================
-- FILE: database/business_supabase_functions.sql
-- PURPOSE: SQL functions to run in the BUSINESS Supabase DB.
-- Run this entire file in your business Supabase SQL Editor.
-- ============================================================

-- ─────────────────────────────────────────────
-- FUNCTION: execute_biz_query
-- Executes a SQL query and returns results as JSONB array.
-- Security validation is handled on the backend (JS side).
-- ─────────────────────────────────────────────
CREATE OR REPLACE FUNCTION execute_biz_query(query_text TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  result JSONB;
BEGIN
  EXECUTE 'SELECT COALESCE(jsonb_agg(row_to_json(t)), ''[]''::jsonb) FROM (' || query_text || ') t' INTO result;
  RETURN result;
END;
$$;

-- ─────────────────────────────────────────────
-- FUNCTION: get_business_tables
-- Returns all user tables with their column info
-- as a JSONB array.
-- ─────────────────────────────────────────────
CREATE OR REPLACE FUNCTION get_business_tables()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  result JSONB;
BEGIN
  SELECT jsonb_agg(
    jsonb_build_object(
      'table_name', t.table_name,
      'table_type', t.table_type,
      'columns', (
        SELECT jsonb_agg(
          jsonb_build_object(
            'column_name', c.column_name,
            'data_type', c.data_type,
            'is_nullable', c.is_nullable,
            'character_maximum_length', c.character_maximum_length
          ) ORDER BY c.ordinal_position
        )
        FROM information_schema.columns c
        WHERE c.table_schema = 'public'
          AND c.table_name = t.table_name
      )
    )
  ) INTO result
  FROM information_schema.tables t
  WHERE t.table_schema = 'public'
    AND t.table_type IN ('BASE TABLE', 'VIEW')
    AND t.table_name NOT LIKE '\_%'
    AND t.table_name NOT IN ('schema_migrations', 'migrations');

  RETURN COALESCE(result, '[]'::jsonb);
END;
$$;
