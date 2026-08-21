// ============================================================
// FILE: backend/routes/knowledge.routes.js
// PURPOSE: REST API endpoints for Knowledge Base & RAG 2.0
// ============================================================

const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const os = require('os');
const fs = require('fs');

const { requireAuth } = require('../middleware/auth');
const supabase = require('../config/supabase');
const {
  listCollections,
  getCollectionById,
  createCollection,
  updateCollection,
  deleteCollection,
  deleteDocument,
  getDocumentChunks,
} = require('../services/knowledgeCollection.service');
const { crawlWebsite } = require('../services/knowledgeCrawler.service');
const { ingestDocumentContent, searchKnowledgeCollections } = require('../services/rag2.service');
const { loadDocument } = require('../services/documentLoader.service');
const { createVisionCallback } = require('../services/visionExtraction.service');
const { createPdfOcrCallback } = require('../services/pdfOcr.service');
const raptor = require('../services/raptor.service');
const { DEFAULT_PROVIDER } = require('../config/embedding');

// Configure multer for file uploads
const uploadDir = path.join(os.tmpdir(), 'multi-ai-knowledge-uploads');
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}
const upload = multer({
  dest: uploadDir,
  limits: { fileSize: 50 * 1024 * 1024 }, // 50MB per file
});

const handleMulterUpload = (req, res, next) => {
  upload.single('file')(req, res, (err) => {
    if (err instanceof multer.MulterError) {
      if (err.code === 'LIMIT_FILE_SIZE') {
        return res.status(400).json({ error: 'File size exceeds the 50MB limit' });
      }
      return res.status(400).json({ error: `File upload error: ${err.message}` });
    } else if (err) {
      return res.status(400).json({ error: err.message || 'File upload failed' });
    }
    next();
  });
};

const sanitizeFilename = (name) => {
  if (!name || typeof name !== 'string') return 'document.txt';
  let clean = name
    .replace(/[/\\]/g, '_')
    .replace(/\0/g, '')
    .replace(/[\r\n]/g, '')
    .replace(/^[a-zA-Z]:/, '')
    .replace(/\.\./g, '')
    .replace(/["']/g, '');
  clean = clean.replace(/_+/g, '_').replace(/^_|_$/g, '');
  return clean || 'document.txt';
};

// All knowledge endpoints require authentication
router.use(requireAuth);

// ── GET /api/knowledge/collections — list accessible collections ──
router.get('/collections', async (req, res) => {
  try {
    const collections = await listCollections(req.user.id);
    res.json({ collections });
  } catch (err) {
    res.status(500).json({ error: err.message || 'Failed to list collections' });
  }
});

// ── POST /api/knowledge/collections — create collection ──
router.post('/collections', async (req, res) => {
  try {
    const { name, description, icon, color, isPublic } = req.body;
    const collection = await createCollection(req.user.id, {
      name,
      description,
      icon,
      color,
      isPublic: req.user.role === 'admin' ? isPublic : false,
    });
    res.status(201).json({ collection });
  } catch (err) {
    res.status(400).json({ error: err.message || 'Failed to create collection' });
  }
});

// ── GET /api/knowledge/collections/:id — get collection with docs ──
router.get('/collections/:id', async (req, res) => {
  try {
    const collection = await getCollectionById(req.params.id, req.user.id);
    res.json({ collection });
  } catch (err) {
    res.status(404).json({ error: err.message || 'Collection not found' });
  }
});

// ── PUT /api/knowledge/collections/:id — update collection ──
router.put('/collections/:id', async (req, res) => {
  try {
    const collection = await updateCollection(req.params.id, req.user.id, req.body);
    res.json({ collection });
  } catch (err) {
    res.status(400).json({ error: err.message || 'Failed to update collection' });
  }
});

// ── DELETE /api/knowledge/collections/:id — delete collection ──
router.delete('/collections/:id', async (req, res) => {
  try {
    await deleteCollection(req.params.id, req.user.id);
    res.json({ success: true, message: 'Collection deleted successfully' });
  } catch (err) {
    res.status(400).json({ error: err.message || 'Failed to delete collection' });
  }
});

// ── POST /api/knowledge/collections/:id/documents/upload — upload file ──
router.post('/collections/:id/documents/upload', handleMulterUpload, async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'No file uploaded. Please attach a supported file.' });
  }

  const collectionId = req.params.id;
  const tempPath = req.file.path;
  const originalName = sanitizeFilename(req.file.originalname);

  try {
    // 1. Verify collection access
    const collection = await getCollectionById(collectionId, req.user.id);
    if (!collection.isOwner && req.user.role !== 'admin') {
      throw new Error('You do not have write access to this collection');
    }

    // 2. Read and extract content from file
    const fileBuffer = fs.readFileSync(tempPath);
    let extractedText = '';
    const ext = path.extname(originalName).slice(1).toLowerCase();

    try {
      // Without this third argument every image entering a collection became
      // the literal string "[Image: x] - Vision API not available", which was
      // then chunked, embedded, and retrievable as a citable source.
      const loaded = await loadDocument(
        fileBuffer,
        originalName,
        createVisionCallback(),
        createPdfOcrCallback(),
      );
      extractedText = loaded?.content || '';
    } catch (loadErr) {
      // No raw-UTF8 fallback: loadDocument already handles unknown extensions,
      // so a throw here means a real parse failure. Reading the bytes as text
      // would embed binary noise into the vector store instead of erroring.
      throw new Error(`Could not extract text from "${originalName}": ${loadErr.message}`, { cause: loadErr });
    }

    if (!extractedText || !extractedText.trim()) {
      throw new Error('Could not extract text content from uploaded file');
    }

    // 3. Create document record in DB
    const { data: newDoc, error: docError } = await supabase
      .from('knowledge_documents')
      .insert({
        collection_id: collectionId,
        user_id: req.user.id,
        title: originalName,
        source_type: 'file',
        file_type: ext,
        file_size: req.file.size,
        status: 'processing',
      })
      .select()
      .single();

    if (docError) throw docError;

    // 4. Ingest and chunk into knowledge_chunks
    const ingestResult = await ingestDocumentContent({
      documentId: newDoc.id,
      collectionId,
      userId: req.user.id,
      title: originalName,
      content: extractedText,
      embedProvider: collection.embedding_provider || 'openrouter',
    });

    res.status(201).json({
      success: true,
      document: {
        ...newDoc,
        status: 'indexed',
        chunk_count: ingestResult.chunkCount,
      },
    });
  } catch (err) {
    console.error('[KnowledgeRoute] Upload error:', err.message);
    res.status(500).json({ error: err.message || 'File ingestion failed' });
  } finally {
    try {
      if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath);
    } catch { /* clean up */ }
  }
});

