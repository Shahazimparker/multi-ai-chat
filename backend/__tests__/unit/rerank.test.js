// ============================================================
// FILE: backend/__tests__/unit/rerank.test.js
// PURPOSE: Cohere cross-encoder rerank — the API wrapper, and its integration
//          into knowledge-base retrieval.
//
//          The invariant that matters most: a reranker outage must degrade to
//          the previous hybrid ordering, never break retrieval.
// ============================================================

const axios = require('axios');

const supabase = require('../../config/supabase');
const queryTransform = require('../../services/queryTransform.service');
const ragService = require('../../services/rag.service');
const cohereService = require('../../services/ai/cohere.service');
const rag2Service = require('../../services/rag2.service');

const COLLECTION_ID = '11111111-1111-1111-1111-111111111111';
const DOC_ID = '22222222-2222-2222-2222-222222222222';
const USER_ID = '33333333-3333-3333-3333-333333333333';

const rerankResponse = (results, searchUnits = 1) => ({
  data: {
    results: results.map(([index, relevance_score]) => ({ index, relevance_score })),
    meta: { billed_units: { search_units: searchUnits } },
  },
});

// ── Fixtures for the integration tests ───────────────────────
// Chunk B is the one that actually answers the query, but the embedder ranked
// chunk A higher. That inversion is exactly what a cross-encoder exists to fix.
const CHUNKS = [
  {
    chunk_id: 'aaaaaaaa-0000-0000-0000-000000000001',
    document_id: DOC_ID,
    collection_id: COLLECTION_ID,
    collection_name: 'Engineering',
    document_title: 'Overview.md',
    source_type: 'file',
    source_url: null,
    chunk_text: 'The platform supports many streaming and non-streaming endpoints.',
    parent_text: 'The platform supports many streaming and non-streaming endpoints across services.',
    similarity: 0.91, // embedder likes this one most
    chunk_metadata: { sectionTitle: 'Overview' },
  },
  {
    chunk_id: 'bbbbbbbb-0000-0000-0000-000000000002',
    document_id: DOC_ID,
    collection_id: COLLECTION_ID,
    collection_name: 'Engineering',
    document_title: 'API_Specs.md',
    source_type: 'file',
    source_url: null,
    chunk_text: 'POST /api/chat/stream streams SSE tokens to the client.',
    parent_text: 'The streaming API endpoint is POST /api/chat/stream and provides real-time SSE chunks.',
    similarity: 0.72, // ...but this is the real answer
    chunk_metadata: { sectionTitle: 'Streaming API' },
  },
];

const mockCollectionScope = (rows, documents = []) =>
  vi.spyOn(supabase, 'from').mockImplementation((table) => {
    if (table === 'knowledge_documents') {
      const chain = {
        select: () => chain,
        in: () => chain,
        eq: () => chain,
        limit: () => Promise.resolve({ data: documents, error: null }),
      };
      return chain;
    }
    return {
      select: () => ({
        in: () => Promise.resolve({ data: rows, error: null }),
        eq: () => Promise.resolve({ data: rows, error: null }),
      }),
    };
  });

const stubRetrieval = () => {
  mockCollectionScope([{ id: COLLECTION_ID, name: 'Engineering', embedding_provider: 'openrouter' }]);
  vi.spyOn(ragService, 'embedText').mockResolvedValue({
    vector: new Array(1536).fill(0.01),
    tokensUsed: 25,
    provider: 'openrouter',
    space: 'openai-te3-small',
  });
  vi.spyOn(supabase, 'rpc').mockResolvedValue({ data: CHUNKS, error: null });
};

const search = () => rag2Service.searchKnowledgeCollections({
  query: 'How does the streaming API work?',
  collectionIds: [COLLECTION_ID],
  userId: USER_ID,
});

beforeEach(() => {
  vi.restoreAllMocks();
  stubQueryTransform();
  process.env.COHERE_API_KEY = 'test-cohere-key';
});

// Query expansion runs before every knowledge-base search and calls a real
// model; setup.js loads the live .env, so these tests would otherwise make paid
// network calls. Stubbed with spyOn rather than vi.mock: this is a CommonJS
// module and a vi.mock factory does NOT intercept the require here — it fails
// open, silently leaving the real implementation in place.
// Expansion behaviour is covered on its own in queryTransform.test.js.
const stubQueryTransform = () => {
  vi.spyOn(queryTransform, 'expandQuery')
    .mockImplementation(async (q) => ({ queries: [q], tokensUsed: 0, expanded: false }));
  vi.spyOn(queryTransform, 'generateHypotheticalAnswer')
    .mockResolvedValue({ hypothetical: null, tokensUsed: 0 });
};

