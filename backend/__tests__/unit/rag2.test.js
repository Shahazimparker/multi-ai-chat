// ============================================================
// FILE: backend/__tests__/unit/rag2.test.js
// PURPOSE: Unit tests for RAG 2.0 Engine & Crawler
// ============================================================

const supabase = require('../../config/supabase');
const ragService = require('../../services/rag.service');
const rag2Service = require('../../services/rag2.service');
const {
  htmlToCleanText,
  extractTitle,
  extractInternalLinks,
} = require('../../services/knowledgeCrawler.service');

const VALID_UUID_1 = '11111111-1111-1111-1111-111111111111';
const VALID_UUID_DOC = '22222222-2222-2222-2222-222222222222';
const VALID_UUID_USER = '33333333-3333-3333-3333-333333333333';
const VALID_UUID_2 = '44444444-4444-4444-4444-444444444444';

// searchKnowledgeCollections first reads each collection’s embedding_provider
// so it can group the search by model, then reads the indexed documents of those
// collections for the prompt manifest. Stub both lookups.
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

describe('RAG 2.0 Engine', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  describe('createParentChildChunks', () => {
    it('returns empty array for empty text', () => {
      expect(rag2Service.createParentChildChunks('')).toEqual([]);
      expect(rag2Service.createParentChildChunks('   ')).toEqual([]);
    });

    it('creates chunks with parent context window and metadata', () => {
      const sampleText = `
# System Architecture Overview
This document outlines the core architecture of the multi-agent chatbot system.
It uses microservices for ingestion and PostgreSQL pgvector for fast similarity lookups.

## Indexing Pipeline
The indexing pipeline breaks documents down into small chunks for high vector fidelity.
Each chunk retains a pointer to its surrounding parent context so the LLM receives the full picture.
`.trim();

      const chunks = rag2Service.createParentChildChunks(sampleText, 'Architecture Guide');
      expect(chunks.length).toBeGreaterThan(0);
      expect(chunks[0]).toHaveProperty('chunkText');
      expect(chunks[0]).toHaveProperty('parentText');
      expect(chunks[0]).toHaveProperty('index', 0);
      expect(chunks[0].metadata).toHaveProperty('documentTitle', 'Architecture Guide');
      expect(chunks[0].metadata).toHaveProperty('tokens');
      expect(chunks[0].metadata).toHaveProperty('parentTokens');
    });

    it('extracts section headings in chunk metadata', () => {
      const sample = `# Introduction to Microservices\nThis is the introductory section explaining concepts.`;
      const chunks = rag2Service.createParentChildChunks(sample, 'Microservices Intro');
      expect(chunks[0].metadata.sectionTitle).toBe('Introduction to Microservices');
    });
  });

  describe('extractCollectionMentions', () => {
    it('extracts single and multiple collection mentions', () => {
      const query = 'What is our deployment process? @Engineering @DevOps_Docs';
      const mentions = rag2Service.extractCollectionMentions(query);
      expect(mentions).toEqual(['Engineering', 'DevOps_Docs']);
    });

    it('extracts quoted collection names with spaces', () => {
      const query = 'How do we request time off? @"HR Policies 2026"';
      const mentions = rag2Service.extractCollectionMentions(query);
      expect(mentions).toEqual(['HR Policies 2026']);
    });

    it('filters out reserved keywords like @all and @web', () => {
      const query = 'Check this @all @web @Backend_Architecture';
      const mentions = rag2Service.extractCollectionMentions(query);
      expect(mentions).toEqual(['Backend_Architecture']);
    });
  });

  describe('searchKnowledgeCollections', () => {
    it('returns empty context if no query or userId', async () => {
      const res = await rag2Service.searchKnowledgeCollections({ query: '', userId: VALID_UUID_USER });
      expect(res.context).toBe('');
      expect(res.citations).toEqual([]);
    });

    it('processes matched chunks, performs hybrid ranking, and generates citations', async () => {
      mockCollectionScope([{ id: VALID_UUID_1, embedding_provider: 'openrouter' }]);
      vi.spyOn(ragService, 'embedText').mockResolvedValue({
        vector: new Array(1536).fill(0.01),
        tokensUsed: 25,
      });

      vi.spyOn(supabase, 'rpc').mockResolvedValue({
        data: [
          {
            chunk_id: VALID_UUID_1,
            document_id: VALID_UUID_DOC,
            collection_id: VALID_UUID_1,
            collection_name: 'Engineering',
            document_title: 'API_Specs.md',
            source_type: 'file',
            source_url: null,
            chunk_text: 'POST /api/chat/stream streams SSE tokens to the client.',
            parent_text: 'The streaming API endpoint is located at POST /api/chat/stream and provides real-time SSE chunks.',
            similarity: 0.88,
            chunk_metadata: { sectionTitle: 'Streaming API' },
          },
        ],
        error: null,
      });

      const result = await rag2Service.searchKnowledgeCollections({
        query: 'How does streaming API work?',
        collectionIds: [VALID_UUID_1],
        userId: VALID_UUID_USER,
      });

      expect(result.chunkCount).toBe(1);
      expect(result.citations.length).toBe(1);
      expect(result.citations[0]).toMatchObject({
        citationId: 1,
        documentTitle: 'API_Specs.md',
        collectionName: 'Engineering',
        sectionTitle: 'Streaming API',
      });
      expect(result.context).toContain('## KNOWLEDGE BASE RETRIEVAL (RAG 2.0)');
      expect(result.context).toContain('[SOURCE 1: "API_Specs.md"');
    });

    // A query vector is only comparable to chunks embedded by the same model,
    // so collections indexed under different providers must not share one.
    it('embeds and searches once per collection embedding provider', async () => {
      mockCollectionScope([
        { id: VALID_UUID_1, embedding_provider: 'openrouter' },
        { id: VALID_UUID_2, embedding_provider: 'gemini' },
      ]);

      const embedSpy = vi.spyOn(ragService, 'embedText').mockResolvedValue({
        vector: new Array(1536).fill(0.01),
        tokensUsed: 25,
      });
      const rpcSpy = vi.spyOn(supabase, 'rpc').mockResolvedValue({ data: [], error: null });

      await rag2Service.searchKnowledgeCollections({
        query: 'How does billing work?',
        collectionIds: [VALID_UUID_1, VALID_UUID_2],
        userId: VALID_UUID_USER,
      });

      const providersUsed = embedSpy.mock.calls.map((call) => call[1]);
      expect(providersUsed).toEqual(['openrouter', 'gemini']);

      // Both groups come back empty, which triggers one relaxed retry pass, so
      // each group is queried twice — once at the floor, once at the fallback.
      expect(rpcSpy).toHaveBeenCalledTimes(4);
      const groups = rpcSpy.mock.calls.map((call) => call[1].collection_ids);
      expect(groups).toEqual([[VALID_UUID_1], [VALID_UUID_2], [VALID_UUID_1], [VALID_UUID_2]]);
      const thresholds = rpcSpy.mock.calls.map((call) => call[1].match_threshold);
      expect(thresholds).toEqual([0.25, 0.25, 0, 0]);
    });

    // One provider being down must not take the other collections with it.
    it('skips a provider group whose query embedding fails', async () => {
      mockCollectionScope([
        { id: VALID_UUID_1, embedding_provider: 'openrouter' },
        { id: VALID_UUID_2, embedding_provider: 'gemini' },
      ]);

      vi.spyOn(ragService, 'embedText').mockImplementation(async (_text, provider) => {
        if (provider === 'gemini') throw new Error('gemini embedding endpoint down');
        return { vector: new Array(1536).fill(0.01), tokensUsed: 25 };
      });
      const rpcSpy = vi.spyOn(supabase, 'rpc').mockResolvedValue({ data: [], error: null });

      await rag2Service.searchKnowledgeCollections({
        query: 'How does billing work?',
        collectionIds: [VALID_UUID_1, VALID_UUID_2],
        userId: VALID_UUID_USER,
      });

      // Only the healthy group is searched — twice, since it matched nothing.
      expect(rpcSpy).toHaveBeenCalledTimes(2);
      expect(rpcSpy.mock.calls[0][1].collection_ids).toEqual([VALID_UUID_1]);
      expect(rpcSpy.mock.calls[1][1].collection_ids).toEqual([VALID_UUID_1]);
    });

    // An overview question ("what is in here?") shares no vocabulary with the
    // documents it asks about, so it can match nothing. The prompt must still
    // say which collections are attached and what they hold, otherwise the model
    // answers that it was given no knowledge base at all.
    it('still describes the attached collections when nothing matches', async () => {
      mockCollectionScope(
        [{ id: VALID_UUID_1, name: 'TEST', embedding_provider: 'openrouter' }],
        [{
          id: VALID_UUID_DOC,
          collection_id: VALID_UUID_1,
          title: 'drawio-cheatsheet.md',
          source_type: 'file',
          source_url: null,
          chunk_count: 12,
        }],
      );
      vi.spyOn(ragService, 'embedText').mockResolvedValue({
        vector: new Array(1536).fill(0.01),
        tokensUsed: 25,
      });
      vi.spyOn(supabase, 'rpc').mockResolvedValue({ data: [], error: null });

      const result = await rag2Service.searchKnowledgeCollections({
        query: 'what do you see in this knowledge base',
        collectionIds: [VALID_UUID_1],
        userId: VALID_UUID_USER,
      });

      expect(result.chunkCount).toBe(0);
      expect(result.context).toContain('Collection "TEST"');
      expect(result.context).toContain('drawio-cheatsheet.md');
      expect(result.context).toContain('You DO have access');
    });
  });
});

