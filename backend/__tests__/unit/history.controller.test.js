// vitest globals: describe, it, expect, vi, afterEach
//
// renameTopic previously returned `{ success: true, topic: undefined }` with
// HTTP 200 when the UPDATE matched no row (unowned or missing topic), because
// Supabase resolves — rather than rejects — with `{ data: [], error: null }`.
// These tests pin the empty-array case to a 404.

const supabase = require('../../config/supabase');
const { renameTopic } = require('../../controllers/history.controller');

const makeRes = () => {
  const res = {};
  res.status = vi.fn().mockReturnValue(res);
  res.json = vi.fn().mockReturnValue(res);
  return res;
};

// topics chain: .from('topics').update(...).eq('id', id).eq('user_id', uid).select()
const renameChain = (rows, error = null) => ({
  update: () => ({
    eq: () => ({
      eq: () => ({
        select: () => Promise.resolve({ data: rows, error }),
      }),
    }),
  }),
});

describe('renameTopic ownership enforcement', () => {
  afterEach(() => vi.restoreAllMocks());

  it('returns 404 when the topic does not exist or is not owned', async () => {
    vi.spyOn(supabase, 'from').mockReturnValue(renameChain([]));

    const res = makeRes();
    await renameTopic(
      { params: { id: 'topic-1' }, body: { title: 'New' }, user: { id: 'user-1' } },
      res,
    );

    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json).toHaveBeenCalledWith({ error: 'Topic not found' });
  });

  it('returns the renamed topic on success', async () => {
    const row = { id: 'topic-1', title: 'New', user_id: 'user-1' };
    vi.spyOn(supabase, 'from').mockReturnValue(renameChain([row]));

    const res = makeRes();
    await renameTopic(
      { params: { id: 'topic-1' }, body: { title: 'New' }, user: { id: 'user-1' } },
      res,
    );

    expect(res.json).toHaveBeenCalledWith({ success: true, topic: row });
  });

  it('returns 500 on a database error', async () => {
    vi.spyOn(supabase, 'from').mockReturnValue(renameChain([], new Error('boom')));

    const res = makeRes();
    await renameTopic(
      { params: { id: 'topic-1' }, body: { title: 'New' }, user: { id: 'user-1' } },
      res,
    );

    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith({ error: 'boom' });
  });
});
