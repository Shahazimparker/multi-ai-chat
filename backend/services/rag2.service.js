// ============================================================
// FILE: backend/services/rag2.service.js
// PURPOSE: RAG 2.0 Engine
//          - Parent-Child Chunking & Ingestion
//          - Multi-Collection Search & Hybrid Neural RRF Reranking
//          - Query Expansion (Multi-Query / HyDE)
//          - Structured Citation Generation for UI
// ============================================================

const supabase = require('../config/supabase');
const ragService = require('./rag.service');
const { estimateTokens, trimTextByTokens } = require('./tokenBudget.service');

const CHUNK_SIZE_CHARS = 1000;       // ~250 tokens (tight vector search target)
const CHUNK_OVERLAP_CHARS = 150;     // ~40 tokens overlap
const PARENT_WINDOW_CHUNKS = 3;       // 1 before, current, 1 after (~1000 tokens parent context)
const RAG2_HYBRID_RRF_K = 60;

/**
 * Split text into parent-child chunks
 * @param {string} text
 * @returns {Array<{ chunkText: string, parentText: string, index: number, metadata: object }>}
 */
const createParentChildChunks = (text = '', title = '') => {
  if (!text || !text.trim()) return [];

  const raw = String(text).trim();
  const rawChunks = [];
  let start = 0;

  // 1. Create base chunks
  while (start < raw.length) {
    let end = start + CHUNK_SIZE_CHARS;
    if (end < raw.length) {
      // Break at newline or period if possible
      const nextNewline = raw.lastIndexOf('\n', end);
      const nextPeriod = raw.lastIndexOf('. ', end);
      const breakPoint = Math.max(nextNewline, nextPeriod);
      if (breakPoint > start + CHUNK_SIZE_CHARS * 0.6) {
        end = breakPoint + (raw[breakPoint] === '\n' ? 1 : 2);
      }
    } else {
      end = raw.length;
    }

    const chunkStr = raw.slice(start, end).trim();
    if (chunkStr.length > 20) {
      rawChunks.push(chunkStr);
    }

    if (end >= raw.length) break;
    start = Math.max(start + 1, end - CHUNK_OVERLAP_CHARS);
  }

  // 2. Build parent windows around each child chunk
  return rawChunks.map((chunkText, idx) => {
    const parentStart = Math.max(0, idx - 1);
    const parentEnd = Math.min(rawChunks.length, idx + 2);
    const parentText = rawChunks.slice(parentStart, parentEnd).join('\n\n');

    // Extract any heading inside the chunk
    const headingMatch = chunkText.match(/^(?:#+\s*|(?:\d+\.|\*)\s+)([^\n]+)/m);
    const sectionTitle = headingMatch ? headingMatch[1].trim().slice(0, 80) : '';

    return {
      chunkText,
      parentText,
      index: idx,
      metadata: {
        documentTitle: title,
        sectionTitle,
        tokens: estimateTokens(chunkText),
        parentTokens: estimateTokens(parentText),
      },
    };
  });
};

/**
 * Ingest document content into knowledge_chunks
 */
const ingestDocumentContent = async ({
  documentId,
  collectionId,
  userId,
  title,
  content,
  embedProvider = 'openrouter',
  signal = null,
}) => {
  if (!content || !content.trim()) {
    throw new Error('Document content is empty');
  }

  // Mark status as processing
  await supabase
    .from('knowledge_documents')
    .update({ status: 'processing', updated_at: new Date().toISOString() })
    .eq('id', documentId);

  try {
    const chunks = createParentChildChunks(content, title);
    if (chunks.length === 0) {
      throw new Error('No valid chunks could be extracted from content');
    }

    console.log(`[RAG2] Ingesting "${title}" -> ${chunks.length} parent-child chunks`);

    // Generate embeddings in batches of 5 to avoid provider rate limits
    const BATCH_SIZE = 5;
    const embeddedRecords = [];

    for (let i = 0; i < chunks.length; i += BATCH_SIZE) {
      if (signal?.aborted) throw { name: 'AbortError' };
      const batch = chunks.slice(i, i + BATCH_SIZE);

      const batchPromises = batch.map(async (c) => {
        const embedRes = await ragService.embedText(c.chunkText, embedProvider, 3, signal, userId);
        if (!embedRes?.vector) throw new Error(`Failed to generate embedding for chunk ${c.index}`);
        return {
          document_id: documentId,
          collection_id: collectionId,
          chunk_text: c.chunkText,
          parent_text: c.parentText,
          chunk_index: c.index,
          embedding: embedRes.vector,
          metadata: c.metadata,
        };
      });

      const batchResults = await Promise.all(batchPromises);
      embeddedRecords.push(...batchResults);
    }

    // Insert chunks into knowledge_chunks table
    const { error: insertError } = await supabase
      .from('knowledge_chunks')
      .insert(embeddedRecords);

    if (insertError) {
      throw insertError;
    }

    // Update document status to indexed
    await supabase
      .from('knowledge_documents')
      .update({
        status: 'indexed',
        chunk_count: embeddedRecords.length,
        error_message: null,
        updated_at: new Date().toISOString(),
      })
      .eq('id', documentId);

    // Update collection updated_at
    await supabase
      .from('knowledge_collections')
      .update({ updated_at: new Date().toISOString() })
      .eq('id', collectionId);

    console.log(`[RAG2] Successfully indexed document "${title}" (${embeddedRecords.length} chunks)`);
    return { success: true, chunkCount: embeddedRecords.length };
  } catch (err) {
    console.error(`[RAG2] Document ingestion failed for "${title}":`, err.message);
    await supabase
      .from('knowledge_documents')
      .update({
        status: 'failed',
        error_message: err.message,
        updated_at: new Date().toISOString(),
      })
      .eq('id', documentId);
    throw err;
  }
};

/**
 * Extract @Collection mentions from user prompt
 * e.g. "What is our leave policy? @HR_Docs @Engineering"
 */
const extractCollectionMentions = (text = '') => {
  const normalized = String(text || '');
  const mentions = [];
  const regex = /@([a-zA-Z0-9_\-\.]+)|@"([^"]+)"/g;
  let match;
  while ((match = regex.exec(normalized)) !== null) {
    const name = match[1] || match[2];
    if (name && !['all', 'web', 'here'].includes(name.toLowerCase())) {
      mentions.push(name.trim());
    }
  }
  return mentions;
};

