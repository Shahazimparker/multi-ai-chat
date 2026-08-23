// ============================================================
// FILE: backend/services/rateLimitStore.service.js
// PURPOSE: express-rate-limit Store backed by Postgres (rate_limit_counters),
//          so limits are shared across Vercel's per-instance memory instead
//          of resetting on every cold start. See migration_add_rate_limiting.sql
//          for the schema and the atomic increment RPC this wraps.
// ============================================================

const supabase = require('../config/supabase');

// Every limiter in the app shares ONE table, and rate_limit_counters.key is the
// primary key — so the key a limiter writes must identify the limiter as well as
// the client. express-rate-limit's default keyGenerator returns a bare req.ip,
// and the custom ones here return a bare user id, so without a per-limiter
// prefix the login limiter (10 / 15min) and the chat limiter (30 / min) would
// read and write the *same row* for the same IP: 10 chat messages would burn the
// whole login budget and lock the user out of signing in. Hence the prefix is a
// required constructor argument rather than an optional nicety — a call site
// that forgets it fails loudly at boot instead of silently merging two budgets.
//
// It is also assigned to `this.prefix`, which express-rate-limit reads in its
// singleCount validator: two limiters running on one request (knowledge's base
// + heavy limiters, both keyed by user id) would otherwise look like a
// double-count of the same key and log a spurious ERR_ERL_DOUBLE_COUNT.
class SupabaseRateLimitStore {
  constructor(prefix) {
    if (typeof prefix !== 'string' || prefix.length === 0) {
      throw new Error(
        'createRateLimitStore(prefix) requires a non-empty prefix unique to the limiter — '
        + 'rate_limit_counters is shared by every limiter and an unprefixed key collides.'
      );
    }
    this.prefix = `${prefix}:`;
    // Overwritten by init() before any request is served; kept only so
    // increment() has a sane value if a future refactor ever skips init().
    this.windowMs = 60 * 1000;
    // DB-backed: a key incremented on one serverless instance is visible to
    // every other instance, which is the whole point of this store existing.
    this.localKeys = false;
  }

  init(options) {
    this.windowMs = options.windowMs;
  }

  async increment(key) {
    const namespaced = `${this.prefix}${key}`;
    try {
      const { data, error } = await supabase.rpc('rate_limit_increment', {
        p_key: namespaced,
        p_window_ms: this.windowMs,
      });
      if (error) throw error;
      const row = Array.isArray(data) ? data[0] : data;
      if (!row) throw new Error('rate_limit_increment returned no row');
      return { totalHits: row.hit_count, resetTime: new Date(row.expires_at) };
    } catch (err) {
      // FAIL OPEN, deliberately the opposite of this codebase's approval gate.
      // The approval gate protects against an unapproved action executing, so
      // an outage there must block; rate limiting protects against abuse, so
      // an outage here should NOT turn into every real user being locked out
      // (or, worse, every request 500ing) just because Supabase hiccupped.
      // Still console.error loudly — a store that silently "succeeds" during
      // a real outage would hide it.
      console.error('[RateLimitStore] increment failed, failing open:', err.message);
      return { totalHits: 1, resetTime: new Date(Date.now() + this.windowMs) };
    }
  }

  async decrement(key) {
    try {
      const { error } = await supabase.rpc('rate_limit_decrement', { p_key: `${this.prefix}${key}` });
      if (error) throw error;
    } catch (err) {
      // Best-effort by design (see the RPC's own comment) — a lost decrement
      // only makes the window very slightly stricter, never incorrect in the
      // dangerous direction, so this doesn't need the fail-open ceremony above.
      console.error('[RateLimitStore] decrement failed:', err.message);
    }
  }

  async resetKey(key) {
    try {
      const { error } = await supabase
        .from('rate_limit_counters')
        .delete()
        .eq('key', `${this.prefix}${key}`);
      if (error) throw error;
    } catch (err) {
      console.error('[RateLimitStore] resetKey failed:', err.message);
    }
  }
}

// Factory rather than a shared export. Two reasons, both real:
//   1. init(options) captures that limiter's windowMs on the instance, so one
//      shared store would silently apply whichever limiter initialised last.
//   2. express-rate-limit's `unsharedStore` validator flags a Store instance
//      reused across limiters as ERR_ERL_STORE_REUSE. (It is logged via
//      console.error by the validation wrapper rather than thrown to the
//      caller, so it would not crash — it would just be noise hiding a real
//      misconfiguration. Reason 1 is the one that actually corrupts behaviour.)
// `prefix` must be unique per limiter — see the class comment.
const createRateLimitStore = (prefix) => new SupabaseRateLimitStore(prefix);

module.exports = { createRateLimitStore };