describe('rerankDocuments', () => {
  it('returns results ordered best-first with original indices preserved', async () => {
    vi.spyOn(axios, 'post').mockResolvedValue(rerankResponse([[2, 0.11], [0, 0.95], [1, 0.42]]));

    const { results, searchUnits } = await cohereService.rerankDocuments(
      'q', ['first', 'second', 'third'], 'key'
    );

    expect(results.map((r) => r.index)).toEqual([0, 1, 2]);
    expect(results[0].relevanceScore).toBe(0.95);
    expect(searchUnits).toBe(1);
  });

  it('posts to the v2 rerank endpoint with the configured model', async () => {
    const post = vi.spyOn(axios, 'post').mockResolvedValue(rerankResponse([[0, 0.9]]));

    await cohereService.rerankDocuments('q', ['a'], 'key', { model: 'rerank-v4.0-pro', topN: 1 });

    const [url, payload] = post.mock.calls[0];
    expect(url).toBe('https://api.cohere.com/v2/rerank');
    expect(payload).toMatchObject({ model: 'rerank-v4.0-pro', query: 'q', documents: ['a'], top_n: 1 });
  });

  it('discards out-of-range indices rather than returning undefined documents', async () => {
    vi.spyOn(axios, 'post').mockResolvedValue(rerankResponse([[0, 0.9], [99, 0.8]]));

    const { results } = await cohereService.rerankDocuments('q', ['only'], 'key');
    expect(results).toEqual([{ index: 0, relevanceScore: 0.9 }]);
  });

  it('short-circuits on an empty document list without calling the API', async () => {
    const post = vi.spyOn(axios, 'post');
    const { results } = await cohereService.rerankDocuments('q', [], 'key');

    expect(results).toEqual([]);
    expect(post).not.toHaveBeenCalled();
  });

  it('throws without an API key', async () => {
    await expect(cohereService.rerankDocuments('q', ['a'], null)).rejects.toThrow(/API key/i);
  });

  it('throws when the response has no results array', async () => {
    vi.spyOn(axios, 'post').mockResolvedValue({ data: {} });
    await expect(cohereService.rerankDocuments('q', ['a'], 'key')).rejects.toThrow(/no results/i);
  });
});

describe('knowledge base retrieval with reranking', () => {
  it('promotes the chunk the embedder ranked lower', async () => {
    stubRetrieval();
    // Cohere says index 1 (the real answer) beats index 0 (the generic overview).
    vi.spyOn(cohereService, 'rerankDocuments').mockResolvedValue({
      results: [{ index: 1, relevanceScore: 0.93 }, { index: 0, relevanceScore: 0.35 }],
      searchUnits: 1,
    });

    const result = await search();

    expect(result.reranked).toBe(true);
    // Ordering now follows relevance, not cosine.
    expect(result.citations[0].documentTitle).toBe('API_Specs.md');
    expect(result.citations[0].confidence).toBe(93);
    expect(result.citations[0].calibrated).toBe(true);
  });

  it('drops passages below the relevance gate instead of citing them', async () => {
    stubRetrieval();
    vi.spyOn(cohereService, 'rerankDocuments').mockResolvedValue({
      results: [{ index: 1, relevanceScore: 0.88 }, { index: 0, relevanceScore: 0.04 }],
      searchUnits: 1,
    });

    const result = await search();

    // The 0.04 chunk cleared the vector threshold but does not answer the
    // question; before the gate it was presented as a verified source.
    expect(result.chunkCount).toBe(1);
    expect(result.citations).toHaveLength(1);
    expect(result.citations[0].documentTitle).toBe('API_Specs.md');
  });

  it('still names the documents when the gate rejects everything', async () => {
    stubRetrieval();
    vi.spyOn(cohereService, 'rerankDocuments').mockResolvedValue({
      results: [{ index: 0, relevanceScore: 0.02 }, { index: 1, relevanceScore: 0.01 }],
      searchUnits: 1,
    });

    const result = await search();

    expect(result.chunkCount).toBe(0);
    expect(result.citations).toEqual([]);
    // The manifest must survive: "what is in this knowledge base?" has to stay
    // answerable even when no passage is relevant to the question asked.
    expect(result.context).toContain('KNOWLEDGE BASE RETRIEVAL');
    expect(result.context).toContain('Engineering');
  });

  it('degrades to hybrid ordering when the reranker fails', async () => {
    stubRetrieval();
    vi.spyOn(cohereService, 'rerankDocuments').mockRejectedValue(new Error('cohere 503'));

    const result = await search();

    // Retrieval still returns results — just ordered by cosine as before.
    expect(result.reranked).toBe(false);
    expect(result.chunkCount).toBeGreaterThan(0);
    expect(result.citations[0].documentTitle).toBe('Overview.md'); // highest similarity
    expect(result.citations[0].calibrated).toBe(false);
  });

  it('degrades to hybrid ordering when no Cohere key is configured', async () => {
    delete process.env.COHERE_API_KEY;
    stubRetrieval();
    const rerank = vi.spyOn(cohereService, 'rerankDocuments');

    const result = await search();

    expect(rerank).not.toHaveBeenCalled();
    expect(result.reranked).toBe(false);
    expect(result.chunkCount).toBeGreaterThan(0);
  });

  it('propagates caller cancellation instead of swallowing it', async () => {
    stubRetrieval();
    vi.spyOn(cohereService, 'rerankDocuments').mockRejectedValue(
      Object.assign(new Error('aborted'), { name: 'AbortError' })
    );

    await expect(search()).rejects.toMatchObject({ name: 'AbortError' });
  });
});

