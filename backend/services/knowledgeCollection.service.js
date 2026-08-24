// ============================================================
// FILE: backend/services/knowledgeCollection.service.js
// PURPOSE: Business logic for Knowledge Collections & Documents
// ============================================================

const supabase = require('../config/supabase');

/**
 * List all collections accessible by user (owned + public)
 */
const listCollections = async (userId) => {
  if (!userId) return [];

  const { data, error } = await supabase
    .from('knowledge_collections')
    .select(`
      id,
      user_id,
      name,
      description,
      icon,
      color,
      embedding_provider,
      embedding_model,
      is_public,
      created_at,
      updated_at
    `)
    .or(`user_id.eq.${userId},is_public.eq.true`)
    .order('updated_at', { ascending: false });

  if (error) {
    console.error('[KnowledgeCollection] listCollections error:', error.message);
    throw error;
  }

  const collections = data || [];
  if (collections.length === 0) return [];

  // Fetch document & chunk counts per collection in parallel
  const collectionIds = collections.map((c) => c.id);
  const { data: docCounts } = await supabase
    .from('knowledge_documents')
    .select('collection_id, chunk_count, file_size, status')
    .in('collection_id', collectionIds);

  const statsMap = new Map();
  for (const doc of docCounts || []) {
    const prev = statsMap.get(doc.collection_id) || { docCount: 0, chunkCount: 0, totalSize: 0, indexedCount: 0 };
    prev.docCount += 1;
    prev.chunkCount += (doc.chunk_count || 0);
    prev.totalSize += (doc.file_size || 0);
    if (doc.status === 'indexed') prev.indexedCount += 1;
    statsMap.set(doc.collection_id, prev);
  }

  return collections.map((col) => {
    const stats = statsMap.get(col.id) || { docCount: 0, chunkCount: 0, totalSize: 0, indexedCount: 0 };
    return {
      ...col,
      documentCount: stats.docCount,
      indexedCount: stats.indexedCount,
      chunkCount: stats.chunkCount,
      totalSize: stats.totalSize,
      isOwner: col.user_id === userId,
    };
  });
};

/**
 * Get collection by ID with full document list
 */
const getCollectionById = async (collectionId, userId) => {
  const { data: collection, error: colError } = await supabase
    .from('knowledge_collections')
    .select('*')
    .eq('id', collectionId)
    .single();

  if (colError || !collection) {
    throw new Error('Knowledge collection not found');
  }

  if (collection.user_id !== userId && !collection.is_public) {
    throw new Error('Access denied to this collection');
  }

  const { data: documents, error: docError } = await supabase
    .from('knowledge_documents')
    .select('*')
    .eq('collection_id', collectionId)
    .order('created_at', { ascending: false });

  if (docError) {
    console.error('[KnowledgeCollection] getDocuments error:', docError.message);
  }

  return {
    ...collection,
    isOwner: collection.user_id === userId,
    documents: documents || [],
  };
};

/**
 * Create a new collection
 */
const createCollection = async (userId, { name, description = '', icon = 'folder', color = '#4d6bfe', isPublic = false }) => {
  if (!name || !name.trim()) throw new Error('Collection name is required');

  const { data, error } = await supabase
    .from('knowledge_collections')
    .insert({
      user_id: userId,
      name: name.trim(),
      description: description.trim(),
      icon,
      color,
      is_public: Boolean(isPublic),
    })
    .select()
    .single();

  if (error) {
    console.error('[KnowledgeCollection] createCollection error:', error.message);
    throw error;
  }

  return data;
};

/**
 * Update an existing collection
 */
const updateCollection = async (collectionId, userId, updates = {}) => {
  const { data: existing } = await supabase
    .from('knowledge_collections')
    .select('id, user_id')
    .eq('id', collectionId)
    .single();

  if (!existing || existing.user_id !== userId) {
    throw new Error('Collection not found or unauthorized');
  }

  const allowedFields = ['name', 'description', 'icon', 'color', 'is_public'];
  const payload = { updated_at: new Date().toISOString() };

  for (const field of allowedFields) {
    if (updates[field] !== undefined) payload[field] = updates[field];
  }

  const { data, error } = await supabase
    .from('knowledge_collections')
    .update(payload)
    .eq('id', collectionId)
    .select()
    .single();

  if (error) {
    console.error('[KnowledgeCollection] updateCollection error:', error.message);
    throw error;
  }

  return data;
};

/**
 * Delete a collection and all associated documents & chunks
 */
const deleteCollection = async (collectionId, userId) => {
  const { data: existing } = await supabase
    .from('knowledge_collections')
    .select('id, user_id')
    .eq('id', collectionId)
    .single();

  if (!existing || existing.user_id !== userId) {
    throw new Error('Collection not found or unauthorized');
  }

  const { error } = await supabase
    .from('knowledge_collections')
    .delete()
    .eq('id', collectionId);

  if (error) {
    console.error('[KnowledgeCollection] deleteCollection error:', error.message);
    throw error;
  }

  return { success: true };
};

/**
 * Delete a single document and cascade its chunks
 */
const deleteDocument = async (documentId, userId) => {
  const { data: doc } = await supabase
    .from('knowledge_documents')
    .select('id, collection_id, user_id, blob_url')
    .eq('id', documentId)
    .single();

  if (!doc || doc.user_id !== userId) {
    throw new Error('Document not found or unauthorized');
  }

  if (doc.blob_url) {
    const { deleteBlobFromStorage } = require('./blobStorage.service');
    await deleteBlobFromStorage(doc.blob_url);
  }

  const { error } = await supabase
    .from('knowledge_documents')
    .delete()
    .eq('id', documentId);

  if (error) {
    console.error('[KnowledgeCollection] deleteDocument error:', error.message);
    throw error;
  }

  // Update collection updated_at
  await supabase
    .from('knowledge_collections')
    .update({ updated_at: new Date().toISOString() })
    .eq('id', doc.collection_id);

  return { success: true };
};

/**
 * Get chunks for a specific document (for chunk inspection)
 */
const getDocumentChunks = async (documentId, userId) => {
  const { data: doc } = await supabase
    .from('knowledge_documents')
    .select('id, title, collection_id, user_id')
    .eq('id', documentId)
    .single();

  if (!doc || doc.user_id !== userId) {
    throw new Error('Document not found or unauthorized');
  }

  const { data: chunks, error } = await supabase
    .from('knowledge_chunks')
    .select('id, chunk_index, chunk_text, parent_text, metadata, created_at')
    .eq('document_id', documentId)
    .order('chunk_index', { ascending: true });

  if (error) throw error;

  return {
    document: doc,
    chunks: chunks || [],
  };
};

module.exports = {
  listCollections,
  getCollectionById,
  createCollection,
  updateCollection,
  deleteCollection,
  deleteDocument,
  getDocumentChunks,
};
