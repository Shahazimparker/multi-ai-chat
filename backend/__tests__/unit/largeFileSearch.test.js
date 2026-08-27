// FILE: backend/__tests__/unit/largeFileSearch.test.js
// PURPOSE: Verify that large files (e.g. 18MB logs) with truncated Postgres content
//          are fully searchable and readable via paginated rag_chunks reassembly
//          and Vercel Blob fallback, and that buildRAGContext does not discard granular chunks.

const supabase = require('../../config/supabase');
const blobStorage = require('../../services/blobStorage.service');
const ragService = require('../../services/rag.service');
const {
  resolveFullFileContent,
  searchUserFilesRAG,
  getFileContent,
  getFileContentById,
} = require('../../services/fileUpload.service');

const makeChain = (data) => {
  const chain = {
    select: vi.fn(() => chain),
    eq: vi.fn(() => chain),
    ilike: vi.fn(() => chain),
    order: vi.fn(() => chain),
    limit: vi.fn(() => chain),
    maybeSingle: vi.fn(() => Promise.resolve({ data: Array.isArray(data) ? data[0] : data, error: null })),
    single: vi.fn(() => Promise.resolve({ data: Array.isArray(data) ? data[0] : data, error: null })),
    range: vi.fn(() => Promise.resolve({ data: Array.isArray(data) ? data : [data], error: null })),
    then: (resolve, reject) => Promise.resolve({ data: Array.isArray(data) ? data : [data], error: null }).then(resolve, reject),
  };
  return chain;
};

