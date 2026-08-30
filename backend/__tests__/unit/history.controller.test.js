// vitest globals: describe, it, expect, vi, afterEach
//
// renameTopic previously returned `{ success: true, topic: undefined }` with
// HTTP 200 when the UPDATE matched no row (unowned or missing topic), because
// Supabase resolves — rather than rejects — with `{ data: [], error: null }`.
// These tests pin the empty-array case to a 404.

const supabase = require('../../config/supabase');
const { createTopic, renameTopic } = require('../../controllers/history.controller');

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

// createTopic exists so a first message carrying an attachment has a topic to
// upload into, instead of storing the file with topic_id NULL and relying on
// the pipeline's backfill to adopt it. Its whole job is to return an id that
// belongs to the caller.
const insertChain = (row, error = null) => {
  const captured = {};
  return {
    chain: {
      insert: (values) => {
        captured.values = values;
        return { select: () => ({ single: async () => ({ data: row, error }) }) };
      },
    },
    captured,
  };
};

describe('createTopic', () => {
  afterEach(() => vi.restoreAllMocks());

  it('opens the topic under the calling user and returns its id', async () => {
    const row = { id: 'topic-9', title: 'invoice.pdf', model: 'mistral-small' };
    const { chain, captured } = insertChain(row);
    vi.spyOn(supabase, 'from').mockReturnValue(chain);

    const res = makeRes();
    await createTopic(
      { body: { title: 'invoice.pdf', model: 'mistral-small' }, user: { id: 'user-1' } },
      res,
    );

    // The owner comes from the session, never from the body.
    expect(captured.values).toMatchObject({ user_id: 'user-1', title: 'invoice.pdf' });
    expect(res.status).toHaveBeenCalledWith(201);
    expect(res.json).toHaveBeenCalledWith({ topic: row });
  });

  it('caps the title the way the pipeline does', async () => {
    const { chain, captured } = insertChain({ id: 'topic-9' });
    vi.spyOn(supabase, 'from').mockReturnValue(chain);

    await createTopic(
      { body: { title: 'x'.repeat(200) }, user: { id: 'user-1' } },
      makeRes(),
    );

    expect(captured.values.title).toHaveLength(60);
  });

  it('names an untitled topic rather than storing a blank one', async () => {
    const { chain, captured } = insertChain({ id: 'topic-9' });
    vi.spyOn(supabase, 'from').mockReturnValue(chain);

    await createTopic({ body: { title: '   ' }, user: { id: 'user-1' } }, makeRes());

    expect(captured.values.title).toBe('New chat');
  });

  it('returns 401 without a session', async () => {
    const res = makeRes();
    await createTopic({ body: {} }, res);

    expect(res.status).toHaveBeenCalledWith(401);
  });
});