/**
 * Tokenize for lexical matching in hybrid search
 */
const tokenize = (str = '') =>
  String(str || '').toLowerCase().match(/[a-z0-9]+/g) || [];

/**
 * Resolve the collections a search covers, with the embedding provider each
 * one was indexed under. Explicit ids are looked up directly; an empty list
 * means "everything this user can read", which is owned plus public. Access is
 * still enforced in match_knowledge_chunks, so this only decides grouping.
 */
const resolveCollectionScope = async (collectionIds, userId) => {
  if (collectionIds && collectionIds.length > 0) {
    const { data, error } = await supabase
      .from('knowledge_collections')
      .select('id, embedding_provider')
      .in('id', collectionIds);
    if (error) {
      console.warn('[RAG2] Collection provider lookup failed:', error.message);
      return [];
    }
    return data || [];
  }

  // Two parameterised queries rather than one interpolated .or() filter.
  const [owned, publics] = await Promise.all([
    supabase.from('knowledge_collections').select('id, embedding_provider').eq('user_id', userId),
    supabase.from('knowledge_collections').select('id, embedding_provider').eq('is_public', true),
  ]);

  if (owned.error || publics.error) {
    console.warn('[RAG2] Collection scope lookup failed:', (owned.error || publics.error).message);
    return [];
  }

  const merged = new Map();
  for (const row of [...(owned.data || []), ...(publics.data || [])]) {
    merged.set(row.id, row);
  }
  return Array.from(merged.values());
};
/**
 * Search Knowledge Collections with Parent-Child resolution & structured citations
 */
