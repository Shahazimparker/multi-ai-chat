// vitest globals: describe, it, expect, vi, beforeAll, afterEach

const bcrypt = require('bcryptjs');
const supabase = require('../../config/supabase');
const {
  login,
  checkAccountLock,
  recordFailedAttempt,
  clearFailedAttempts,
} = require('../../controllers/auth.controller');

const makeRes = () => {
  const res = {};
  res.status = vi.fn().mockReturnValue(res);
  res.json = vi.fn().mockReturnValue(res);
  return res;
};

// login_attempt_counters chain: .select('locked_until').eq('identifier', key).maybeSingle()
const lockCounterChain = (row) => ({
  select: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: row, error: null }) }) }),
});

// users chain used by login(): .select('*').or(...).single()
const userLookupChain = (user) => ({
  select: () => ({ or: () => ({ single: () => Promise.resolve({ data: user, error: user ? null : new Error('not found') }) }) }),
});

describe('checkAccountLock', () => {
  afterEach(() => vi.restoreAllMocks());

  it('returns minutes remaining when login_attempt_counters has a future lock', async () => {
    const future = new Date(Date.now() + 5 * 60 * 1000).toISOString();
    vi.spyOn(supabase, 'from').mockReturnValue(lockCounterChain({ locked_until: future }));

    const mins = await checkAccountLock('victim@example.com');
    expect(mins).toBeGreaterThan(0);
    expect(mins).toBeLessThanOrEqual(5);
  });

  it('returns null when there is no row or the lock has expired', async () => {
    vi.spyOn(supabase, 'from').mockReturnValue(lockCounterChain(null));
    expect(await checkAccountLock('nobody')).toBeNull();

    const past = new Date(Date.now() - 1000).toISOString();
    vi.spyOn(supabase, 'from').mockReturnValue(lockCounterChain({ locked_until: past }));
    expect(await checkAccountLock('nobody')).toBeNull();
  });

  it('fails open (returns null, does not throw) when the DB read errors', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(supabase, 'from').mockImplementation(() => {
      throw new Error('db unreachable');
    });
    await expect(checkAccountLock('nobody')).resolves.toBeNull();
  });
});

describe('recordFailedAttempt', () => {
  afterEach(() => vi.restoreAllMocks());

  it('persists locked_until onto users only for a resolved user id', async () => {
    const lockedUntil = new Date(Date.now() + 15 * 60 * 1000).toISOString();
    vi.spyOn(supabase, 'rpc').mockResolvedValue({ data: [{ fail_count: 5, locked_until: lockedUntil }], error: null });
    const updateEq = vi.fn().mockResolvedValue({ error: null });
    const updateSpy = vi.fn().mockReturnValue({ eq: updateEq });
    vi.spyOn(supabase, 'from').mockReturnValue({ update: updateSpy });

    await recordFailedAttempt('user@example.com', 'user-123');

    expect(supabase.rpc).toHaveBeenCalledWith('record_login_failure', {
      p_identifier: 'user@example.com',
      p_window_ms: expect.any(Number),
      p_max_fails: expect.any(Number),
      p_lock_ms: expect.any(Number),
    });
    expect(updateSpy).toHaveBeenCalledWith({ locked_until: lockedUntil });
    expect(updateEq).toHaveBeenCalledWith('id', 'user-123');
  });

  it('never touches the users table when no user id resolved, even if the identifier is now locked', async () => {
    const lockedUntil = new Date(Date.now() + 15 * 60 * 1000).toISOString();
    vi.spyOn(supabase, 'rpc').mockResolvedValue({ data: [{ fail_count: 5, locked_until: lockedUntil }], error: null });
    const fromSpy = vi.spyOn(supabase, 'from');

    await recordFailedAttempt('nonexistent-user', null);

    expect(fromSpy).not.toHaveBeenCalled();
  });

  it('fails open silently when the RPC throws', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(supabase, 'rpc').mockRejectedValue(new Error('rpc unreachable'));
    const fromSpy = vi.spyOn(supabase, 'from');

    await expect(recordFailedAttempt('x', 'user-1')).resolves.toBeUndefined();
    expect(fromSpy).not.toHaveBeenCalled();
  });
});

