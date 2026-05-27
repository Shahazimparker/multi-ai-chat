// ============================================================
// FILE: backend/services/vectorStore.service.js
// PURPOSE: Unified vector store abstraction layer
//          - Switch between pgvector, in-memory, or other backends
//          - Consistent API for add, search, delete, update
//          - Support similarity search, filtering, metadata
// ============================================================

const supabase = require('../config/supabase');

/**
 * Base VectorStore interface
 * All implementations must follow this contract
 */
class VectorStore {
  async add(vectors) {
    throw new Error('add() not implemented');
  }

  async search(queryEmbedding, options = {}) {
    throw new Error('search() not implemented');
  }

  async delete(ids) {
    throw new Error('delete() not implemented');
  }

  async update(id, data) {
    throw new Error('update() not implemented');
  }

  async get(id) {
    throw new Error('get() not implemented');
  }

  async list(filters = {}) {
    throw new Error('list() not implemented');
  }

  async clear() {
    throw new Error('clear() not implemented');
  }

  async count() {
    throw new Error('count() not implemented');
  }
}

/**
 * PgVectorStore — PostgreSQL + pgvector backend
 * Uses Supabase as the client
 */
class PgVectorStore extends VectorStore {
  constructor(options = {}) {
    super();
    this.tableName = options.tableName || 'documents';
    this.similarityThreshold = options.similarityThreshold || 0.0;
    this.supabase = options.supabase || supabase;
  }

  /**
   * Add vectors to store
   * @param {Array} vectors - [{ id, content, embedding, metadata }]
   */
  async add(vectors) {
    if (!vectors || vectors.length === 0) return { success: false, count: 0 };

    try {
      const records = vectors.map((v) => ({
        id: v.id,
        content: v.content,
        embedding: v.embedding,
        metadata: v.metadata || {},
        created_at: new Date().toISOString(),
      }));

      const { data, error } = await this.supabase
        .from(this.tableName)
        .insert(records)
        .select();

      if (error) throw error;

      return {
        success: true,
        count: data ? data.length : records.length,
        ids: data ? data.map((r) => r.id) : vectors.map((v) => v.id),
      };
    } catch (err) {
      console.error(`[PgVectorStore] add() failed:`, err.message);
      return { success: false, error: err.message, count: 0 };
    }
  }

  /**
   * Search for similar vectors
   * @param {Array} queryEmbedding - query vector
   * @param {Object} options - { topK, threshold, filter, includeMetadata }
   */
  async search(queryEmbedding, options = {}) {
    const { topK = 10, threshold = this.similarityThreshold, filter = null, includeMetadata = true } = options;

    if (!queryEmbedding || queryEmbedding.length === 0) {
      return { success: false, results: [] };
    }

    try {
      let query = this.supabase.rpc('match_documents', {
        query_embedding: queryEmbedding,
        match_count: topK,
        match_threshold: threshold,
      });

      const { data, error } = await query;

      if (error) throw error;

      return {
        success: true,
        results: (data || []).map((r) => ({
          id: r.id,
          content: r.content,
          similarity: r.similarity || 0,
          metadata: includeMetadata ? r.metadata : null,
        })),
      };
    } catch (err) {
      console.error(`[PgVectorStore] search() failed:`, err.message);
      return { success: false, error: err.message, results: [] };
    }
  }

  /**
   * Get single vector by ID
   */
  async get(id) {
    try {
      const { data, error } = await this.supabase
        .from(this.tableName)
        .select('id, content, metadata, created_at')
        .eq('id', id)
        .single();

      if (error && error.code !== 'PGRST116') throw error;

      return {
        success: !!data,
        data: data || null,
      };
    } catch (err) {
      console.error(`[PgVectorStore] get() failed:`, err.message);
      return { success: false, error: err.message, data: null };
    }
  }

  /**
   * Delete vectors by IDs
   */
  async delete(ids) {
    if (!ids || ids.length === 0) return { success: false, count: 0 };

    try {
      const { error, count } = await this.supabase
        .from(this.tableName)
        .delete()
        .in('id', ids);

      if (error) throw error;

      return { success: true, count: count || ids.length };
    } catch (err) {
      console.error(`[PgVectorStore] delete() failed:`, err.message);
      return { success: false, error: err.message, count: 0 };
    }
  }