// ── Sparse / dense fusion ────────────────────────────────────
// The chunk carrying the literal term is invisible to the dense pass. Only the
// keyword index can surface it, which is the entire reason the sparse pass
// exists — a JS re-scoring of dense results could never recover it.
describe('dense + sparse fusion', () => {
  const SPARSE_ONLY_CHUNK = {
    chunk_id: 'cccccccc-0000-0000-0000-000000000003',
    document_id: DOC_ID,
    collection_id: COLLECTION_ID,
    collection_name: 'Engineering',
    document_title: 'Errors.md',
    source_type: 'file',
    source_url: null,
    chunk_text: 'Error ERR_STREAM_7742 indicates the SSE connection dropped.',
    parent_text: 'Error ERR_STREAM_7742 indicates the SSE connection dropped mid-response.',
    similarity: 0.97, // normalised text rank, NOT a cosine
    chunk_metadata: { sectionTitle: 'Error Codes' },
  };

  const stubSplitRetrieval = () => {
    mockCollectionScope([{ id: COLLECTION_ID, name: 'Engineering', embedding_provider: 'openrouter' }]);
    vi.spyOn(ragService, 'embedText').mockResolvedValue({
      vector: new Array(1536).fill(0.01),
      tokensUsed: 25,
      provider: 'openrouter',
      space: 'openai-te3-small',
    });
    vi.spyOn(supabase, 'rpc').mockImplementation((fn) => {
      if (fn === 'match_knowledge_chunks_fts') {
        return Promise.resolve({ data: [SPARSE_ONLY_CHUNK], error: null });
      }
      if (fn === 'match_knowledge_chunks') {
        return Promise.resolve({ data: CHUNKS, error: null });
      }
      return Promise.resolve({ data: [], error: null });
    });
  };

  it('recovers a keyword-only chunk the dense pass never returned', async () => {
    stubSplitRetrieval();
    // No reranker, so the fused RRF ordering is what reaches the prompt.
    delete process.env.COHERE_API_KEY;

    const result = await rag2Service.searchKnowledgeCollections({
      query: 'What does ERR_STREAM_7742 mean?',
      collectionIds: [COLLECTION_ID],
      userId: USER_ID,
    });

    const titles = result.citations.map((c) => c.documentTitle);

    // The point of the sparse pass: this chunk is absent from the dense
    // results entirely, so no amount of re-scoring dense output could reach it.
    expect(titles).toContain('Errors.md');

    // It ties the top dense hit rather than beating it — both are rank 1 in
    // their own list, so both score 1/(k+1). Being in the top 2 is the real
    // guarantee; strict first place would be asserting a coin flip.
    expect(titles.slice(0, 2)).toContain('Errors.md');
  });

  it('passes the fused set to the reranker, not just the dense results', async () => {
    stubSplitRetrieval();
    process.env.COHERE_API_KEY = 'test-cohere-key';
    const rerank = vi.spyOn(cohereService, 'rerankDocuments').mockResolvedValue({
      results: [{ index: 0, relevanceScore: 0.9 }],
      searchUnits: 1,
    });

    await rag2Service.searchKnowledgeCollections({
      query: 'What does ERR_STREAM_7742 mean?',
      collectionIds: [COLLECTION_ID],
      userId: USER_ID,
    });

    const documentsSent = rerank.mock.calls[0][1];
    expect(documentsSent).toHaveLength(3); // 2 dense + 1 sparse-only, deduped
    expect(documentsSent.some((d) => d.includes('ERR_STREAM_7742'))).toBe(true);
  });

  it('deduplicates a chunk returned by both passes', async () => {
    mockCollectionScope([{ id: COLLECTION_ID, name: 'Engineering', embedding_provider: 'openrouter' }]);
    vi.spyOn(ragService, 'embedText').mockResolvedValue({
      vector: new Array(1536).fill(0.01), tokensUsed: 25,
      provider: 'openrouter', space: 'openai-te3-small',
    });
    // Both passes return the SAME chunk.
    vi.spyOn(supabase, 'rpc').mockResolvedValue({ data: [CHUNKS[0]], error: null });
    delete process.env.COHERE_API_KEY;

    const result = await rag2Service.searchKnowledgeCollections({
      query: 'streaming endpoints',
      collectionIds: [COLLECTION_ID],
      userId: USER_ID,
    });

    expect(result.chunkCount).toBe(1);
    expect(result.citations).toHaveLength(1);
  });

  it('falls back to dense-only when the FTS migration is not applied', async () => {
    mockCollectionScope([{ id: COLLECTION_ID, name: 'Engineering', embedding_provider: 'openrouter' }]);
    vi.spyOn(ragService, 'embedText').mockResolvedValue({
      vector: new Array(1536).fill(0.01), tokensUsed: 25,
      provider: 'openrouter', space: 'openai-te3-small',
    });
    vi.spyOn(supabase, 'rpc').mockImplementation((fn) => {
      if (fn === 'match_knowledge_chunks_fts') {
        return Promise.resolve({ data: null, error: { message: 'function does not exist' } });
      }
      return Promise.resolve({ data: CHUNKS, error: null });
    });
    delete process.env.COHERE_API_KEY;

    const result = await rag2Service.searchKnowledgeCollections({
      query: 'streaming',
      collectionIds: [COLLECTION_ID],
      userId: USER_ID,
    });

    // Dense retrieval alone is exactly the pre-migration behaviour.
    expect(result.chunkCount).toBeGreaterThan(0);
  });
});

