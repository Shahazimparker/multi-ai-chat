-- ============================================================
-- FILE: database/migration_add_prompt_cache_analytics.sql
-- PURPOSE: Persist provider prompt-cache volume, and stop conflating it with
--          response-cache hits.
--
--   Two different caches were sharing one boolean column:
--
--     query_analytics.cache_hit   the reply came from our own exact/semantic
--                                 response cache — no model call at all.
--     (new) prompt_cache_*_tokens the PROVIDER served part of our prompt from
--                                 its KV cache while still generating a fresh
--                                 answer. A cost metric, not a cached reply.
--
--   Until now nothing read the providers' prompt-cache fields, so cache_hit was
--   fed `cacheReadTokens > 0` and sat near zero. With the adapters reporting
--   correctly, that definition would have marked nearly every DeepSeek reply as
--   "cached" and pinned the admin hit-rate tile near 100%. cache_hit is now fed
--   only by real response-cache hits, and prompt-cache volume gets its own
--   columns — which is also what makes the saving auditable over time rather
--   than a line in the server log.
--
--   Worth measuring: a DeepSeek cache read bills at $0.014/M against $0.14/M
--   uncached, so prompt_cache_read_tokens is directly a cost line.
--
--   Also fixes `dailyUsage`, which the RPC returned as a jsonb object while
--   AdminPage.jsx has always mapped over it as an array — the Analytics tab
--   crashed outright with "(analytics.dailyUsage || []).map is not a function".
--
-- PREREQUISITES: schema.sql, migration_add_admin_analytics.sql.
-- IDEMPOTENT: safe to re-run (IF NOT EXISTS / CREATE OR REPLACE).
-- ORDER: apply BEFORE deploying the matching backend, though the backend
--        degrades to the legacy insert shape if this has not been run yet.
-- ============================================================

-- ─────────────────────────────────────────────
-- 1. Columns
-- ─────────────────────────────────────────────
ALTER TABLE query_analytics
  ADD COLUMN IF NOT EXISTS prompt_cache_read_tokens  BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS prompt_cache_write_tokens BIGINT NOT NULL DEFAULT 0;

COMMENT ON COLUMN query_analytics.cache_hit IS
  'Reply served from our own exact/semantic response cache (no model call). NOT provider prompt caching.';
COMMENT ON COLUMN query_analytics.prompt_cache_read_tokens IS
  'Prompt tokens the provider served from its KV cache. Billed at a large discount; the answer was still generated fresh.';
COMMENT ON COLUMN query_analytics.prompt_cache_write_tokens IS
  'Prompt tokens written to the provider cache. Anthropic bills these at 1.25x; providers with automatic caching report 0.';

-- Dashboard reads are time-bounded ("last 30 days"), and this keeps the new
-- aggregate from forcing a sequential scan as the table grows.
CREATE INDEX IF NOT EXISTS idx_query_analytics_created_at
  ON query_analytics (created_at DESC);

-- ─────────────────────────────────────────────
-- 2. Extend the analytics aggregate
-- ─────────────────────────────────────────────
-- Adds promptCache* to `summary`. Existing keys are unchanged, so an older
-- frontend keeps working against a newer database.
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
  SELECT COALESCE(jsonb_object_agg(model, cnt), '{}'::jsonb)
    INTO v_model_counts
    FROM (
      SELECT model, COUNT(*) AS cnt
      FROM query_analytics
      WHERE model IS NOT NULL
      GROUP BY model
    ) m;

  -- Returned as an ARRAY of {day, queries, tokens}, which is what AdminPage.jsx
  -- has always consumed:
  --   (analytics.dailyUsage || []).map(r => ({ day: r.day, queries: r.queries, tokens: r.tokens }))
  -- The previous jsonb_object_agg produced {"2026-08-27": 5} instead, so .map
  -- was undefined and the whole Analytics tab crashed with
  -- "(analytics.dailyUsage || []).map is not a function". It also never supplied
  -- the token sums the chart plots. Ordered ascending so the chart reads
  -- left-to-right in time.
  SELECT COALESCE(
           jsonb_agg(
             jsonb_build_object('day', d.day, 'queries', d.cnt, 'tokens', d.toks)
             ORDER BY d.day
           ),
           '[]'::jsonb
         )
    INTO v_daily_usage
    FROM (
      SELECT to_char(created_at, 'YYYY-MM-DD')  AS day,
             COUNT(*)                           AS cnt,
             COALESCE(SUM(tokens_used), 0)      AS toks
      FROM query_analytics
      GROUP BY 1
      ORDER BY 1 DESC
      LIMIT 30
    ) d;

  SELECT COALESCE(jsonb_agg(jsonb_build_object('query', query_text, 'count', cnt)), '[]'::jsonb)
    INTO v_top_queries
    FROM (
      SELECT query_text, COUNT(*) AS cnt
      FROM query_analytics
      WHERE query_text IS NOT NULL AND query_text <> ''
      GROUP BY query_text
      ORDER BY cnt DESC
      LIMIT 10
    ) q;

  SELECT jsonb_build_object(
           'totalQueries', c.total_queries,
           'totalTokens',  c.total_tokens,
           'cacheHits',    c.cache_hits,
           'cacheHitRate', CASE WHEN c.total_queries > 0
                                THEN ROUND((c.cache_hits::numeric / c.total_queries) * 100, 1)
                                ELSE 0
                           END,
           -- Provider prompt cache, reported separately from response-cache hits.
           'promptCacheReadTokens',  c.prompt_cache_read,
           'promptCacheWriteTokens', c.prompt_cache_write,
           -- Share of REQUESTS that got a prompt-cache hit.
           --
           -- Deliberately not read/(read+write): only Anthropic reports cache
           -- writes at all, so for DeepSeek, Mistral, OpenAI, Groq and Gemini
           -- that denominator collapses to the reads and the tile reads a
           -- meaningless flat 100%. Observed exactly that on a database with 3
           -- hits across 112 queries.
           --
           -- Cached tokens as a share of PROMPT tokens would be the better
           -- metric, but query_analytics stores only the combined tokens_used
           -- (prompt + completion + embeddings), so it is not derivable without
           -- a further column. Requests-with-a-hit is honest with what is here.
           'promptCacheHitRate', CASE WHEN c.total_queries > 0
                                THEN ROUND((c.prompt_cache_hits::numeric / c.total_queries) * 100, 1)
                                ELSE 0
                           END
         )
    INTO v_summary
    FROM (
      SELECT COUNT(*)                                            AS total_queries,
             COALESCE(SUM(tokens_used), 0)                       AS total_tokens,
             COUNT(*) FILTER (WHERE cache_hit)                   AS cache_hits,
             COALESCE(SUM(prompt_cache_read_tokens), 0)          AS prompt_cache_read,
             COALESCE(SUM(prompt_cache_write_tokens), 0)         AS prompt_cache_write,
             COUNT(*) FILTER (WHERE prompt_cache_read_tokens > 0) AS prompt_cache_hits
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

REVOKE EXECUTE ON FUNCTION get_admin_analytics() FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION get_admin_analytics() TO service_role;

-- ─────────────────────────────────────────────
-- VERIFY (run separately)
-- ─────────────────────────────────────────────
-- SELECT get_admin_analytics() -> 'summary';
--
-- Expect keys: totalQueries, totalTokens, cacheHits, cacheHitRate,
--              promptCacheReadTokens, promptCacheWriteTokens, promptCacheHitRate
--
-- Rows written before this migration report 0 prompt-cache tokens, so
-- promptCacheHitRate climbs from 0 as new traffic lands rather than being
-- retroactively correct.