describe('clearFailedAttempts', () => {
  afterEach(() => vi.restoreAllMocks());

  it('deletes the login_attempt_counters row and clears users.locked_until for a resolved user', async () => {
    const deleteEq = vi.fn().mockResolvedValue({ error: null });
    const updateEq = vi.fn().mockResolvedValue({ error: null });
    vi.spyOn(supabase, 'from').mockImplementation((table) => {
      if (table === 'login_attempt_counters') return { delete: () => ({ eq: deleteEq }) };
      return { update: () => ({ eq: updateEq }) };
    });

    await clearFailedAttempts('User@Example.com', 'user-123');

    expect(deleteEq).toHaveBeenCalledWith('identifier', 'user@example.com');
    expect(updateEq).toHaveBeenCalledWith('id', 'user-123');
  });

  it('only clears the counter row when no user id is supplied', async () => {
    const deleteEq = vi.fn().mockResolvedValue({ error: null });
    const fromSpy = vi.spyOn(supabase, 'from').mockReturnValue({ delete: () => ({ eq: deleteEq }) });

    await clearFailedAttempts('nobody', null);

    expect(deleteEq).toHaveBeenCalledWith('identifier', 'nobody');
    expect(fromSpy).toHaveBeenCalledTimes(1); // only login_attempt_counters, never users
  });
});

describe('admin unlockLogin — keeps users.locked_until and login_attempt_counters in sync', () => {
  afterEach(() => vi.restoreAllMocks());

  it('clears the counter rows for BOTH the username and the email', async () => {
    // login accepts either identifier, and login_attempt_counters is keyed by
    // what was typed — so a lockout driven by attempts against the email lives
    // in a different row than one driven by the username. Clearing only one
    // leaves the other row's future locked_until behind: the admin UI reports
    // the account unlocked while checkAccountLock still 429s the next sign-in.
    const { unlockLogin } = require('../../controllers/admin.controller');
    const deletedIdentifiers = [];
    vi.spyOn(supabase, 'from').mockImplementation((table) => {
      if (table === 'login_attempt_counters') {
        return {
          delete: () => ({
            eq: async (_col, value) => { deletedIdentifiers.push(value); return { error: null }; },
          }),
        };
      }
      return {
        update: () => ({
          eq: () => ({
            select: () => ({
              single: async () => ({ data: { username: 'alice', email: 'Alice@Example.com' }, error: null }),
            }),
          }),
        }),
      };
    });
    const res = makeRes();

    await unlockLogin({ params: { id: 'user-1' } }, res);

    expect(deletedIdentifiers).toEqual(['alice', 'alice@example.com']);
  });

  it('does not double-clear when username and email are the same string', async () => {
    const { unlockLogin } = require('../../controllers/admin.controller');
    const deletedIdentifiers = [];
    vi.spyOn(supabase, 'from').mockImplementation((table) => {
      if (table === 'login_attempt_counters') {
        return {
          delete: () => ({
            eq: async (_col, value) => { deletedIdentifiers.push(value); return { error: null }; },
          }),
        };
      }
      return {
        update: () => ({
          eq: () => ({
            select: () => ({
              single: async () => ({ data: { username: 'bob@example.com', email: 'bob@example.com' }, error: null }),
            }),
          }),
        }),
      };
    });

    await unlockLogin({ params: { id: 'user-2' } }, makeRes());

    expect(deletedIdentifiers).toEqual(['bob@example.com']);
  });
});

