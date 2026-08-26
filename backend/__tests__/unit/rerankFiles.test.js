// ============================================================
// FILE: backend/__tests__/unit/rerankFiles.test.js
// PURPOSE: Verify Cohere cross-encoder reranking on per-chat uploaded files and logs,
//          with HTTP 429 rate-limit resilience (free-tier 10 RPM / 1000/mo cap).
// ============================================================

const axios = require('axios');
const supabase = require('../../config/supabase');
const ragService = require('../../services/rag.service');
const cohereService = require('../../services/ai/cohere.service');
const { searchUserFilesRAG } = require('../../services/fileUpload.service');
const { buildRAGContext, searchRelevantDocs } = require('../../services/rag.service');

const USER_ID = 'test-user-uuid-1111';
const TOPIC_ID = 'test-topic-uuid-2222';

const makeChain = (data) => {
  const chain = {
    select: vi.fn(() => chain),
    eq: vi.fn(() => chain),
    order: vi.fn(() => chain),
    limit: vi.fn(() => Promise.resolve({ data, error: null })),
  };
  return chain;
};

describe('Cohere Reranking on Uploaded Files and Logs', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    process.env.COHERE_API_KEY = 'test-cohere-key';
    cohereService.clearCohereRateLimitCooldown();
  });

  afterEach(() => {
    delete process.env.COHERE_API_KEY;
    cohereService.clearCohereRateLimitCooldown();
  });

  describe('searchUserFilesRAG reranking', () => {
    it('promotes the most relevant log/file snippet to the top via Cohere rerank', async () => {
      // 2 files in topic matching the query "database connection error"
      const files = [
        {
          id: 'file-1',
          file_name: 'background.log',
          original_content: 'database connection error: connection reset by peer in worker thread',
        },
        {
          id: 'file-2',
          file_name: 'app.log',
          original_content: 'database connection error: fatal panic in auth module',
        },
      ];

      vi.spyOn(supabase, 'from').mockImplementation(() => makeChain(files));
      vi.spyOn(ragService, 'embedText').mockResolvedValue({
        vector: new Array(1536).fill(0.01),
        tokensUsed: 10,
        space: 'openai-te3-small',
      });
      vi.spyOn(supabase, 'rpc').mockResolvedValue({ data: [], error: null });

      // Mock Cohere rerank response: file-2 (index 1) has higher relevance score 0.95
      vi.spyOn(axios, 'post').mockResolvedValue({
        data: {
          results: [
            { index: 1, relevance_score: 0.95 },
            { index: 0, relevance_score: 0.45 },
          ],
          meta: { billed_units: { search_units: 1 } },
        },
      });

      const { results } = await searchUserFilesRAG('database connection error', USER_ID, TOPIC_ID);

      expect(results.length).toBe(2);
      expect(results[0].file_id).toBe('file-2');
      expect(results[0].rerankScore).toBe(0.95);
      expect(results[1].file_id).toBe('file-1');
      expect(results[1].rerankScore).toBe(0.45);
    });

    it('gracefully handles HTTP 429 rate limit and returns un-reranked results without crashing', async () => {
      const files = [
        {
          id: 'file-1',
          file_name: 'server.log',
          original_content: 'server timeout error: gateway timed out',
        },
        {
          id: 'file-2',
          file_name: 'client.log',
          original_content: 'server timeout error: client request aborted',
        },
      ];

      vi.spyOn(supabase, 'from').mockImplementation(() => makeChain(files));
      vi.spyOn(ragService, 'embedText').mockResolvedValue({
        vector: new Array(1536).fill(0.01),
        tokensUsed: 10,
        space: 'openai-te3-small',
      });
      vi.spyOn(supabase, 'rpc').mockResolvedValue({ data: [], error: null });

      // Simulate Cohere returning HTTP 429 Too Many Requests
      const err429 = new Error('Request failed with status code 429');
      err429.response = { status: 429, headers: { 'retry-after': '30' } };
      vi.spyOn(axios, 'post').mockRejectedValue(err429);

      const { results } = await searchUserFilesRAG('server timeout error', USER_ID, TOPIC_ID);

      // Must NOT throw; returns original grep results and activates cooldown
      expect(results.length).toBe(2);
      expect(results[0].file_id).toBe('file-1');
      expect(cohereService.isCohereRateLimited()).toBe(true);
    });

    it('skips calling Cohere API while in 429 cooldown window', async () => {
      cohereService.setCohereRateLimitCooldown(60);
      expect(cohereService.isCohereRateLimited()).toBe(true);

      const files = [
        { id: 'f-1', file_name: 'a.log', original_content: 'system crash failure 1' },
        { id: 'f-2', file_name: 'b.log', original_content: 'system crash failure 2' },
      ];

      vi.spyOn(supabase, 'from').mockImplementation(() => makeChain(files));
      vi.spyOn(ragService, 'embedText').mockResolvedValue({
        vector: new Array(1536).fill(0.01),
        tokensUsed: 10,
        space: 'openai-te3-small',
      });
      vi.spyOn(supabase, 'rpc').mockResolvedValue({ data: [], error: null });

      const postSpy = vi.spyOn(axios, 'post');

      const { results } = await searchUserFilesRAG('system crash failure', USER_ID, TOPIC_ID);

      expect(results.length).toBe(2);
      // axios.post must NOT have been called due to active cooldown
      expect(postSpy).not.toHaveBeenCalled();
    });

    it('filters out low-relevance matches below RAG_RERANK_MIN_RELEVANCE (0.30)', async () => {
      const files = [
        { id: 'f-1', file_name: 'error.log', original_content: 'critical memory leak error' },
        { id: 'f-2', file_name: 'other.log', original_content: 'unrelated background process error' },
      ];

      vi.spyOn(supabase, 'from').mockImplementation(() => makeChain(files));
      vi.spyOn(ragService, 'embedText').mockResolvedValue({
        vector: new Array(1536).fill(0.01),
        tokensUsed: 10,
        space: 'openai-te3-small',
      });
      vi.spyOn(supabase, 'rpc').mockResolvedValue({ data: [], error: null });

      vi.spyOn(axios, 'post').mockResolvedValue({
        data: {
          results: [
            { index: 0, relevance_score: 0.92 },
            { index: 1, relevance_score: 0.15 }, // below 0.30 threshold
          ],
          meta: { billed_units: { search_units: 1 } },
        },
      });

      const { results } = await searchUserFilesRAG('critical memory leak error', USER_ID, TOPIC_ID);

      // Low relevance candidate (0.15) should be filtered out
      expect(results.length).toBe(1);
      expect(results[0].file_id).toBe('f-1');
      expect(results[0].rerankScore).toBe(0.92);
    });
  });

  describe('buildRAGContext reranking', () => {
    it('reranks context docs with Cohere and falls back cleanly on 429', async () => {
      const mockDocs = [
        { id: 'doc-1', title: 'File 1', content: 'system crash failure in database storage engine', similarity: 0.85 },
        { id: 'doc-2', title: 'File 2', content: 'system crash failure in network interface', similarity: 0.80 },
      ];

      vi.spyOn(supabase, 'rpc').mockResolvedValue({ data: mockDocs, error: null });

      // Simulate 429
      const err429 = new Error('Rate limit exceeded 429');
      err429.response = { status: 429 };
      vi.spyOn(axios, 'post').mockRejectedValue(err429);

      const dummyVector = new Array(1536).fill(0.01);
      const context = await buildRAGContext('system crash failure', 'openrouter', null, dummyVector, {
        topicId: TOPIC_ID,
        userId: USER_ID,
        embeddingSpace: 'openai-te3-small',
      });

      // Context block should still be generated with un-reranked similarity docs
      expect(context).toContain('[KNOWLEDGE BASE CONTEXT]');
      expect(context).toContain('File 1');
      expect(cohereService.isCohereRateLimited()).toBe(true);
    });
  });

  describe('searchRelevantDocs reranking', () => {
    it('cross-encoder reranks search results and promotes best match', async () => {
      const mockRows = [
        { id: '1', title: 'A', content: 'system crash failure in storage engine', similarity: 0.8 },
        { id: '2', title: 'B', content: 'system crash failure root cause analysis', similarity: 0.7 },
      ];

      vi.spyOn(supabase, 'rpc').mockResolvedValue({ data: mockRows, error: null });

      vi.spyOn(axios, 'post').mockImplementation(async (url) => {
        if (url.includes('embeddings')) {
          return {
            data: {
              data: [{ embedding: new Array(1536).fill(0.01) }],
              usage: { prompt_tokens: 15 },
            },
          };
        }
        // Cohere rerank endpoint
        return {
          data: {
            results: [
              { index: 1, relevance_score: 0.95 },
              { index: 0, relevance_score: 0.40 },
            ],
            meta: { billed_units: { search_units: 1 } },
          },
        };
      });

      const docs = await searchRelevantDocs('system crash failure', 2, 0.3, 'openrouter', null, USER_ID, TOPIC_ID);

      expect(docs.length).toBe(2);
      expect(docs[0].id).toBe('2');
      expect(docs[0].rerankScore).toBe(0.95);
    });

    it('falls back cleanly to hybrid search when Cohere returns 429', async () => {
      const mockRows = [
        { id: '1', title: 'A', content: 'system crash failure in storage engine', similarity: 0.85 },
        { id: '2', title: 'B', content: 'system crash failure root cause analysis', similarity: 0.75 },
      ];

      vi.spyOn(supabase, 'rpc').mockResolvedValue({ data: mockRows, error: null });

      vi.spyOn(axios, 'post').mockImplementation(async (url) => {
        if (url.includes('embeddings')) {
          return {
            data: {
              data: [{ embedding: new Array(1536).fill(0.01) }],
              usage: { prompt_tokens: 15 },
            },
          };
        }
        // Cohere returns 429
        const err429 = new Error('Rate limit exceeded');
        err429.response = { status: 429 };
        throw err429;
      });

      const docs = await searchRelevantDocs('system crash failure', 2, 0.3, 'openrouter', null, USER_ID, TOPIC_ID);

      // Successfully falls back to hybrid ordering without throwing
      expect(docs.length).toBeGreaterThan(0);
      expect(cohereService.isCohereRateLimited()).toBe(true);
    });
  });
});