// ── POST /api/knowledge/collections/:id/documents/crawl — crawl URL ──
router.post('/collections/:id/documents/crawl', async (req, res) => {
  const collectionId = req.params.id;
  const { url, maxDepth = 2, maxPages = 15 } = req.body;

  if (!url || !url.trim()) {
    return res.status(400).json({ error: 'URL is required' });
  }

  try {
    // 1. Verify collection access
    const collection = await getCollectionById(collectionId, req.user.id);
    if (!collection.isOwner && req.user.role !== 'admin') {
      throw new Error('You do not have write access to this collection');
    }

    // 2. Perform crawl
    const crawledPages = await crawlWebsite(url.trim(), { maxDepth, maxPages });
    if (crawledPages.length === 0) {
      return res.status(400).json({ error: `Could not crawl or extract pages from "${url}"` });
    }

    // 3. Ingest each crawled page as a knowledge document
    const ingestedDocs = [];
    for (const page of crawledPages) {
      const { data: newDoc, error: docError } = await supabase
        .from('knowledge_documents')
        .insert({
          collection_id: collectionId,
          user_id: req.user.id,
          title: page.title || page.url,
          source_type: 'web_crawl',
          source_url: page.url,
          file_size: page.byteSize,
          doc_metadata: { depth: page.depth },
          status: 'processing',
        })
        .select()
        .single();

      if (docError) continue;

      try {
        await ingestDocumentContent({
          documentId: newDoc.id,
          collectionId,
          userId: req.user.id,
          title: page.title,
          content: page.text,
          embedProvider: collection.embedding_provider || 'openrouter',
        });
        ingestedDocs.push(newDoc);
      } catch (err) {
        console.warn(`[KnowledgeRoute] Failed to ingest crawled page ${page.url}:`, err.message);
      }
    }

    res.json({
      success: true,
      totalPagesCrawled: crawledPages.length,
      indexedCount: ingestedDocs.length,
      documents: ingestedDocs,
    });
  } catch (err) {
    console.error('[KnowledgeRoute] Crawl error:', err.message);
    res.status(500).json({ error: err.message || 'Crawl ingestion failed' });
  }
});

// ── POST /api/knowledge/collections/:id/documents/text — add text snippet ──
router.post('/collections/:id/documents/text', async (req, res) => {
  const collectionId = req.params.id;
  const { title, content } = req.body;

  if (!title || !title.trim()) return res.status(400).json({ error: 'Title is required' });
  if (!content || !content.trim()) return res.status(400).json({ error: 'Content is required' });

  try {
    const collection = await getCollectionById(collectionId, req.user.id);
    if (!collection.isOwner && req.user.role !== 'admin') {
      throw new Error('You do not have write access to this collection');
    }

    const { data: newDoc, error: docError } = await supabase
      .from('knowledge_documents')
      .insert({
        collection_id: collectionId,
        user_id: req.user.id,
        title: title.trim(),
        source_type: 'raw_text',
        file_size: Buffer.byteLength(content, 'utf8'),
        status: 'processing',
      })
      .select()
      .single();

    if (docError) throw docError;

    const ingestResult = await ingestDocumentContent({
      documentId: newDoc.id,
      collectionId,
      userId: req.user.id,
      title: title.trim(),
      content: content.trim(),
      embedProvider: collection.embedding_provider || 'openrouter',
    });

    res.status(201).json({
      success: true,
      document: {
        ...newDoc,
        status: 'indexed',
        chunk_count: ingestResult.chunkCount,
      },
    });
  } catch (err) {
    console.error('[KnowledgeRoute] Text ingestion error:', err.message);
    res.status(500).json({ error: err.message || 'Text ingestion failed' });
  }
});