  /**
   * Update vector metadata
   */
  async update(id, data) {
    if (!id || !data) return { success: false };

    try {
      const { error } = await this.supabase
        .from(this.tableName)
        .update({
          ...data,
          updated_at: new Date().toISOString(),
        })
        .eq('id', id);

      if (error) throw error;

      return { success: true };
    } catch (err) {
      console.error(`[PgVectorStore] update() failed:`, err.message);
      return { success: false, error: err.message };
    }
  }

  /**
   * List all vectors with optional filtering
   */
  async list(options = {}) {
    const { limit = 100, offset = 0 } = options;

    try {
      let query = this.supabase.from(this.tableName).select('id, content, metadata, created_at');

      const { data, error, count } = await query
        .range(offset, offset + limit - 1)
        .order('created_at', { ascending: false });

      if (error) throw error;

      return {
        success: true,
        data: data || [],
        count: count || 0,
      };
    } catch (err) {
      console.error(`[PgVectorStore] list() failed:`, err.message);
      return { success: false, error: err.message, data: [], count: 0 };
    }
  }

  /**
   * Get total count
   */
  async count() {
    try {
      const { count, error } = await this.supabase
        .from(this.tableName)
        .select('id', { count: 'exact', head: true });

      if (error) throw error;

      return { success: true, count: count || 0 };
    } catch (err) {
      console.error(`[PgVectorStore] count() failed:`, err.message);
      return { success: false, error: err.message, count: 0 };
    }
  }

  /**
   * Delete all vectors
   */
  async clear() {
    try {
      const { error } = await this.supabase.from(this.tableName).delete().neq('id', '');

      if (error) throw error;

      return { success: true };
    } catch (err) {
      console.error(`[PgVectorStore] clear() failed:`, err.message);
      return { success: false, error: err.message };
    }
  }
}

/**
 * InMemoryStore — in-memory vector store for testing/caching
 * Fast, no external dependencies
 */
class InMemoryStore extends VectorStore {
  constructor(options = {}) {
    super();
    this.vectors = new Map(); // id → { content, embedding, metadata }
    this.maxSize = options.maxSize || 10000;
  }

  /**
   * Calculate cosine similarity
   */
  _cosineSimilarity(vecA, vecB) {
    if (!vecA || !vecB || vecA.length !== vecB.length) return 0;

    let dotProduct = 0;
    let magnitudeA = 0;
    let magnitudeB = 0;

    for (let i = 0; i < vecA.length; i++) {
      dotProduct += vecA[i] * vecB[i];
      magnitudeA += vecA[i] * vecA[i];
      magnitudeB += vecB[i] * vecB[i];
    }

    magnitudeA = Math.sqrt(magnitudeA);
    magnitudeB = Math.sqrt(magnitudeB);

    if (magnitudeA === 0 || magnitudeB === 0) return 0;

    return dotProduct / (magnitudeA * magnitudeB);
  }

  async add(vectors) {
    if (!vectors || vectors.length === 0) return { success: false, count: 0 };

    try {
      // LRU eviction if at capacity
      if (this.vectors.size + vectors.length > this.maxSize) {
        const excess = this.vectors.size + vectors.length - this.maxSize;
        const toDelete = Array.from(this.vectors.keys()).slice(0, excess);
        toDelete.forEach((id) => this.vectors.delete(id));
      }

      const added = [];
      for (const v of vectors) {
        this.vectors.set(v.id, {
          content: v.content,
          embedding: v.embedding,
          metadata: v.metadata || {},
          created_at: new Date().toISOString(),
        });
        added.push(v.id);
      }

      return { success: true, count: added.length, ids: added };
    } catch (err) {
      console.error(`[InMemoryStore] add() failed:`, err.message);
      return { success: false, error: err.message, count: 0 };
    }
  }