// ── Contextual chunk enrichment ──────────────────────────────
describe('buildEmbeddingText', () => {
  const { buildEmbeddingText } = rag2Service;

  const NL = String.fromCharCode(10);
  const GAP = NL + NL;

  it('prepends document and section context so the vector carries it', () => {
    expect(buildEmbeddingText('The limit is 4096 tokens.', 'API_Specs.md', 'Rate Limits'))
      .toBe('API_Specs.md > Rate Limits' + GAP + 'The limit is 4096 tokens.');
  });

  it('does not repeat a heading the chunk already opens with', () => {
    // sectionTitle is extracted from a heading inside the chunk, so the chunk
    // that heading opens would otherwise carry the phrase twice and be pulled
    // toward its own title.
    const chunk = '# Rate Limits' + GAP + 'The limit is 4096 tokens.';
    const out = buildEmbeddingText(chunk, 'API_Specs.md', 'Rate Limits');

    expect(out).toBe('API_Specs.md' + GAP + chunk);
    expect(out.match(/Rate Limits/g)).toHaveLength(1);
  });

  it('still adds the section when the heading appears far into the chunk', () => {
    const chunk = 'x'.repeat(400) + ' Rate Limits';
    expect(buildEmbeddingText(chunk, 'API_Specs.md', 'Rate Limits'))
      .toContain('API_Specs.md > Rate Limits');
  });

  it('returns the chunk unchanged when there is no context to add', () => {
    expect(buildEmbeddingText('bare chunk')).toBe('bare chunk');
    expect(buildEmbeddingText('bare chunk', '', '')).toBe('bare chunk');
  });

  it('tolerates empty or missing chunk text', () => {
    expect(buildEmbeddingText('', 'Doc.md')).toBe('Doc.md' + GAP);
    expect(buildEmbeddingText(null, '', '')).toBe('');
  });
});

