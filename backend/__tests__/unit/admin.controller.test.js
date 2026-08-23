// vitest globals: describe, it, expect, vi, afterEach
//
// updateUser previously accepted any role string, any password length, and
// would happily demote/deactivate the last remaining admin. These tests pin
// the three guards: role enum, password policy, and last-admin protection.

const supabase = require('../../config/supabase');
const { updateUser, deleteUser, getAnalytics } = require('../../controllers/admin.controller');

const makeRes = () => {
  const res = {};
  res.status = vi.fn().mockReturnValue(res);
  res.json = vi.fn().mockReturnValue(res);
  return res;
};

// .from('users').select('role, is_active').eq('id', id).single()
const singleChain = (data, error = null) => ({
  select: () => ({
    eq: () => ({
      single: () => Promise.resolve({ data, error }),
    }),
  }),
});

// .from('users').select('id', { count: 'exact', head: true }).eq('role','admin').eq('is_active',true)
const countChain = (count, error = null) => ({
  select: () => ({
    eq: () => ({
      eq: () => Promise.resolve({ count, error }),
    }),
  }),
});

// .from('users').update(updates).eq('id', id).select('...').single()
const updateChain = (data, error = null) => ({
  update: () => ({
    eq: () => ({
      select: () => ({
        single: () => Promise.resolve({ data, error }),
      }),
    }),
  }),
});

describe('updateUser validation', () => {
  afterEach(() => vi.restoreAllMocks());

  it('rejects an unknown role', async () => {
    const res = makeRes();
    await updateUser(
      { params: { id: 'u1' }, body: { role: 'superadmin' }, user: { id: 'admin-1' } },
      res,
    );

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({ error: 'Invalid role. Must be one of: user, admin' });
  });

  it('rejects a too-short password', async () => {
    const res = makeRes();
    await updateUser(
      { params: { id: 'u1' }, body: { password: 'short' }, user: { id: 'admin-1' } },
      res,
    );

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({ error: 'Password must be at least 8 characters' });
  });

  it('refuses to demote the last active admin', async () => {
    vi.spyOn(supabase, 'from')
      .mockImplementationOnce(() => singleChain({ role: 'admin', is_active: true }))
      .mockImplementationOnce(() => countChain(1));

    const res = makeRes();
    await updateUser(
      { params: { id: 'admin-1' }, body: { role: 'user' }, user: { id: 'admin-2' } },
      res,
    );

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({ error: 'Cannot demote or deactivate the last active admin' });
  });

  it('refuses to deactivate the last active admin', async () => {
    vi.spyOn(supabase, 'from')
      .mockImplementationOnce(() => singleChain({ role: 'admin', is_active: true }))
      .mockImplementationOnce(() => countChain(1));

    const res = makeRes();
    await updateUser(
      { params: { id: 'admin-1' }, body: { is_active: false }, user: { id: 'admin-2' } },
      res,
    );

    expect(res.status).toHaveBeenCalledWith(400);
  });

  it('allows a demotion when another active admin remains', async () => {
    const updated = { id: 'admin-1', email: 'a@x.com', username: 'a', role: 'user', is_active: true };
    vi.spyOn(supabase, 'from')
      .mockImplementationOnce(() => singleChain({ role: 'admin', is_active: true }))
      .mockImplementationOnce(() => countChain(2))
      .mockImplementationOnce(() => updateChain(updated));

    const res = makeRes();
    await updateUser(
      { params: { id: 'admin-1' }, body: { role: 'user' }, user: { id: 'admin-2' } },
      res,
    );

    expect(res.json).toHaveBeenCalledWith({ user: updated, message: 'User updated' });
  });
});

describe('deleteUser', () => {
  afterEach(() => vi.restoreAllMocks());

  it('rejects self-deletion without calling the RPC', async () => {
    const rpc = vi.spyOn(supabase, 'rpc');
    const res = makeRes();
    await deleteUser({ params: { id: 'self' }, user: { id: 'self' } }, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(rpc).not.toHaveBeenCalled();
  });

  it('deletes atomically via delete_user_cascade', async () => {
    vi.spyOn(supabase, 'rpc').mockResolvedValue({ data: null, error: null });
    const res = makeRes();
    await deleteUser({ params: { id: 'u1' }, user: { id: 'admin-1' } }, res);

    expect(supabase.rpc).toHaveBeenCalledWith('delete_user_cascade', { p_user_id: 'u1' });
    expect(res.json).toHaveBeenCalledWith({ message: 'User deleted' });
  });

  it('returns 500 when the RPC fails', async () => {
    vi.spyOn(supabase, 'rpc').mockResolvedValue({ data: null, error: new Error('cascade failed') });
    const res = makeRes();
    await deleteUser({ params: { id: 'u1' }, user: { id: 'admin-1' } }, res);

    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith({ error: 'cascade failed' });
  });
});

describe('getAnalytics', () => {
  afterEach(() => vi.restoreAllMocks());

  it('forwards the server-side aggregation', async () => {
    const payload = {
      modelCounts: { claude: 3 },
      topQueries: [],
      dailyUsage: [{ day: '2026-08-22', queries: 3, tokens: 150 }],
      summary: { totalQueries: 3, totalTokens: 150, cacheHits: 1, cacheHitRate: 33.3 },
    };
    vi.spyOn(supabase, 'rpc').mockResolvedValue({ data: payload, error: null });

    const res = makeRes();
    await getAnalytics({}, res);

    expect(supabase.rpc).toHaveBeenCalledWith('get_admin_analytics');
    expect(res.json).toHaveBeenCalledWith(payload);
  });

  it('returns 500 when the aggregation fails', async () => {
    vi.spyOn(supabase, 'rpc').mockResolvedValue({ data: null, error: new Error('agg failed') });

    const res = makeRes();
    await getAnalytics({}, res);

    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith({ error: 'agg failed' });
  });
});