  async search(queryEmbedding, options = {}) {
    const { topK = 10, threshold = 0.0, includeMetadata = true } = options;

    if (!queryEmbedding || queryEmbedding.length === 0) {
      return { success: false, results: [] };
    }

    try {
      const results = [];

      for (const [id, vec] of this.vectors) {
        const similarity = this._cosineSimilarity(queryEmbedding, vec.embedding);

        if (similarity >= threshold) {
          results.push({
            id,
            content: vec.content,
            similarity,
            metadata: includeMetadata ? vec.metadata : null,
          });
        }
      }

      // Sort by similarity descending and limit to topK
      results.sort((a, b) => b.similarity - a.similarity);
      results.splice(topK);

      return { success: true, results };
    } catch (err) {
      console.error(`[InMemoryStore] search() failed:`, err.message);
      return { success: false, error: err.message, results: [] };
    }
  }

  async get(id) {
    const vec = this.vectors.get(id);
    if (!vec) return { success: false, data: null };

    return {
      success: true,
      data: {
        id,
        content: vec.content,
        metadata: vec.metadata,
        created_at: vec.created_at,
      },
    };
  }

  async delete(ids) {
    if (!ids || ids.length === 0) return { success: false, count: 0 };

    let deleted = 0;
    for (const id of ids) {
      if (this.vectors.delete(id)) deleted++;
    }

    return { success: true, count: deleted };
  }

  async update(id, data) {
    const vec = this.vectors.get(id);
    if (!vec) return { success: false };

    this.vectors.set(id, {
      ...vec,
      ...data,
      updated_at: new Date().toISOString(),
    });

    return { success: true };
  }

  async list(options = {}) {
    const { limit = 100, offset = 0 } = options;

    try {
      const all = Array.from(this.vectors.entries()).map(([id, vec]) => ({
        id,
        content: vec.content,
        metadata: vec.metadata,
        created_at: vec.created_at,
      }));

      const results = all.slice(offset, offset + limit);

      return {
        success: true,
        data: results,
        count: all.length,
      };
    } catch (err) {
      console.error(`[InMemoryStore] list() failed:`, err.message);
      return { success: false, error: err.message, data: [], count: 0 };
    }
  }

  async count() {
    return { success: true, count: this.vectors.size };
  }

  async clear() {
    this.vectors.clear();
    return { success: true };
  }
}

/**
 * Factory function — create store by type
 */
const createVectorStore = (type = 'pgvector', options = {}) => {
  if (type === 'pgvector') {
    return new PgVectorStore(options);
  }

  if (type === 'memory' || type === 'in-memory') {
    return new InMemoryStore(options);
  }

  throw new Error(`Unknown vector store type: ${type}`);
};

/**
 * Hybrid store — search across multiple stores
 * Useful for combining persistent + cache layers
 */
class HybridVectorStore extends VectorStore {
  constructor(primaryStore, cacheStore) {
    super();
    this.primary = primaryStore;
    this.cache = cacheStore;
  }

  async add(vectors) {
    // Add to both primary and cache
    const primaryResult = await this.primary.add(vectors);
    await this.cache.add(vectors);
    return primaryResult;
  }

  async search(queryEmbedding, options = {}) {
    // Search cache first (faster)
    const cacheResult = await this.cache.search(queryEmbedding, { ...options, topK: 5 });

    if (cacheResult.success && cacheResult.results.length > 0) {
      return cacheResult;
    }

    // Fall back to primary if cache miss
    return await this.primary.search(queryEmbedding, options);
  }

  async get(id) {
    const cached = await this.cache.get(id);
    if (cached.success) return cached;
    return await this.primary.get(id);
  }

  async delete(ids) {
    await this.cache.delete(ids);
    return await this.primary.delete(ids);
  }

  async update(id, data) {
    await this.cache.update(id, data);
    return await this.primary.update(id, data);
  }

  async list(options = {}) {
    return await this.primary.list(options);
  }

  async count() {
    return await this.primary.count();
  }

  async clear() {
    await this.cache.clear();
    return await this.primary.clear();
  }
}

module.exports = {
  VectorStore,
  PgVectorStore,
  InMemoryStore,
  HybridVectorStore,
  createVectorStore,
};