// ── RAPTOR summary nodes in retrieval ────────────────────────
// Summary nodes share a table with leaf chunks, so they compete in the same
// ranking. They must be usable for overview questions without displacing the
// primary text an exact lookup needs.
describe('RAPTOR summaries in retrieval', () => {
  const summaryChunk = (id, score) => ({
    chunk_id: id,
    document_id: DOC_ID,
    collection_id: COLLECTION_ID,
    collection_name: 'Engineering',
    document_title: 'API_Specs.md',
    source_type: 'file',
    source_url: null,
    chunk_text: 'This document covers streaming endpoints and error codes.',
    parent_text: 'This document covers streaming endpoints and error codes.',
    similarity: score,
    chunk_metadata: { raptor: true, level: 1, childCount: 5 },
  });

  const stubWith = (rows) => {
    mockCollectionScope([{ id: COLLECTION_ID, name: 'Engineering', embedding_provider: 'openrouter' }]);
    vi.spyOn(ragService, 'embedText').mockResolvedValue({
      vector: new Array(1536).fill(0.01), tokensUsed: 25,
      provider: 'openrouter', space: 'openai-te3-small',
    });
    vi.spyOn(supabase, 'rpc').mockResolvedValue({ data: rows, error: null });
  };

  it('marks a summary as synthesis, not a verbatim quote', async () => {
    stubWith([summaryChunk('sum-1', 0.9)]);
    vi.spyOn(cohereService, 'rerankDocuments').mockResolvedValue({
      results: [{ index: 0, relevanceScore: 0.9 }], searchUnits: 1,
    });

    const result = await search();

    // A user must not read generated text as something the document says.
    expect(result.citations[0].isSummary).toBe(true);
    expect(result.citations[0].treeLevel).toBe(1);
    expect(result.context).toMatch(/GENERATED SUMMARY/);
    expect(result.context).toMatch(/not a direct quote/i);
  });

  it('leaves a leaf chunk unmarked', async () => {
    stubWith(CHUNKS);
    vi.spyOn(cohereService, 'rerankDocuments').mockResolvedValue({
      results: [{ index: 0, relevanceScore: 0.9 }], searchUnits: 1,
    });

    const result = await search();

    expect(result.citations[0].isSummary).toBe(false);
    expect(result.citations[0].treeLevel).toBe(0);
    expect(result.context).not.toMatch(/GENERATED SUMMARY/);
  });

  it('lets a leaf win a tie against a summary', async () => {
    // Observed for real: an exact identifier lookup put an L2 summary above the
    // passage containing the literal string, both scored 1.0 by the reranker.
    stubWith([summaryChunk('sum-1', 0.9), CHUNKS[1]]);
    vi.spyOn(cohereService, 'rerankDocuments').mockResolvedValue({
      results: [{ index: 0, relevanceScore: 1.0 }, { index: 1, relevanceScore: 1.0 }],
      searchUnits: 1,
    });

    const result = await search();

    expect(result.citations[0].isSummary).toBe(false);
    expect(result.citations[0].documentTitle).toBe('API_Specs.md');
  });

  it('still lets a summary win when it is clearly more relevant', async () => {
    // The penalty is a tie-break, not a veto — a broad question where the
    // summary leads by a wide margin must still surface it first.
    stubWith([summaryChunk('sum-1', 0.9), CHUNKS[1]]);
    vi.spyOn(cohereService, 'rerankDocuments').mockResolvedValue({
      results: [{ index: 0, relevanceScore: 0.95 }, { index: 1, relevanceScore: 0.40 }],
      searchUnits: 1,
    });

    const result = await search();

    expect(result.citations[0].isSummary).toBe(true);
  });

  it('never fills the whole context with synthesis', async () => {
    const summaries = [0, 1, 2, 3, 4, 5].map((i) => summaryChunk('sum-' + i, 0.9 - i * 0.01));
    stubWith(summaries);
    vi.spyOn(cohereService, 'rerankDocuments').mockResolvedValue({
      results: summaries.map((_, i) => ({ index: i, relevanceScore: 0.9 - i * 0.01 })),
      searchUnits: 1,
    });

    const result = await search();

    // Leaving no primary text at all would give the model nothing to check
    // itself against.
    const summaryCount = result.citations.filter((c) => c.isSummary).length;
    expect(summaryCount).toBeLessThanOrEqual(2);
  });
});

