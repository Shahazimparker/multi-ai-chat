// vitest globals: describe, it, expect, vi, afterEach
//
// The gate on every route that files something under a topic id taken from the
// request body — the upload routes and the three generate-* routes.
//
// What it is guarding against: those routes store the file with that topic_id,
// and nothing downstream re-checks it. The Attachments panel lists a chat's
// files by topic_id and RAG retrieval feeds them to whoever is chatting there,
// so an unowned id would let one account plant a file in another's
// conversation — visible to them, and readable by their model as context.

const supabase = require('../../config/supabase');
const { callerOwnsTopic, TOPIC_NOT_FOUND } = require('../../services/topicOwnership.service');

// .from('topics').select('id').eq('id', …).eq('user_id', …).maybeSingle()
const lookupChain = (row, error = null) => {
  const filters = {};
  return {
    filters,
    chain: {
      select: () => ({
        eq: (column, value) => {
          filters[column] = value;
          return {
            eq: (col2, val2) => {
              filters[col2] = val2;
              return { maybeSingle: async () => ({ data: row, error }) };
            },
          };
        },
      }),
    },
  };
};

afterEach(() => vi.restoreAllMocks());

describe('callerOwnsTopic', () => {
  it('accepts a topic the caller owns, scoping the lookup by both ids', async () => {
    const { chain, filters } = lookupChain({ id: 'topic-1' });
    vi.spyOn(supabase, 'from').mockReturnValue(chain);

    await expect(callerOwnsTopic('topic-1', 'user-1')).resolves.toBe(true);
    expect(filters).toEqual({ id: 'topic-1', user_id: 'user-1' });
  });

  it("rejects another user's topic", async () => {
    // The user_id filter matches nothing, so PostgREST returns null, not an error.
    vi.spyOn(supabase, 'from').mockReturnValue(lookupChain(null).chain);

    await expect(callerOwnsTopic('someone-elses-topic', 'user-1')).resolves.toBe(false);
  });

  it('treats a lookup error as not owned', async () => {
    // A malformed uuid fails the cast and arrives as an error. Answering the
    // same way as "no such topic" keeps this from confirming which ids exist.
    vi.spyOn(supabase, 'from').mockReturnValue(lookupChain(null, { message: 'invalid input syntax for type uuid' }).chain);

    await expect(callerOwnsTopic('not-a-uuid', 'user-1')).resolves.toBe(false);
  });

  it('allows an absent topic id — an unscoped file is a legitimate state', async () => {
    const from = vi.spyOn(supabase, 'from');

    await expect(callerOwnsTopic(null, 'user-1')).resolves.toBe(true);
    await expect(callerOwnsTopic(undefined, 'user-1')).resolves.toBe(true);
    await expect(callerOwnsTopic('', 'user-1')).resolves.toBe(true);
    // Nothing to look up, so nothing should be queried.
    expect(from).not.toHaveBeenCalled();
  });

  it('refuses a topic id with no user behind it', async () => {
    const from = vi.spyOn(supabase, 'from');

    await expect(callerOwnsTopic('topic-1', undefined)).resolves.toBe(false);
    expect(from).not.toHaveBeenCalled();
  });

  it('answers 404, not 403 — a 403 would confirm the topic exists', () => {
    expect(TOPIC_NOT_FOUND).toEqual({ error: 'Topic not found' });
  });
});
