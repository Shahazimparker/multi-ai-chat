// vitest globals: describe, it, expect, vi, beforeEach, afterEach

const supabase = require('../../config/supabase');
const { createRateLimitStore } = require('../../services/rateLimitStore.service');

describe('rateLimitStore.service', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('createRateLimitStore hands out a fresh instance every call', () => {
    // Each limiter needs its own instance: init() captures that limiter's
    // windowMs on the instance, and express-rate-limit's unsharedStore
    // validator flags a reused Store as ERR_ERL_STORE_REUSE.
    const a = createRateLimitStore('login');
    const b = createRateLimitStore('chat');
    expect(a).not.toBe(b);
  });

  describe('key namespacing', () => {
    // rate_limit_counters.key is a primary key shared by every limiter in the
    // app. The default keyGenerator returns a bare req.ip and the custom ones a
    // bare user id, so without a per-limiter prefix the login limiter
    // (10 / 15min) and the chat limiter (30 / min) would collide on one row and
    // ordinary chat traffic would lock users out of signing in.
    it('rejects construction without a prefix instead of silently colliding', () => {
      expect(() => createRateLimitStore()).toThrow(/prefix/i);
      expect(() => createRateLimitStore('')).toThrow(/prefix/i);
    });

    it('two limiters with the same client key write to different DB rows', async () => {
      const keys = [];
      vi.spyOn(supabase, 'rpc').mockImplementation(async (_fn, args) => {
        keys.push(args.p_key);
        return { data: [{ hit_count: 1, expires_at: new Date().toISOString() }], error: null };
      });

      const login = createRateLimitStore('login');
      const chat = createRateLimitStore('chat');
      login.init({ windowMs: 900_000 });
      chat.init({ windowMs: 60_000 });

      await login.increment('203.0.113.7');
      await chat.increment('203.0.113.7');

      expect(keys).toEqual(['login:203.0.113.7', 'chat:203.0.113.7']);
    });

    it('namespaces decrement and resetKey the same way as increment', async () => {
      vi.spyOn(supabase, 'rpc').mockResolvedValue({ error: null });
      const eq = vi.fn().mockResolvedValue({ error: null });
      vi.spyOn(supabase, 'from').mockReturnValue({ delete: () => ({ eq }) });

      const store = createRateLimitStore('upload-heavy');
      await store.decrement('user-1');
      await store.resetKey('user-1');

      expect(supabase.rpc).toHaveBeenCalledWith('rate_limit_decrement', { p_key: 'upload-heavy:user-1' });
      expect(eq).toHaveBeenCalledWith('key', 'upload-heavy:user-1');
    });

    it('exposes the prefix so express-rate-limit dedupes its singleCount check', () => {
      // Two limiters run on one /api/knowledge/search request and both key by
      // req.user.id; express-rate-limit's singleCount validator distinguishes
      // them by `store.prefix`, otherwise it logs a spurious ERR_ERL_DOUBLE_COUNT.
      expect(createRateLimitStore('knowledge-base').prefix).toBe('knowledge-base:');
      expect(createRateLimitStore('knowledge-heavy').prefix).toBe('knowledge-heavy:');
    });
  });

  describe('increment', () => {
    it('returns the shape express-rate-limit expects on the happy path', async () => {
      const expiresAt = new Date(Date.now() + 60_000).toISOString();
      vi.spyOn(supabase, 'rpc').mockResolvedValue({
        data: [{ hit_count: 3, expires_at: expiresAt }],
        error: null,
      });

      const store = createRateLimitStore('chat');
      store.init({ windowMs: 60_000 });
      const result = await store.increment('1.2.3.4');

      expect(supabase.rpc).toHaveBeenCalledWith('rate_limit_increment', {
        p_key: 'chat:1.2.3.4',
        p_window_ms: 60_000,
      });
      expect(result.totalHits).toBe(3);
      expect(result.resetTime).toBeInstanceOf(Date);
      expect(result.resetTime.toISOString()).toBe(expiresAt);
    });

    it('uses the windowMs captured at init(), not a default, once set', async () => {
      vi.spyOn(supabase, 'rpc').mockResolvedValue({
        data: [{ hit_count: 1, expires_at: new Date().toISOString() }],
        error: null,
      });
      const store = createRateLimitStore('login');
      store.init({ windowMs: 15 * 60 * 1000 });
      await store.increment('5.6.7.8');
      expect(supabase.rpc).toHaveBeenCalledWith(
        'rate_limit_increment',
        expect.objectContaining({ p_window_ms: 15 * 60 * 1000 })
      );
    });

    it('keeps windowMs per-instance so limiters do not inherit another window', async () => {
      const windows = [];
      vi.spyOn(supabase, 'rpc').mockImplementation(async (_fn, args) => {
        windows.push(args.p_window_ms);
        return { data: [{ hit_count: 1, expires_at: new Date().toISOString() }], error: null };
      });
      const fast = createRateLimitStore('chat');
      const slow = createRateLimitStore('login');
      fast.init({ windowMs: 60_000 });
      slow.init({ windowMs: 900_000 });

      await fast.increment('a');
      await slow.increment('a');
      await fast.increment('a');

      expect(windows).toEqual([60_000, 900_000, 60_000]);
    });

    it('fails open with a usable shape when the RPC errors', async () => {
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      vi.spyOn(supabase, 'rpc').mockResolvedValue({ data: null, error: new Error('db down') });

      const store = createRateLimitStore('chat');
      store.init({ windowMs: 30_000 });
      const result = await store.increment('9.9.9.9');

      expect(result.totalHits).toBe(1);
      expect(result.resetTime).toBeInstanceOf(Date);
      expect(Number.isNaN(result.resetTime.getTime())).toBe(false);
      expect(result.resetTime.getTime()).toBeGreaterThan(Date.now());
      expect(consoleSpy).toHaveBeenCalled();
    });

    it('fail-open resetTime honours this instance windowMs', async () => {
      vi.spyOn(console, 'error').mockImplementation(() => {});
      vi.spyOn(supabase, 'rpc').mockRejectedValue(new Error('down'));
      const store = createRateLimitStore('login');
      store.init({ windowMs: 900_000 });
      const { resetTime } = await store.increment('1.1.1.1');
      const delta = resetTime.getTime() - Date.now();
      expect(delta).toBeGreaterThan(890_000);
      expect(delta).toBeLessThanOrEqual(900_000);
    });

    it('fails open with a usable shape when the RPC call throws', async () => {
      vi.spyOn(console, 'error').mockImplementation(() => {});
      vi.spyOn(supabase, 'rpc').mockRejectedValue(new Error('network error'));

      const store = createRateLimitStore('chat');
      store.init({ windowMs: 30_000 });
      await expect(store.increment('1.1.1.1')).resolves.toEqual(
        expect.objectContaining({ totalHits: 1 })
      );
    });
  });

  describe('decrement', () => {
    it('calls the decrement RPC with the namespaced key', async () => {
      vi.spyOn(supabase, 'rpc').mockResolvedValue({ error: null });
      const store = createRateLimitStore('chat');
      await store.decrement('1.2.3.4');
      expect(supabase.rpc).toHaveBeenCalledWith('rate_limit_decrement', { p_key: 'chat:1.2.3.4' });
    });

    it('swallows RPC errors without throwing', async () => {
      vi.spyOn(console, 'error').mockImplementation(() => {});
      vi.spyOn(supabase, 'rpc').mockRejectedValue(new Error('db down'));
      const store = createRateLimitStore('chat');
      await expect(store.decrement('1.2.3.4')).resolves.toBeUndefined();
    });
  });

  describe('resetKey', () => {
    it('deletes the row for the namespaced key', async () => {
      const eq = vi.fn().mockResolvedValue({ error: null });
      vi.spyOn(supabase, 'from').mockReturnValue({ delete: () => ({ eq }) });

      const store = createRateLimitStore('chat');
      await store.resetKey('1.2.3.4');

      expect(supabase.from).toHaveBeenCalledWith('rate_limit_counters');
      expect(eq).toHaveBeenCalledWith('key', 'chat:1.2.3.4');
    });

    it('swallows delete errors without throwing', async () => {
      vi.spyOn(console, 'error').mockImplementation(() => {});
      const eq = vi.fn().mockResolvedValue({ error: new Error('db down') });
      vi.spyOn(supabase, 'from').mockReturnValue({ delete: () => ({ eq }) });

      const store = createRateLimitStore('chat');
      await expect(store.resetKey('1.2.3.4')).resolves.toBeUndefined();
    });
  });
});
