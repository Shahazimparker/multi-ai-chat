// vitest globals: describe, it, expect, vi, beforeEach, afterEach
const blobService = require('../../services/blobStorage.service');

describe('blobStorage.service', () => {
  const originalEnv = process.env.BLOB_READ_WRITE_TOKEN;
  let mockBlobClient;

  beforeEach(() => {
    mockBlobClient = {
      get: vi.fn(),
      del: vi.fn(),
      head: vi.fn(),
    };
    blobService.setBlobClient(mockBlobClient);
    process.env.BLOB_READ_WRITE_TOKEN = 'test_token_123';
  });

  afterEach(() => {
    process.env.BLOB_READ_WRITE_TOKEN = originalEnv;
    blobService.setBlobClient(null);
  });

  it('isBlobConfigured returns true when token is present', () => {
    expect(blobService.isBlobConfigured()).toBe(true);
  });

  it('isBlobConfigured returns false when token is absent', () => {
    delete process.env.BLOB_READ_WRITE_TOKEN;
    expect(blobService.isBlobConfigured()).toBe(false);
  });

  it('fetchPrivateBlobBuffer downloads and aggregates stream chunks', async () => {
    const chunk1 = Buffer.from('Hello ');
    const chunk2 = Buffer.from('World!');

    async function* makeStream() {
      yield chunk1;
      yield chunk2;
    }

    mockBlobClient.get.mockResolvedValueOnce({
      stream: makeStream(),
      contentType: 'text/plain',
    });

    const buffer = await blobService.fetchPrivateBlobBuffer('https://blob.vercel-storage.com/test.txt');

    expect(mockBlobClient.get).toHaveBeenCalledWith('https://blob.vercel-storage.com/test.txt', { access: 'private' });
    expect(buffer.toString('utf-8')).toBe('Hello World!');
  });

  it('deleteBlobFromStorage calls del with blobUrl', async () => {
    mockBlobClient.del.mockResolvedValueOnce(undefined);

    await blobService.deleteBlobFromStorage('https://blob.vercel-storage.com/delete-me.pdf');

    expect(mockBlobClient.del).toHaveBeenCalledWith('https://blob.vercel-storage.com/delete-me.pdf');
  });

  describe('isValidVercelBlobUrl', () => {
    it('validates authentic Vercel Blob URLs with allowed prefixes', () => {
      expect(blobService.isValidVercelBlobUrl('https://multi-chat-upload-storage.bom1.blob.vercel-storage.com/uploads/topic-1/123_doc.pdf', ['uploads/'])).toBe(true);
      expect(blobService.isValidVercelBlobUrl('https://blob.vercel-storage.com/knowledge/col-1/123_doc.pdf', ['knowledge/'])).toBe(true);
      expect(blobService.isValidVercelBlobUrl('https://blob.vercel-storage.com/uploads/topic-1/123_doc.pdf')).toBe(true);
    });

    it('rejects external or unapproved domains and prefixes', () => {
      expect(blobService.isValidVercelBlobUrl('https://evil.com/uploads/doc.pdf', ['uploads/'])).toBe(false);
      expect(blobService.isValidVercelBlobUrl('https://blob.vercel-storage.com/system/passwords.txt', ['uploads/'])).toBe(false);
      expect(blobService.isValidVercelBlobUrl('not-a-url', ['uploads/'])).toBe(false);
      expect(blobService.isValidVercelBlobUrl(null)).toBe(false);
    });
  });
});
