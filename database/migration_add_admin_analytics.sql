-- ============================================================
-- FILE: database/migration_add_admin_analytics.sql
-- PURPOSE: Move admin analytics aggregation into PostgreSQL.
--
--   getAnalytics() previously ran four unbounded `select()` queries against
--   query_analytics / query_cache and aggregated in JavaScript. PostgREST
--   caps a single response at 1000 rows (and the Supabase JS client does not
--   page automatically), so every count, sum and the model/daily breakdown
--   silently stopped at row 1000. A single SQL aggregate returns the exact
--   totals regardless of volume.
--
-- PREREQUISITES: schema.sql (query_analytics, query_cache).
-- IDEMPOTENT: safe to re-run (CREATE OR REPLACE).
-- ============================================================

CREATE OR REPLACE FUNCTION get_admin_analytics()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_model_counts JSONB;
  v_daily_usage  JSONB;
  v_top_queries  JSONB;
  v_summary      JSONB;
BEGIN
  -- Model counts (was: JS aggregation over a 1000-capped select).
  SELECT COALESCE(jsonb_object_agg(model, cnt), '{}'::jsonb)
    INTO v_model_counts
    FROM (
      SELECT model, COUNT(*) AS cnt
      FROM query_analytics
      WHERE model IS NOT NULL
      GROUP BY model
    ) m;

  -- Daily usage for the last 7 days (was: raw rows truncated at 1000, grouped
  -- client-side). `day` is the UTC date so it matches the old ISO-string slice.
  SELECT COALESCE(jsonb_agg(d ORDER BY d.day), '[]'::jsonb)
    INTO v_daily_usage
    FROM (
      SELECT (created_at AT TIME ZONE 'UTC')::date::text AS day,
             COUNT(*)                                   AS queries,
             COALESCE(SUM(tokens_used), 0)              AS tokens,
             COUNT(*) FILTER (WHERE is_anonymous)       AS anonymous
      FROM query_analytics
      WHERE created_at >= now() - interval '7 days'
      GROUP BY 1
    ) d;

  -- Top cached queries (same 20-row cap, but no longer mixed with the
  -- unbounded reads above).
  SELECT COALESCE(jsonb_agg(q ORDER BY q.hit_count DESC), '[]'::jsonb)
    INTO v_top_queries
    FROM (
      SELECT id, query_text, hit_count, model, last_hit_at
      FROM query_cache
      ORDER BY hit_count DESC
      LIMIT 20
    ) q;

  -- Summary totals (was: COUNT/SUM over a 1000-capped select).
  SELECT jsonb_build_object(
           'totalQueries', c.total_queries,
           'totalTokens',  c.total_tokens,
           'cacheHits',    c.cache_hits,
           'cacheHitRate', CASE WHEN c.total_queries > 0
                                THEN ROUND((c.cache_hits::numeric / c.total_queries) * 100, 1)
                                ELSE 0
                           END
         )
    INTO v_summary
    FROM (
      SELECT COUNT(*)                              AS total_queries,
             COALESCE(SUM(tokens_used), 0)         AS total_tokens,
             COUNT(*) FILTER (WHERE cache_hit)     AS cache_hits
      FROM query_analytics
    ) c;

  RETURN jsonb_build_object(
    'modelCounts', v_model_counts,
    'topQueries',  v_top_queries,
    'dailyUsage',  v_daily_usage,
    'summary',     v_summary
  );
END;
$$;

-- Admin-only data. Default PUBLIC execute would expose aggregate analytics to
-- the anon/authenticated PostgREST roles; lock it down to service_role (what
-- the backend uses), matching delete_user_cascade.
REVOKE EXECUTE ON FUNCTION get_admin_analytics() FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION get_admin_analytics() TO service_role;

-- ─────────────────────────────────────────────
-- VERIFY (run separately)
-- ─────────────────────────────────────────────
-- SELECT get_admin_analytics();