describe('Large File Search & Reassembly', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    process.env.BLOB_READ_WRITE_TOKEN = 'test-blob-token';
    // Stub embedText so tests don't make real outbound network requests
    vi.spyOn(ragService, 'embedText').mockResolvedValue(null);
  });

  afterEach(() => {
    delete process.env.BLOB_READ_WRITE_TOKEN;
  });

  describe('resolveFullFileContent', () => {
    it('fetches full text from Vercel Blob when blob_url is present', async () => {
      const blobSpy = vi.spyOn(blobStorage, 'fetchPrivateBlobBuffer').mockResolvedValueOnce(
        Buffer.from('Line 1: init\nLine 2: running\nLine 3: process killed by SIGKILL')
      );

      const record = {
        id: 'blob-file-1',
        file_name: 'server.log',
        blob_url: 'https://blob.vercel-storage.com/uploads/server.log',
        original_content: 'Line 1: init\n\n... [Truncated for RPC storage: 18000000 chars total] ...',
      };

      const result = await resolveFullFileContent(record, 'user-123');
      expect(blobSpy).toHaveBeenCalledWith(record.blob_url);
      expect(result).toContain('process killed by SIGKILL');
    });

    it('decodes base64 from original_file_data if available', async () => {
      const b64Data = Buffer.from('Database server crashed with OOM killer').toString('base64');
      const record = {
        id: 'db-file-1',
        file_name: 'crash.log',
        original_file_data: b64Data,
        original_content: 'Truncated...',
      };

      const result = await resolveFullFileContent(record, 'user-123');
      expect(result).toBe('Database server crashed with OOM killer');
    });

    it('returns non-truncated original_content directly without database queries', async () => {
      const fromSpy = vi.spyOn(supabase, 'from');
      const record = {
        id: 'small-file-1',
        file_name: 'app.log',
        original_content: 'Normal small log without truncation',
      };

      const result = await resolveFullFileContent(record, 'user-123');
      expect(result).toBe('Normal small log without truncation');
      expect(fromSpy).not.toHaveBeenCalled();
    });

    it('reassembles chunks across multiple pages (>1000 chunks) from rag_chunks when truncated', async () => {
      const record = {
        id: 'rag-file-1',
        file_name: 'big_system.log',
        original_content: 'Line 1...\n\n... [Truncated for RPC storage: 18000000 chars total] ...',
      };

      // Page 1: 1000 chunks
      const page1Chunks = Array.from({ length: 1000 }, (_, i) => ({
        chunk_text: `Chunk ${i} info\n`,
        chunk_index: i,
      }));
      // Page 2: 250 chunks with the critical "killed" event in chunk 1200
      const page2Chunks = Array.from({ length: 250 }, (_, i) => ({
        chunk_text: i === 200 ? 'CRITICAL: process 9999 killed by OOM killer\n' : `Chunk ${1000 + i} info\n`,
        chunk_index: 1000 + i,
      }));

      const mockRangeFn = vi.fn()
        .mockResolvedValueOnce({ data: page1Chunks, error: null }) // from=0, 1000 rows
        .mockResolvedValueOnce({ data: page2Chunks, error: null }); // from=1000, 250 rows

      vi.spyOn(supabase, 'from').mockImplementation((table) => {
        if (table === 'uploaded_files') {
          const chain = makeChain({ id: 'u-file-uuid' });
          return chain;
        }
        if (table === 'rag_chunks') {
          const chain = {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            order: vi.fn().mockReturnThis(),
            range: mockRangeFn,
          };
          return chain;
        }
        return makeChain([]);
      });

      const result = await resolveFullFileContent(record, 'user-123');

      expect(mockRangeFn).toHaveBeenCalledTimes(2);
      expect(mockRangeFn).toHaveBeenNthCalledWith(1, 0, 999);
      expect(mockRangeFn).toHaveBeenNthCalledWith(2, 1000, 1999);
      expect(result).toContain('CRITICAL: process 9999 killed by OOM killer');
    });
  });

  describe('searchUserFilesRAG', () => {
    it('finds "killed" at high line numbers in truncated files by resolving full content', async () => {
      // Create a 5,000-line simulated text where "killed" is at line 4,500
      const lines = [];
      for (let i = 1; i <= 5000; i++) {
        if (i === 4500) {
          lines.push('Aug 27 12:00:00 host kernel: Out of memory: Kill process 12345 (mysqld) score 950 or sacrifice child');
        } else {
          lines.push(`Aug 27 11:00:00 host app[${i}]: normal operational heartbeat line`);
        }
      }
      const fullText = lines.join('\n');

      vi.spyOn(blobStorage, 'fetchPrivateBlobBuffer').mockResolvedValueOnce(Buffer.from(fullText));

      const fileRecord = {
        id: 'file-18mb',
        file_name: 'production_kernel.log',
        original_content: 'Aug 27 11:00:00 host app[1]: normal operational heartbeat line\n\n... [Truncated for RPC storage: 18000000 chars total] ...',
        blob_url: 'https://blob.vercel-storage.com/uploads/production_kernel.log',
      };

      vi.spyOn(supabase, 'from').mockImplementation((table) => {
        if (table === 'uploaded_files_rag') {
          return makeChain([fileRecord]);
        }
        return makeChain([]);
      });

      const { results } = await searchUserFilesRAG('kill process', 'user-1', 'topic-1');

      expect(results.length).toBeGreaterThan(0);
      expect(results[0].chunk_text).toContain('Kill process 12345');
      expect(results[0].chunk_text).toContain('Lines 4496 to 4505');
    });
  });

  describe('getFileContent', () => {
    it('downloads from Vercel Blob even when original_content has truncated stub', async () => {
      const fullBlobLog = 'Line 1: startup\nLine 10000: fatal database crash error';
      vi.spyOn(blobStorage, 'fetchPrivateBlobBuffer').mockResolvedValueOnce(Buffer.from(fullBlobLog));

      const fileRecord = {
        id: 'uuid-1',
        file_name: 'crash.log',
        blob_url: 'https://blob.vercel-storage.com/crash.log',
        original_content: 'Line 1: startup\n\n... [Truncated for RPC storage: 18000000 chars total] ...',
      };

      vi.spyOn(supabase, 'from').mockReturnValue(makeChain([fileRecord]));

      const fileData = await getFileContent('uuid-1', 'user-1', 'topic-1');
      expect(fileData).not.toBeNull();
      expect(fileData.original_content).toBe(fullBlobLog);
    });
  });

  describe('getFileContentById', () => {
    it('downloads from Vercel Blob using file ID', async () => {
      const fullBlobLog = 'Line 1: system boot\nLine 5000: worker killed';
      vi.spyOn(blobStorage, 'fetchPrivateBlobBuffer').mockResolvedValueOnce(Buffer.from(fullBlobLog));

      const fileRecord = {
        id: 'uuid-2',
        file_name: 'app.log',
        blob_url: 'https://blob.vercel-storage.com/app.log',
        original_content: 'Line 1: system boot\n\n... [Truncated for RPC storage: 18000000 chars total] ...',
      };

      vi.spyOn(supabase, 'from').mockReturnValue(makeChain(fileRecord));

      const fileData = await getFileContentById('uuid-2', 'user-1');
      expect(fileData).not.toBeNull();
      expect(fileData.original_content).toBe(fullBlobLog);
    });
  });

  describe('buildRAGContext preview stub replacement', () => {
    it('does not let 1000-character preview stub suppress matching granular chunks', async () => {
      const { buildRAGContext } = require('../../services/rag.service');
      const dummyVector = new Array(1536).fill(0.01);

      // match_topic_files returns preview stub for big_server.log
      const previewDoc = {
        id: 'file-1',
        title: 'big_server.log',
        content: 'File: big_server.log (txt)\nContent length: 18000000 characters\nPreview:\n[Boot lines]\nFile ready for queries.',
        similarity: 0.85,
      };

      // search_uploaded_files returns real granular chunk with crash/kill line
      const granularChunk = {
        file_id: 'file-1',
        file_name: 'big_server.log',
        chunk_index: 1800,
        chunk_text: 'ERROR 180001: process killed by kernel OOM killer on worker 4',
        similarity: 0.95,
      };

      vi.spyOn(supabase, 'rpc').mockImplementation((fn) => {
        if (fn === 'match_topic_files') return Promise.resolve({ data: [previewDoc], error: null });
        if (fn === 'search_uploaded_files') return Promise.resolve({ data: [granularChunk], error: null });
        return Promise.resolve({ data: [], error: null });
      });

      const context = await buildRAGContext('process killed', 'openrouter', null, dummyVector, {
        topicId: 'topic-1',
        userId: 'user-1',
        embeddingSpace: 'openai-te3-small',
      });

      // Must include the granular chunk and drop the uninformative preview stub
      expect(context).toContain('process killed by kernel OOM killer');
      expect(context).not.toContain('File ready for queries.');
    });
  });

  describe('extractDiagnosticDigest', () => {
    it('always preserves fatal/kill events anywhere in large logs even if hundreds of minor errors precede it', () => {
      const { extractDiagnosticDigest } = require('../../services/toolProcessor.service');

      // Construct a 5,000-line log where lines 100-200 have 50 minor errors,
      // and line 4,200 has a fatal process kill
      const lines = [];
      for (let i = 1; i <= 5000; i++) {
        if (i >= 100 && i <= 150) {
          lines.push(`2026-08-27 10:00:${i % 60} [WARN] connection refused by downstream peer (attempt ${i})`);
        } else if (i === 4200) {
          lines.push('2026-08-27 14:32:10 kernel: [123456.78] Out of memory: Kill process 99999 (mysqld) score 950 or sacrifice child');
        } else {
          lines.push(`2026-08-27 11:00:00 normal system line ${i}`);
        }
      }
      const rawText = lines.join('\n');

      const digest = extractDiagnosticDigest(rawText, 'production_server.log');

      // The fatal process kill at line 4200 must be in the digest
      expect(digest).toContain('Out of memory: Kill process 99999 (mysqld)');
      expect(digest).toContain('around Line 4200 - FATAL');
      expect(digest).toContain('FATAL CRASH/KILL INCIDENTS DETECTED');
    });
  });
});