describe('login — lockout integration', () => {
  let hashedPassword;

  beforeAll(async () => {
    hashedPassword = await bcrypt.hash('CorrectHorseBatteryStaple1!', 4);
  });

  afterEach(() => vi.restoreAllMocks());

  it('rejects a pattern-like identifier before ever touching the DB', async () => {
    // isSafeIdentifier must reject this — `,` is a PostgREST OR-separator, so if
    // it ever reached recordFailedAttempt/checkAccountLock it could be used to
    // target multiple identifiers in one call.
    const fromSpy = vi.spyOn(supabase, 'from');
    const rpcSpy = vi.spyOn(supabase, 'rpc');
    const res = makeRes();

    await login({ body: { username: 'victim1,victim2', password: 'whatever' } }, res);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(fromSpy).not.toHaveBeenCalled();
    expect(rpcSpy).not.toHaveBeenCalled();
  });

  it('blocks a locked identifier before ever querying the users table (locked before password check)', async () => {
    const future = new Date(Date.now() + 5 * 60 * 1000).toISOString();
    const compareSpy = vi.spyOn(bcrypt, 'compare');
    vi.spyOn(supabase, 'from').mockImplementation((table) => {
      if (table === 'login_attempt_counters') return lockCounterChain({ locked_until: future });
      throw new Error('users table must not be queried while the identifier is locked');
    });
    const res = makeRes();

    await login({ body: { username: 'victim@example.com', password: 'whatever' } }, res);

    expect(res.status).toHaveBeenCalledWith(429);
    expect(compareSpy).not.toHaveBeenCalled();
  });

  it('proceeds past the lock check for an unlocked identifier and records a failure on bad password', async () => {
    vi.spyOn(supabase, 'from').mockImplementation((table) => {
      if (table === 'login_attempt_counters') return lockCounterChain(null);
      return userLookupChain({
        id: 'user-1',
        username: 'alice',
        email: 'alice@example.com',
        password_hash: hashedPassword,
        is_active: true,
        locked_until: null,
      });
    });
    vi.spyOn(supabase, 'rpc').mockResolvedValue({ data: [{ fail_count: 1, locked_until: null }], error: null });
    const res = makeRes();

    await login({ body: { username: 'alice', password: 'wrong-password' } }, res);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(supabase.rpc).toHaveBeenCalledWith('record_login_failure', expect.objectContaining({ p_identifier: 'alice' }));
  });

  it('locks the account in the DB once MAX_FAILS is crossed, and checkAccountLock reflects it on the next call', async () => {
    const lockedUntil = new Date(Date.now() + 15 * 60 * 1000).toISOString();
    const usersUpdateEq = vi.fn().mockResolvedValue({ error: null });
    vi.spyOn(supabase, 'from').mockImplementation((table) => {
      if (table === 'login_attempt_counters') return lockCounterChain(null);
      return {
        ...userLookupChain({
          id: 'user-2',
          username: 'bob',
          email: 'bob@example.com',
          password_hash: hashedPassword,
          is_active: true,
          locked_until: null,
        }),
        update: () => ({ eq: usersUpdateEq }),
      };
    });
    vi.spyOn(supabase, 'rpc').mockResolvedValue({ data: [{ fail_count: 5, locked_until: lockedUntil }], error: null });
    const res = makeRes();

    await login({ body: { username: 'bob', password: 'wrong-password' } }, res);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(usersUpdateEq).toHaveBeenCalledWith('id', 'user-2');

    // A fresh checkAccountLock call (as the next login attempt would make)
    // must now see the lock via login_attempt_counters directly.
    vi.restoreAllMocks();
    vi.spyOn(supabase, 'from').mockReturnValue(lockCounterChain({ locked_until: lockedUntil }));
    const mins = await checkAccountLock('bob');
    expect(mins).toBeGreaterThan(0);
  });

  it('returns token, csrfToken and user info on successful login', async () => {
    vi.spyOn(supabase, 'from').mockImplementation((table) => {
      if (table === 'login_attempt_counters') return { delete: () => ({ eq: vi.fn().mockResolvedValue({ error: null }) }) };
      return {
        ...userLookupChain({
          id: 'user-3',
          username: 'charlie',
          email: 'charlie@example.com',
          password_hash: hashedPassword,
          is_active: true,
          locked_until: null,
          role: 'user',
          total_tokens: 1000,
          used_tokens: 0,
        }),
        update: () => ({ eq: vi.fn().mockResolvedValue({ error: null }) }),
      };
    });
    const res = makeRes();
    res.cookie = vi.fn();

    await login({ body: { username: 'charlie', password: 'CorrectHorseBatteryStaple1!', rememberMe: true } }, res);

    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      token: expect.any(String),
      csrfToken: expect.any(String),
      user: expect.objectContaining({
        id: 'user-3',
        username: 'charlie',
        rememberMe: true,
      }),
    }));
  });
});