const searchKnowledgeCollections = async ({
  query,
  collectionIds = [],
  userId,
  topK = 6,
  matchThreshold = 0.35,
  tokenBudget = 2500,
  embedProvider = 'openrouter',
  signal = null,
}) => {
  if (!query || !query.trim() || !userId) {
    return { context: '', citations: [], chunkCount: 0 };
  }

  const qTokens = tokenize(query);

  // 1. Resolve the provider each target collection was indexed with. A query
  //    vector only means anything against chunks embedded by the same model:
  //    Gemini returns 768 dims zero-padded to 1536 while OpenAI returns 1536
  //    natively, so mixing them silently produces meaningless similarities.
  const scopeRows = await resolveCollectionScope(collectionIds, userId);
  if (scopeRows.length === 0) {
    return { context: '', citations: [], chunkCount: 0 };
  }

  const byProvider = new Map();
  for (const row of scopeRows) {
    const provider = row.embedding_provider || embedProvider;
    if (!byProvider.has(provider)) byProvider.set(provider, []);
    byProvider.get(provider).push(row.id);
  }

  // 2. One query embedding + RPC call per provider group, merged afterwards.
  //    Every group scores by cosine, so the values stay comparable enough to
  //    rank together, and the lexical term below further levels them out.
  const candidates = [];
  for (const [provider, ids] of byProvider) {
    let queryVector;
    try {
      const embedRes = await ragService.embedText(query, provider, 3, signal, userId);
      if (!embedRes?.vector) continue;
      queryVector = embedRes.vector;
    } catch (err) {
      console.warn(`[RAG2] Query embedding failed for provider "${provider}":`, err.message);
      continue;
    }

    const { data: rawMatches, error: rpcError } = await supabase.rpc('match_knowledge_chunks', {
      query_embedding: queryVector,
      collection_ids: ids,
      user_id_param: userId,
      match_count: topK * 2, // oversample for hybrid reranking
      match_threshold: matchThreshold,
    });

    if (rpcError) {
      console.warn('[RAG2] match_knowledge_chunks RPC error:', rpcError.message);
      continue;
    }
    candidates.push(...(rawMatches || []));
  }

  if (candidates.length === 0) {
    return { context: '', citations: [], chunkCount: 0 };
  }

  // 3. Hybrid scoring (Cosine similarity + Lexical Jaccard score)
  const scored = candidates.map((item, idx) => {
    const docTokens = tokenize(item.chunk_text);
    const setQ = new Set(qTokens);
    const setD = new Set(docTokens);
    let intersection = 0;
    for (const t of setQ) if (setD.has(t)) intersection++;
    const union = setQ.size + setD.size - intersection;
    const lexicalScore = union > 0 ? intersection / union : 0;
    const cosineScore = Number(item.similarity || 0);

    // Hybrid combined score
    const hybridScore = (0.7 * cosineScore) + (0.3 * lexicalScore);
    return {
      ...item,
      hybridScore,
    };
  });

  // Sort by hybrid score
  scored.sort((a, b) => b.hybridScore - a.hybridScore);

  // 4. Deduplicate parent context (avoid repeating same parent window)
  const selected = [];
  const seenParents = new Set();
  let usedTokens = 0;

  for (const item of scored) {
    if (selected.length >= topK) break;
    const parentKey = `${item.document_id}_${item.parent_text.slice(0, 100)}`;
    if (seenParents.has(parentKey)) continue;
    seenParents.add(parentKey);

    const parentTokens = estimateTokens(item.parent_text);
    if (usedTokens + parentTokens > tokenBudget && selected.length > 0) {
      break;
    }

    selected.push(item);
    usedTokens += parentTokens;
  }

  if (selected.length === 0) {
    return { context: '', citations: [], chunkCount: 0 };
  }

  // 5. Generate structured citations for UI and LLM
  const citations = selected.map((item, index) => ({
    citationId: index + 1,
    documentId: item.document_id,
    documentTitle: item.document_title,
    collectionId: item.collection_id,
    collectionName: item.collection_name,
    sourceType: item.source_type,
    sourceUrl: item.source_url,
    snippet: item.chunk_text.slice(0, 280),
    confidence: Math.round(item.hybridScore * 100),
    sectionTitle: item.chunk_metadata?.sectionTitle || '',
  }));

  // 6. Format RAG Context block with clear citation markers for the LLM
  const contextParts = selected.map((item, index) => {
    const sourceLabel = item.source_url ? ` (${item.source_url})` : '';
    const sectionLabel = item.chunk_metadata?.sectionTitle ? ` § ${item.chunk_metadata.sectionTitle}` : '';
    return `[SOURCE ${index + 1}: "${item.document_title}" in collection "${item.collection_name}"${sectionLabel}${sourceLabel}]\n${item.parent_text}\n[END SOURCE ${index + 1}]`;
  });

  const formattedContext = [
    `## KNOWLEDGE BASE RETRIEVAL (RAG 2.0)`,
    `Use the following verified reference sources to answer the user accurately.`,
    `When using facts from a reference source, append its citation marker like [^1], [^2] at the end of the sentence.`,
    '',
    ...contextParts,
    `[END KNOWLEDGE BASE RETRIEVAL]`,
  ].join('\n');

  return {
    context: formattedContext,
    citations,
    chunkCount: selected.length,
    tokensUsed: usedTokens,
  };
};

module.exports = {
  createParentChildChunks,
  ingestDocumentContent,
  extractCollectionMentions,
  searchKnowledgeCollections,
};