// ── Reranker fallback chain ──────────────────────────────────
// OpenRouter exposes no rerank endpoint, so the fallback is a chat model
// scoring candidates. Its ordering is useful; its SCALE is invented, and the
// relevance gate must not be applied to it.
describe('rerank fallback', () => {
  const llmScores = (pairs) => ({
    data: { choices: [{ message: { content: JSON.stringify(pairs.map(([index, score]) => ({ index, score }))) } }] },
  });

  it('parses scores and orders best-first', async () => {
    vi.spyOn(axios, 'post').mockResolvedValue(llmScores([[0, 0.2], [1, 0.9]]));

    const { results, calibrated } = await cohereService.rerankWithLlm('q', ['a', 'b'], { apiKey: 'k' });

    expect(results[0]).toEqual({ index: 1, relevanceScore: 0.9 });
    expect(calibrated).toBe(false);
  });

  it('clamps scores outside 0..1', async () => {
    // Models return 1.5 and -0.2 despite the instruction.
    vi.spyOn(axios, 'post').mockResolvedValue(llmScores([[0, 1.5], [1, -0.2]]));

    const { results } = await cohereService.rerankWithLlm('q', ['a', 'b'], { apiKey: 'k' });

    expect(results.map((r) => r.relevanceScore)).toEqual([1, 0]);
  });

  it('discards indices outside the candidate range', async () => {
    vi.spyOn(axios, 'post').mockResolvedValue(llmScores([[0, 0.8], [99, 0.9]]));

    const { results } = await cohereService.rerankWithLlm('q', ['only'], { apiKey: 'k' });

    expect(results).toEqual([{ index: 0, relevanceScore: 0.8 }]);
  });

  it('throws when the reply carries no JSON array', async () => {
    vi.spyOn(axios, 'post').mockResolvedValue({ data: { choices: [{ message: { content: 'no idea' } }] } });
    await expect(cohereService.rerankWithLlm('q', ['a'], { apiKey: 'k' })).rejects.toThrow(/no JSON array/i);
  });

  it('takes over when the cross-encoder fails', async () => {
    stubRetrieval();
    vi.spyOn(cohereService, 'rerankDocuments').mockRejectedValue(new Error('cohere 401'));
    const llm = vi.spyOn(cohereService, 'rerankWithLlm').mockResolvedValue({
      results: [{ index: 1, relevanceScore: 0.88 }, { index: 0, relevanceScore: 0.3 }],
      calibrated: false,
    });

    const result = await search();

    expect(llm).toHaveBeenCalled();
    expect(result.reranked).toBe(true);
    expect(result.rerankCalibrated).toBe(false);
    expect(result.citations[0].documentTitle).toBe('API_Specs.md');
  });

  it('stands the relevance gate down for uncalibrated scores', async () => {
    stubRetrieval();
    vi.spyOn(cohereService, 'rerankDocuments').mockRejectedValue(new Error('cohere down'));
    vi.spyOn(cohereService, 'rerankWithLlm').mockResolvedValue({
      // Both below RAG_RERANK_MIN_RELEVANCE. With a cross-encoder these would
      // be dropped; on an invented scale that would be an arbitrary cut.
      results: [{ index: 0, relevanceScore: 0.10 }, { index: 1, relevanceScore: 0.05 }],
      calibrated: false,
    });

    const result = await search();

    expect(result.chunkCount).toBeGreaterThan(0);
    expect(result.citations[0].calibrated).toBe(false);
  });

  it('falls all the way back to RRF ordering when both rerankers fail', async () => {
    stubRetrieval();
    vi.spyOn(cohereService, 'rerankDocuments').mockRejectedValue(new Error('cohere down'));
    vi.spyOn(cohereService, 'rerankWithLlm').mockRejectedValue(new Error('openrouter down'));

    const result = await search();

    expect(result.reranked).toBe(false);
    expect(result.chunkCount).toBeGreaterThan(0);
  });
});