describe('Knowledge Web Crawler', () => {
  describe('htmlToCleanText', () => {
    it('strips script, style, and navigation elements while preserving content structure', () => {
      const html = `
        <!DOCTYPE html>
        <html>
          <head>
            <style>body { color: red; }</style>
            <script>console.log("bad");</script>
          </head>
          <body>
            <nav><a href="/home">Home</a></nav>
            <h1>API Reference</h1>
            <p>Welcome to the <strong>API</strong> docs &amp; guides.</p>
            <footer>Copyright 2026</footer>
          </body>
        </html>
      `;
      const text = htmlToCleanText(html);
      expect(text).not.toContain('console.log');
      expect(text).not.toContain('color: red');
      expect(text).toContain('# API Reference');
      expect(text).toContain('Welcome to the API docs & guides.');
    });
  });

  describe('extractTitle', () => {
    it('extracts title tag or fallback h1', () => {
      expect(extractTitle('<html><head><title>System Design Guide</title></head></html>')).toBe('System Design Guide');
      expect(extractTitle('<html><body><h1>Database Schema</h1></body></html>')).toBe('Database Schema');
    });
  });

  describe('extractInternalLinks', () => {
    it('finds internal links on the same host and filters binaries', () => {
      const html = `
        <a href="/docs/getting-started">Getting Started</a>
        <a href="/docs/api#section">API</a>
        <a href="https://external.com/page">External</a>
        <a href="/download/guide.pdf">PDF Download</a>
      `;
      const links = extractInternalLinks(html, 'https://docs.example.com/overview');
      expect(links).toContain('https://docs.example.com/docs/getting-started');
      expect(links).toContain('https://docs.example.com/docs/api');
      expect(links).not.toContain('https://external.com/page');
      expect(links).not.toContain('https://docs.example.com/download/guide.pdf');
    });
  });
});
