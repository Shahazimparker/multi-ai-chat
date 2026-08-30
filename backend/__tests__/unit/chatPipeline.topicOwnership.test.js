// vitest globals: describe, it, expect, vi, afterEach
//
// The chat pipeline's topic gate (step 1b).
//
// `topicId` arrives straight from the request body, and every downstream reader
// — history, summaries, response cache, RAG, uploaded files — filters on
// topic_id alone. Without this check an authenticated caller could pass another
// user's topic id and have that conversation loaded into their prompt, and
// their own turns written back into the victim's topic.
//
// The check sits immediately after model validation, and both failure modes
// return before anything is dispatched to a provider, which is what makes this
// testable without mocking the whole pipeline.

const supabase = require('../../config/supabase');
const { runChatPipeline } = require('../../services/chatPipeline.service');

// .from('topics').select('id').eq('id', …).eq('user_id', …).maybeSingle()
const topicLookup = (row, error = null) => ({
  select: () => ({
    eq: () => ({
      eq: () => ({ maybeSingle: async () => ({ data: row, error }) }),
    }),
  }),
});

const run = (overrides = {}) => runChatPipeline({
  modelId: 'gemini-flash',
  message: 'hello',
  topicId: 'someone-elses-topic',
  user: { id: 'user-1' },
  isAnonymous: false,
  abortController: new AbortController(),
  ...overrides,
});

afterEach(() => vi.restoreAllMocks());

describe('chat pipeline topic ownership', () => {
  it("refuses a topic the caller does not own, and keeps no id from it", async () => {
    vi.spyOn(supabase, 'from').mockReturnValue(topicLookup(null));

    const result = await run();

    expect(result.errorType).toBe('topic_not_found');
    expect(result.userMessage).toBe('Topic not found.');
    // The unowned id must not survive into the result — callers echo
    // resolvedTopicId back to the client as the conversation they are in.
    expect(result.resolvedTopicId).toBeNull();
  });

  it('answers a failed lookup the same way, so it cannot be used to probe ids', async () => {
    // A malformed uuid fails the cast and arrives here as an error rather than
    // an empty result. Distinguishing the two would confirm which ids are real.
    vi.spyOn(supabase, 'from').mockReturnValue(
      topicLookup(null, { message: 'invalid input syntax for type uuid' }),
    );

    const result = await run({ topicId: 'not-a-uuid' });

    expect(result.errorType).toBe('topic_not_found');
    expect(result.resolvedTopicId).toBeNull();
  });

  it('checks the id against the caller in a single owned-by query', async () => {
    const filters = {};
    vi.spyOn(supabase, 'from').mockReturnValue({
      select: () => ({
        eq: (column, value) => {
          filters[column] = value;
          return {
            eq: (col2, val2) => {
              filters[col2] = val2;
              return { maybeSingle: async () => ({ data: null, error: null }) };
            },
          };
        },
      }),
    });

    await run({ topicId: 'topic-9' });

    expect(filters).toEqual({ id: 'topic-9', user_id: 'user-1' });
  });
});