// ── DELETE /api/knowledge/documents/:id — delete document ──
router.delete('/documents/:id', async (req, res) => {
  try {
    await deleteDocument(req.params.id, req.user.id);
    res.json({ success: true, message: 'Document deleted' });
  } catch (err) {
    res.status(400).json({ error: err.message || 'Failed to delete document' });
  }
});

// ── GET /api/knowledge/documents/:id/chunks — inspect chunks ──
router.get('/documents/:id/chunks', async (req, res) => {
  try {
    const data = await getDocumentChunks(req.params.id, req.user.id);
    res.json(data);
  } catch (err) {
    res.status(400).json({ error: err.message || 'Failed to get document chunks' });
  }
});

// ── POST /api/knowledge/documents/:id/build-tree — RAPTOR summary tree ──
//
// Vercel's function ceiling is the binding constraint here, so the build runs
// against a deadline and reports whether it finished. When `stopped` is true
// the tree is partially built and calling again RESUMES from that level rather
// than starting over — so a document larger than one invocation can allow is
// still completable by repeating the call.
router.post('/documents/:id/build-tree', async (req, res) => {
  try {
    const documentId = req.params.id;

    // Ownership check mirrors getDocumentChunks: the document row carries
    // user_id, so a collection lookup is not needed to authorise.
    const { data: doc } = await supabase
      .from('knowledge_documents')
      .select('id, title, collection_id, user_id, status, knowledge_collections(embedding_provider)')
      .eq('id', documentId)
      .single();

    if (!doc || doc.user_id !== req.user.id) {
      return res.status(404).json({ error: 'Document not found or unauthorized' });
    }
    if (doc.status !== 'indexed') {
      return res.status(400).json({ error: `Document is "${doc.status}", not indexed` });
    }

    // Leave headroom under the platform limit for the response itself; a build
    // killed mid-insert would leave the tree in a state the resume logic has to
    // reconcile, and stopping cleanly is cheaper than being killed.
    const budgetMs = Number(process.env.RAPTOR_REQUEST_BUDGET_MS || 280000);

    const result = await raptor.buildDocumentTree({
      documentId,
      userId: req.user.id,
      documentTitle: doc.title || '',
      embedProvider: doc.knowledge_collections?.embedding_provider || DEFAULT_PROVIDER,
      deadlineAt: Date.now() + budgetMs,
      force: req.body?.force === true,
    });

    res.json({
      success: true,
      documentId,
      ...result,
      // Explicit rather than implied: the client should keep calling while this
      // is true, and stop when it is false.
      needsAnotherPass: Boolean(result.stopped),
    });
  } catch (err) {
    res.status(500).json({ error: err.message || 'Failed to build summary tree' });
  }
});

// ── GET /api/knowledge/documents/:id/tree — current tree shape ──
router.get('/documents/:id/tree', async (req, res) => {
  try {
    const { data: doc } = await supabase
      .from('knowledge_documents')
      .select('id, title, user_id')
      .eq('id', req.params.id)
      .single();

    if (!doc || doc.user_id !== req.user.id) {
      return res.status(404).json({ error: 'Document not found or unauthorized' });
    }

    const { data: chunks, error } = await supabase
      .from('knowledge_chunks')
      .select('metadata')
      .eq('document_id', req.params.id);

    if (error) throw error;

    const levels = {};
    for (const row of chunks || []) {
      const level = Number(row?.metadata?.level) || 0;
      levels[level] = (levels[level] || 0) + 1;
    }

    res.json({
      documentId: doc.id,
      title: doc.title,
      levels,
      built: Object.keys(levels).some((l) => Number(l) > 0),
    });
  } catch (err) {
    res.status(500).json({ error: err.message || 'Failed to read summary tree' });
  }
});

// ── POST /api/knowledge/search — test vector search across collections ──
router.post('/search', async (req, res) => {
  try {
    const { query, collectionIds = [], topK = 6 } = req.body;
    const searchResult = await searchKnowledgeCollections({
      query,
      collectionIds,
      userId: req.user.id,
      topK: Number(topK) || 6,
    });
    res.json(searchResult);
  } catch (err) {
    res.status(500).json({ error: err.message || 'Search failed' });
  }
});

module.exports = router;
