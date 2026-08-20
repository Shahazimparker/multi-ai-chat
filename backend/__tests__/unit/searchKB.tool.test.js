// ============================================================
// FILE: backend/__tests__/unit/searchKB.tool.test.js
// PURPOSE: [SEARCH_KB] — knowledge-base retrieval as a callable tool.
//
//   Turns one-shot retrieval into agentic retrieval: the pre-search only ever
//   sees the user's original wording, this lets the model search again with
//   better terms once it knows what it is looking for.
//
//   The behaviour that matters most is loop prevention. An agentic tool that
//   returns nothing must say so in a way that stops the model repeating the
//   same query until the round budget runs out.
// ============================================================

const rag2Service = require('../../services/rag2.service');
const {
  findSearchKBMatch,
  processToolCall,
} = require('../../services/toolProcessor.service');

const COLLECTION_ID = '11111111-1111-1111-1111-111111111111';
const USER = { id: '33333333-3333-3333-3333-333333333333' };

const baseArgs = (overrides = {}) => ({
  reply: '[SEARCH_KB:query="mxgraph flowchart"]',
  aiResponse: null,
  aiMessages: [],
  user: USER,
  topicId: 'topic-1',
  abortController: new AbortController(),
  collectionIds: [COLLECTION_ID],
  embedProvider: 'openrouter',
  ragTokenBudget: 2000,
  ...overrides,
});

const CITATION = {
  citationId: 1,
  documentId: 'doc-1',
  documentTitle: 'drawio-shape-cheatsheet.md',
  collectionName: 'TEST',
  snippet: 'style=shape=mxgraph.flowchart.decision',
  confidence: 91,
  calibrated: true,
};

beforeEach(() => {
  vi.restoreAllMocks();
});

describe('findSearchKBMatch', () => {
  it.each([
    ['[SEARCH_KB:query="mxgraph flowchart style"]', 'mxgraph flowchart style'],
    ["[SEARCH_KB:query='rate limits']", 'rate limits'],
    ['[SEARCH_KB:query=how do i draw a swimlane]', 'how do i draw a swimlane'],
    ['Let me check. [SEARCH_KB:query="ERR_7742"] one moment', 'ERR_7742'],
  ])('extracts the query from %s', (input, expected) => {
    expect(findSearchKBMatch(input)[1]).toBe(expected);
  });

  it('does not match ordinary prose', () => {
    expect(findSearchKBMatch('I will search the knowledge base for you.')).toBeNull();
  });
});

describe('SEARCH_KB tool handler', () => {
  it('searches the attached collections and feeds the context back', async () => {
    const search = vi.spyOn(rag2Service, 'searchKnowledgeCollections').mockResolvedValue({
      context: '## KNOWLEDGE BASE RETRIEVAL\n[SOURCE 1: "drawio-shape-cheatsheet.md"]\nstyle=...\n',
      citations: [CITATION],
      chunkCount: 1,
      tokensUsed: 120,
      reranked: true,
    });

    const result = await processToolCall(baseArgs());

    expect(result.handled).toBe(true);
    expect(search).toHaveBeenCalledWith(expect.objectContaining({
      query: 'mxgraph flowchart',
      collectionIds: [COLLECTION_ID],
      userId: USER.id,
    }));

    const injected = result.newMessages[1].content;
    expect(injected).toContain('KNOWLEDGE BASE RESULT');
    expect(injected).toContain('drawio-shape-cheatsheet.md');
    expect(result.embedTokens).toBe(120);
  });

  it('reports citations to both the UI and the pipeline accumulator', async () => {
    vi.spyOn(rag2Service, 'searchKnowledgeCollections').mockResolvedValue({
      context: 'ctx', citations: [CITATION], chunkCount: 1, tokensUsed: 10,
    });

    const statuses = [];
    const collected = [];

    await processToolCall(baseArgs({
      onStatus: (s) => statuses.push(s),
      onCitations: (c) => collected.push(...c),
    }));

    // Without the accumulator the UI would show sources for the automatic
    // pre-search only, and silently drop everything a tool call found.
    expect(collected).toEqual([CITATION]);
    expect(statuses.some((s) => s.type === 'citations')).toBe(true);
    expect(statuses.some((s) => s.tool === 'knowledge_search')).toBe(true);
  });

  it('tells the model not to repeat a query that found nothing', async () => {
    vi.spyOn(rag2Service, 'searchKnowledgeCollections').mockResolvedValue({
      context: '', citations: [], chunkCount: 0, tokensUsed: 0,
    });

    const result = await processToolCall(baseArgs());
    const injected = result.newMessages[1].content;

    // A bare "no results" invites the model to try the identical query again
    // until the round budget is exhausted.
    expect(injected).toMatch(/rephrase|not covered/i);
    expect(injected).toMatch(/do not repeat/i);
  });

  it('short-circuits when no knowledge base is attached', async () => {
    const search = vi.spyOn(rag2Service, 'searchKnowledgeCollections');

    const result = await processToolCall(baseArgs({ collectionIds: [] }));

    expect(search).not.toHaveBeenCalled();
    expect(result.handled).toBe(true);
    expect(result.newMessages[1].content).toMatch(/no knowledge base is attached/i);
    expect(result.newMessages[1].content).toMatch(/do not call SEARCH_KB again/i);
  });

  it('keeps the answer flowing when the search errors', async () => {
    vi.spyOn(rag2Service, 'searchKnowledgeCollections').mockRejectedValue(new Error('pgvector down'));

    const result = await processToolCall(baseArgs());

    expect(result.handled).toBe(true);
    expect(result.newMessages[1].content).toMatch(/unreachable/i);
  });

  it('propagates cancellation rather than swallowing it', async () => {
    vi.spyOn(rag2Service, 'searchKnowledgeCollections').mockRejectedValue(
      Object.assign(new Error('aborted'), { name: 'AbortError' })
    );

    await expect(processToolCall(baseArgs())).rejects.toMatchObject({ name: 'AbortError' });
  });

  it('strips the marker from the assistant turn it echoes back', async () => {
    vi.spyOn(rag2Service, 'searchKnowledgeCollections').mockResolvedValue({
      context: 'ctx', citations: [], chunkCount: 1, tokensUsed: 5,
    });

    const result = await processToolCall(baseArgs({
      reply: 'Let me look that up. [SEARCH_KB:query="shapes"]',
    }));

    // The marker must not survive into history, or the model sees its own tool
    // call as prior text and re-issues it.
    expect(result.newMessages[0].content).toBe('Let me look that up.');
    expect(result.newMessages[0].content).not.toContain('SEARCH_KB');
  });

  it('is checked before web search, so attached docs win over the open web', async () => {
    const kbSearch = vi.spyOn(rag2Service, 'searchKnowledgeCollections').mockResolvedValue({
      context: 'ctx', citations: [], chunkCount: 1, tokensUsed: 5,
    });

    // A reply containing BOTH markers must resolve to the knowledge base.
    const result = await processToolCall(baseArgs({
      reply: '[SEARCH_KB:query="shapes"] [WEB_SEARCH:query="shapes"]',
    }));

    expect(kbSearch).toHaveBeenCalled();
    expect(result.newMessages[1].content).toContain('KNOWLEDGE BASE RESULT');
  });
});
