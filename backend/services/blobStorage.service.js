let blobClient = require('@vercel/blob');

/**
 * For testing / custom client injection
 */
const setBlobClient = (client) => {
  blobClient = client || require('@vercel/blob');
};

/**
 * Checks if Vercel Blob credentials are configured
 */
const isBlobConfigured = () => {
  return Boolean(process.env.BLOB_READ_WRITE_TOKEN);
};

/**
 * Fetch a private blob and return as a Node.js Buffer (for text extraction / OCR)
 * @param {string} blobUrl - Full URL of the private blob
 * @returns {Promise<Buffer>}
 */
const fetchPrivateBlobBuffer = async (blobUrl) => {
  if (!blobUrl) {
    throw new Error('blobUrl is required');
  }
  if (!isBlobConfigured()) {
    throw new Error('BLOB_READ_WRITE_TOKEN is not configured');
  }

  const blobResult = await blobClient.get(blobUrl, { access: 'private' });
  if (!blobResult || !blobResult.stream) {
    throw new Error(`Failed to fetch blob stream from: ${blobUrl}`);
  }

  const chunks = [];
  for await (const chunk of blobResult.stream) {
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
};

/**
 * Fetch a private blob result containing stream and metadata
 * @param {string} blobUrl
 * @returns {Promise<{ stream: ReadableStream, contentType: string, size: number }>}
 */
const fetchPrivateBlobStream = async (blobUrl) => {
  if (!blobUrl) {
    throw new Error('blobUrl is required');
  }
  if (!isBlobConfigured()) {
    throw new Error('BLOB_READ_WRITE_TOKEN is not configured');
  }

  return await blobClient.get(blobUrl, { access: 'private' });
};

/**
 * Safely delete a blob from Vercel Blob store
 * @param {string} blobUrl
 */
const deleteBlobFromStorage = async (blobUrl) => {
  if (!blobUrl || !isBlobConfigured()) return;
  try {
    await blobClient.del(blobUrl);
    console.log(`[BlobStorage] Deleted blob: ${blobUrl}`);
  } catch (err) {
    console.warn(`[BlobStorage] Failed to delete blob ${blobUrl}:`, err.message);
  }
};

/**
 * Retrieve blob metadata (content-type, size, etag) without downloading
 * @param {string} blobUrl
 */
const getBlobMetadata = async (blobUrl) => {
  if (!blobUrl || !isBlobConfigured()) return null;
  try {
    return await blobClient.head(blobUrl);
  } catch (err) {
    console.warn(`[BlobStorage] Failed to get blob head for ${blobUrl}:`, err.message);
    return null;
  }
};

/**
 * Validates that a blob URL comes from an authorized Vercel Blob hostname and matches expected path prefixes.
 * @param {string} blobUrl
 * @param {string[]} [allowedPrefixes] - e.g. ['uploads/', 'knowledge/']
 * @returns {boolean}
 */
const isValidVercelBlobUrl = (blobUrl, allowedPrefixes = []) => {
  if (!blobUrl || typeof blobUrl !== 'string') return false;
  try {
    const parsed = new URL(blobUrl);
    const host = parsed.hostname.toLowerCase();
    const isVercelHost = host.endsWith('.blob.vercel-storage.com') || host === 'blob.vercel-storage.com';
    if (!isVercelHost) return false;

    if (allowedPrefixes && allowedPrefixes.length > 0) {
      const pathname = parsed.pathname.replace(/^\/+/, '');
      const matchesPrefix = allowedPrefixes.some(prefix => pathname.startsWith(prefix));
      if (!matchesPrefix) return false;
    }
    return true;
  } catch {
    return false;
  }
};

module.exports = {
  isBlobConfigured,
  isValidVercelBlobUrl,
  fetchPrivateBlobBuffer,
  fetchPrivateBlobStream,
  deleteBlobFromStorage,
  getBlobMetadata,
  setBlobClient,
};
