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
const { spaceForProvider } = require('../config/embedding');
// Namespace import, not a destructured one: the binding has to stay late-bound
// so tests can stub it, same as ragService above.
const cohereService = require('./ai/cohere.service');
const queryTransform = require('./queryTransform.service');
const {
  RAG_QUERY_EXPANSION_ENABLED,
  RAG_QUERY_EXPANSION_COUNT,
  RAG_HYDE_ENABLED,
  RAG_RERANK_ENABLED,
  RAG_RERANK_MODEL,
  RAG_RERANK_TIMEOUT_MS,
  RAG_RERANK_CANDIDATE_MULTIPLIER,
  RAG_RERANK_MIN_RELEVANCE,
} = require('../config/chatRuntime.config');

const CHUNK_SIZE_CHARS = 1000;       // ~250 tokens (tight vector search target)
const CHUNK_OVERLAP_CHARS = 150;     // ~40 tokens overlap
const PARENT_WINDOW_CHUNKS = 3;       // 1 before, current, 1 after (~1000 tokens parent context)
const RAG2_HYBRID_RRF_K = 60;

// Similarity floor for the first retrieval pass. Kept modest on purpose: a user
// who attaches a collection wants it consulted, and text-embedding-3-small puts
// plainly-worded questions around 0.3 against their own source text.
const RAG2_MATCH_THRESHOLD = 0.25;
// Second pass when the first returns nothing at all - take the nearest chunks at
// any score rather than hand the model an empty context.
const RAG2_FALLBACK_THRESHOLD = 0.0;
const MANIFEST_DOC_LIMIT = 50;

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
 * Build the text that is actually sent to the embedder.
 *
 * A chunk is embedded in isolation, which strips the context a reader would
 * have had. "The limit is 4096 tokens." carries no hint of WHICH limit or
 * which product — so a query naming the document or section scores poorly
 * against it even though it is the right passage.
 *
 * Prepending the document title and section heading puts that context inside
 * the vector. Cheap (a few tokens per chunk), no extra API calls, and it is
 * the single highest-yield change available to chunk quality.
 *
 * The prefix is embedded ONLY. `chunk_text` is stored raw, so prompts and
 * citation snippets are unaffected.
 */
const HEADING_ECHO_WINDOW = 200;

const buildEmbeddingText = (chunkText, documentTitle = '', sectionTitle = '') => {
  const body = String(chunkText || '');
  const parts = [];

  if (documentTitle) parts.push(documentTitle);

  // sectionTitle is extracted from a heading INSIDE the chunk, so for the chunk
  // that heading opens it is already the opening line. Prepending it there just
  // repeats the phrase and doubles its pull on the vector, which skews the
  // chunk toward its own title and away from its content.
  if (sectionTitle && !body.slice(0, HEADING_ECHO_WINDOW).includes(sectionTitle)) {
    parts.push(sectionTitle);
  }

  const header = parts.join(' > ');
  return header ? `${header}

${body}` : body;
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
        const embedInput = buildEmbeddingText(c.chunkText, title, c.metadata?.sectionTitle);
        const embedRes = await ragService.embedText(embedInput, embedProvider, 3, signal, userId);
        if (!embedRes?.vector) throw new Error(`Failed to generate embedding for chunk ${c.index}`);
        return {
          document_id: documentId,
          collection_id: collectionId,
          chunk_text: c.chunkText,
          parent_text: c.parentText,
          chunk_index: c.index,
          embedding: embedRes.vector,
          // Records that this vector includes the title/section prefix.
          // Chunks indexed before contextual enrichment lack it, and their
          // vectors sit slightly differently — harmless, but this makes a
          // mixed corpus detectable and re-indexable.
          metadata: { ...c.metadata, contextualized: true },
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
      .select('id, name, embedding_provider')
      .in('id', collectionIds);
    if (error) {
      console.warn('[RAG2] Collection provider lookup failed:', error.message);
      return [];
    }
    return data || [];
  }

  // Two parameterised queries rather than one interpolated .or() filter.
  const [owned, publics] = await Promise.all([
    supabase.from('knowledge_collections').select('id, name, embedding_provider').eq('user_id', userId),
    supabase.from('knowledge_collections').select('id, name, embedding_provider').eq('is_public', true),
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
 * List the indexed documents behind a set of collections.
 *
 * A question like "what do you see in this knowledge base?" shares almost no
 * vocabulary with the documents it is asking about, so every chunk scores below
 * the similarity floor, retrieval returns nothing, and the model is handed an
 * empty context — at which point it truthfully answers that no knowledge base is
 * attached. The manifest prevents that: whenever a collection is attached, the
 * prompt at minimum names it and lists what it holds.
 */
const listCollectionDocuments = async (collectionIds) => {
  if (!collectionIds || collectionIds.length === 0) return [];
  try {
    const { data, error } = await supabase
      .from('knowledge_documents')
      .select('id, collection_id, title, source_type, source_url, chunk_count')
      .in('collection_id', collectionIds)
      .eq('status', 'indexed')
      .limit(MANIFEST_DOC_LIMIT);
    if (error) {
      console.warn('[RAG2] Document manifest lookup failed:', error.message);
      return [];
    }
    return data || [];
  } catch (err) {
    console.warn('[RAG2] Document manifest lookup failed:', err.message);
    return [];
  }
};

const buildManifestLines = (scopeRows, documents) => {
  const byCollection = new Map(scopeRows.map((row) => [row.id, []]));
  for (const doc of documents) {
    const bucket = byCollection.get(doc.collection_id);
    if (bucket) bucket.push(doc);
  }

  const lines = [];
  for (const row of scopeRows) {
    const docs = byCollection.get(row.id) || [];
    lines.push(`- Collection "${row.name || row.id}" — ${docs.length} indexed document(s)`);
    for (const doc of docs) {
      const source = doc.source_url ? `, ${doc.source_url}` : '';
      lines.push(`  * ${doc.title} (${doc.source_type || 'file'}, ${doc.chunk_count || 0} chunks${source})`);
    }
  }
  return lines;
};

/**
 * Reciprocal Rank Fusion of several candidate lists.
 *
 * Fuses by RANK, never by score. A cosine similarity and a normalised text
 * rank are different units on different scales, so any weighted sum of the two
 * is arbitrary — whereas "3rd in the dense list and 1st in the sparse list" is
 * meaningful without knowing either scale.
 *
 * score(chunk) = sum over lists of 1 / (k + rank_in_that_list)
 *
 * k damps the top of each list so one confident ranker cannot dominate; 60 is
 * the value from the original RRF paper and the one used elsewhere in this
 * codebase.
 *
 * @param {Array<Array>} lists candidate arrays, each already sorted best-first
 * @returns {Array} fused candidates, best-first, deduplicated by chunk_id
 */
const fuseByReciprocalRank = (lists, k = RAG2_HYBRID_RRF_K) => {
  const scores = new Map();
  const bestRank = new Map();
  const byId = new Map();

  for (const list of lists) {
    list.forEach((item, index) => {
      const id = item.chunk_id;
      if (!id) return;
      if (!byId.has(id)) byId.set(id, item);
      const rank = index + 1;
      scores.set(id, (scores.get(id) || 0) + 1 / (k + rank));
      bestRank.set(id, Math.min(bestRank.get(id) ?? rank, rank));
    });
  }

  // Exact ties are common and expected: an item ranked 1st in the dense list
  // and one ranked 1st in the sparse list both score 1/(k+1). Neither deserves
  // to win on merit, but the order must not depend on Map insertion order or
  // results would wobble between identical runs. Break on best rank achieved,
  // then on id so the outcome is fully determined by the inputs.
  return [...scores.entries()]
    .sort((a, b) => (
      b[1] - a[1]
      || (bestRank.get(a[0]) - bestRank.get(b[0]))
      || String(a[0]).localeCompare(String(b[0]))
    ))
    .map(([id, rrfScore]) => ({ ...byId.get(id), rrfScore }));
};

const rerankAvailable = () => Boolean(RAG_RERANK_ENABLED && process.env.COHERE_API_KEY);

/**
 * Re-order candidates with a cross-encoder.
 *
 * Embedding similarity scores the query and each chunk in isolation; a
 * cross-encoder reads the pair together and judges whether this chunk answers
 * this question. It is the single largest precision gain available over pure
 * vector ordering.
 *
 * Returns entries carrying `rerankScore` (calibrated 0-1) and `hybridScore` set
 * to it, so downstream selection and the citation `confidence` both improve
 * without knowing the reranker exists.
 *
 * Degrades to the caller's existing ordering on any failure: a reranker outage
 * must never be able to break retrieval.
 *
 * @returns {Promise<{ items: Array, reranked: boolean, searchUnits: number }>}
 */
const rerankCandidates = async (query, candidates, signal = null) => {
  if (!rerankAvailable() || candidates.length <= 1) {
    return { items: candidates, reranked: false, searchUnits: 0 };
  }

  try {
    const { results, searchUnits } = await cohereService.rerankDocuments(
      query,
      candidates.map((c) => c.chunk_text || ''),
      process.env.COHERE_API_KEY,
      { model: RAG_RERANK_MODEL, signal, timeout: RAG_RERANK_TIMEOUT_MS }
    );

    if (!results.length) {
      return { items: candidates, reranked: false, searchUnits };
    }

    const items = results.map(({ index, relevanceScore }) => ({
      ...candidates[index],
      rerankScore: relevanceScore,
      hybridScore: relevanceScore,
    }));

    console.log(`[RAG2] Reranked ${candidates.length} candidates via ${RAG_RERANK_MODEL} (top score ${items[0].rerankScore.toFixed(3)})`);
    return { items, reranked: true, searchUnits };
  } catch (err) {
    if (err?.name === 'AbortError' || err?.name === 'CanceledError') throw err;
    // Retrieval still works without the reranker, just less precisely.
    console.warn('[RAG2] Rerank unavailable, falling back to hybrid ordering:', err.message);
    return { items: candidates, reranked: false, searchUnits: 0 };
  }
};

/**
 * Search Knowledge Collections with Parent-Child resolution & structured citations
 */
const searchKnowledgeCollections = async ({
  query,
  collectionIds = [],
  userId,
  topK = 6,
  matchThreshold = RAG2_MATCH_THRESHOLD,
  tokenBudget = 2500,
  embedProvider = 'openrouter',
  signal = null,
}) => {
  if (!query || !query.trim() || !userId) {
    return { context: '', citations: [], chunkCount: 0 };
  }

  const qTokens = tokenize(query);
  const oversampleFactor = rerankAvailable() ? RAG_RERANK_CANDIDATE_MULTIPLIER : 2;

  // 1. Resolve the provider each target collection was indexed with. A query
  //    vector only means anything against chunks embedded by the same model:
  //    Gemini returns 768 dims zero-padded to 1536 while OpenAI returns 1536
  //    natively, so mixing them silently produces meaningless similarities.
  const scopeRows = await resolveCollectionScope(collectionIds, userId);
  if (scopeRows.length === 0) {
    return { context: '', citations: [], chunkCount: 0 };
  }

  //    Group by SPACE rather than by provider name: two collections indexed
  //    through 'openrouter' and 'openai' hold vectors from the same model, so
  //    one query embedding serves both. Grouping by provider embedded the same
  //    query twice and billed for it.
  const bySpace = new Map();
  for (const row of scopeRows) {
    const provider = row.embedding_provider || embedProvider;
    const space = spaceForProvider(provider);
    if (!bySpace.has(space)) bySpace.set(space, { provider, ids: [] });
    bySpace.get(space).ids.push(row.id);
  }

  // 1.5 Query expansion. A question and the passage that answers it rarely
  //     share vocabulary, so retrieve for several phrasings and fuse the
  //     results. The ORIGINAL query is always first and is never dropped.
  let searchQueries = [query];
  let transformTokens = 0;

  // Fetched here rather than at manifest time so the rewriter can be told what
  // corpus it is rewriting for, then reused below. Without this anchor the
  // model resolves ambiguous wording by everyday usage and drifts off-domain.
  const documents = await listCollectionDocuments(scopeRows.map((row) => row.id));
  const domainHint = [
    ...scopeRows.map((r) => r.name).filter(Boolean),
    ...documents.slice(0, 12).map((d) => d.title).filter(Boolean),
  ].join(', ');

  if (RAG_QUERY_EXPANSION_ENABLED) {
    const expansion = await queryTransform.expandQuery(query, {
      count: RAG_QUERY_EXPANSION_COUNT,
      signal,
      domainHint,
    });
    searchQueries = expansion.queries;
    transformTokens += expansion.tokensUsed;
  }

  // HyDE embeds a hypothetical ANSWER rather than the question, since an answer
  // sits closer to a real passage in vector space. It is added as an extra
  // dense probe, never as a replacement — a wrong hypothesis should cost recall
  // at worst, not remove the user's actual wording from the search.
  let hydeText = null;
  if (RAG_HYDE_ENABLED) {
    const hyde = await queryTransform.generateHypotheticalAnswer(query, { signal, domainHint });
    hydeText = hyde.hypothetical;
    transformTokens += hyde.tokensUsed;
  }

  // 2. Embed every probe once per space. Parallel, because these are
  //    independent network calls and doing them in series would multiply
  //    latency by the number of variants.
  const denseProbes = hydeText ? [...searchQueries, hydeText] : searchQueries;

  const groups = [];
  await Promise.all([...bySpace.entries()].map(async ([space, { provider, ids }]) => {
    const vectors = await Promise.all(denseProbes.map(async (probe) => {
      try {
        const embedRes = await ragService.embedText(probe, provider, 3, signal, userId);
        return embedRes?.vector || null;
      } catch (err) {
        if (err?.name === 'AbortError' || err?.name === 'CanceledError') throw err;
        console.warn(`[RAG2] Query embedding failed for space "${space}":`, err.message);
        return null;
      }
    }));

    const usable = vectors.filter(Boolean);
    if (usable.length > 0) groups.push({ ids, queryVectors: usable });
  }));

  //    Every group scores by cosine, so the values stay comparable enough to
  //    rank together, and the lexical term below further levels them out.
  //    Returns ONE ranked list per probe vector rather than a flat array, because
  //    RRF fuses by position within a list — flattening first would destroy the
  //    ranks it needs.
  const runMatchPass = async (threshold) => {
    const lists = await Promise.all(groups.flatMap(({ ids, queryVectors }) =>
      queryVectors.map(async (queryVector) => {
        const { data: rawMatches, error: rpcError } = await supabase.rpc('match_knowledge_chunks', {
          query_embedding: queryVector,
          collection_ids: ids,
          user_id_param: userId,
          // Oversample. Reranking only pays if the chunk it would promote is in
          // the candidate set at all, so pull a wider net when a cross-encoder
          // will re-order it.
          match_count: topK * oversampleFactor,
          match_threshold: threshold,
        });

        if (rpcError) {
          console.error('[RAG2] match_knowledge_chunks RPC error:', rpcError.message);
          return [];
        }
        return rawMatches || [];
      })
    ));
    return lists.filter((l) => l.length > 0);
  };

  // Sparse (keyword) pass against the GIN index. Independent of the embedder,
  // so it recovers chunks carrying an exact term — an error code, a SKU, a
  // version string — that the dense pass ranks nowhere near the top.
  //    Also one ranked list per query variant. A rewrite that surfaces a chunk
  //    the original wording missed is exactly the point of expansion, and RRF
  //    needs each variant's ranking kept separate to reward that.
  const runFtsPass = async () => {
    // Scoped to every in-scope collection, NOT to the embedding groups.
    // Keyword search needs no query vector, so a collection whose embedding
    // provider is down is still fully searchable by text — losing one provider
    // should degrade retrieval, not silently remove those documents.
    const ids = scopeRows.map((row) => row.id);
    if (ids.length === 0) return [];

    // HyDE text is deliberately excluded: it is invented prose, and its
    // fabricated specifics would match keywords that appear nowhere in the
    // user's actual question.
    const lists = await Promise.all(searchQueries.map(async (variant) => {
      const { data, error } = await supabase.rpc('match_knowledge_chunks_fts', {
        query_text: variant,
        collection_ids: ids,
        user_id_param: userId,
        match_count: topK * oversampleFactor,
      });

      if (error) {
        // Most likely the FTS migration has not been applied yet. Dense-only
        // retrieval is exactly the previous behaviour, so carry on.
        console.warn('[RAG2] FTS pass unavailable, using dense retrieval only:', error.message);
        return [];
      }
      return data || [];
    }));

    return lists.filter((l) => l.length > 0);
  };

  // Both passes are independent, so run them concurrently.
  const [denseLists, sparseLists] = await Promise.all([
    runMatchPass(matchThreshold),
    runFtsPass(),
  ]);

  let candidates = fuseByReciprocalRank([...denseLists, ...sparseLists]);

  if (denseLists.length + sparseLists.length > 0) {
    const denseIds = new Set(denseLists.flat().map((r) => r.chunk_id));
    const recovered = sparseLists.flat().filter((r) => !denseIds.has(r.chunk_id)).length;
    console.log(`[RAG2] Fused ${denseLists.length} dense + ${sparseLists.length} sparse list(s) over ${searchQueries.length} query variant(s) -> ${candidates.length} candidates (${recovered} keyword-only)`);
  }

  if (candidates.length === 0 && groups.length > 0) {
    // Neither pass found anything. The user attached these collections
    // deliberately, so fall back to the nearest chunks at any score. Overview
    // and meta questions never score near the text they are asking about.
    candidates = fuseByReciprocalRank(await runMatchPass(RAG2_FALLBACK_THRESHOLD));
    if (candidates.length > 0) {
      console.log(`[RAG2] No chunk cleared threshold ${matchThreshold}; used relaxed fallback pass.`);
    }
  }

  // 3. Baseline ordering — used as-is whenever the reranker is unavailable.
  //
  //    Every candidate now arrives from RRF fusion, including the relaxed
  //    fallback pass, so `rrfScore` is the ordering and `similarity` is NOT a
  //    single unit across rows — dense rows hold a cosine, sparse rows hold a
  //    normalised text rank. Scoring those together with one formula would be
  //    meaningless, so the RRF order stands and the score is only normalised
  //    for display. The cosine+lexical blend below is a defensive path for any
  //    candidate that somehow reaches here without a fusion score.
  const maxRrf = Math.max(0, ...candidates.map((c) => Number(c.rrfScore) || 0));

  const hybridScored = candidates.map((item) => {
    if (item.rrfScore !== undefined && maxRrf > 0) {
      return { ...item, hybridScore: item.rrfScore / maxRrf };
    }

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
  hybridScored.sort((a, b) => b.hybridScore - a.hybridScore);

  // 3.5 Cross-encoder rerank. Replaces the ordering above when available, and
  //     leaves it untouched when not.
  const { items: rerankedItems, reranked } = await rerankCandidates(query, hybridScored, signal);
  let scored = rerankedItems;

  // 3.6 Relevance gate. Only meaningful with a reranker: `relevance_score` is
  //     calibrated 0-1, whereas hybridScore is an uncalibrated blend where a
  //     given number carries no fixed meaning.
  //
  //     This is what stops the relaxed fallback pass above from dressing up
  //     near-miss chunks as verified sources. Below the bar the manifest still
  //     names every document, so the model can answer "what is in this
  //     knowledge base?" — it just stops citing passages that do not answer
  //     the question.
  if (reranked) {
    const relevant = scored.filter((item) => item.rerankScore >= RAG_RERANK_MIN_RELEVANCE);
    if (relevant.length < scored.length) {
      console.log(`[RAG2] Relevance gate dropped ${scored.length - relevant.length}/${scored.length} chunk(s) below ${RAG_RERANK_MIN_RELEVANCE}`);
    }
    scored = relevant;
  }

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

  // 5. Manifest header. Emitted even when retrieval came back empty, so the
  //    model can still answer "what is in this knowledge base?" and never denies
  //    having one.
  const header = [
    '## KNOWLEDGE BASE RETRIEVAL (RAG 2.0)',
    'The user has attached the knowledge base(s) below to this conversation. You DO have access to their contents — never reply that no documents are attached, and never ask the user to upload these files again.',
    '',
    '### Attached knowledge bases',
    ...buildManifestLines(scopeRows, documents),
    '',
  ];

  if (selected.length === 0) {
    const context = [
      ...header,
      '### Retrieved passages',
      'No passage from these documents scored high enough for this specific query. Answer from the document list above, and ask the user which document or topic to look into.',
      '[END KNOWLEDGE BASE RETRIEVAL]',
    ].join('\n');
    return { context, citations: [], chunkCount: 0, tokensUsed: estimateTokens(context) + transformTokens, reranked };
  }

  // 6. Generate structured citations for UI and LLM
  const citations = selected.map((item, index) => ({
    citationId: index + 1,
    documentId: item.document_id,
    documentTitle: item.document_title,
    collectionId: item.collection_id,
    collectionName: item.collection_name,
    sourceType: item.source_type,
    sourceUrl: item.source_url,
    snippet: item.chunk_text.slice(0, 280),
    // With a reranker this is a calibrated cross-encoder relevance score, so
    // the number shown in the UI finally means something. Without one it is
    // the uncalibrated hybrid blend, as before.
    confidence: Math.round(item.hybridScore * 100),
    calibrated: reranked,
    sectionTitle: item.chunk_metadata?.sectionTitle || '',
  }));

  // 7. Format RAG Context block with clear citation markers for the LLM
  const contextParts = selected.map((item, index) => {
    const sourceLabel = item.source_url ? ` (${item.source_url})` : '';
    const sectionLabel = item.chunk_metadata?.sectionTitle ? ` § ${item.chunk_metadata.sectionTitle}` : '';
    return `[SOURCE ${index + 1}: "${item.document_title}" in collection "${item.collection_name}"${sectionLabel}${sourceLabel}]\n${item.parent_text}\n[END SOURCE ${index + 1}]`;
  });

  const formattedContext = [
    ...header,
    '### Retrieved passages',
    'Use the following verified reference sources to answer the user accurately.',
    'When using facts from a reference source, append its citation marker like [^1], [^2] at the end of the sentence.',
    '',
    ...contextParts,
    '[END KNOWLEDGE BASE RETRIEVAL]',
  ].join('\n');

  return {
    context: formattedContext,
    citations,
    chunkCount: selected.length,
    // Includes the query-rewriter's generation, which is real provider spend
    // and was previously invisible to quotas and analytics.
    tokensUsed: usedTokens + transformTokens,
    reranked,
    queryVariants: searchQueries.length,
  };
};

module.exports = {
  createParentChildChunks,
  buildEmbeddingText,
  fuseByReciprocalRank,
  ingestDocumentContent,
  extractCollectionMentions,
  searchKnowledgeCollections,
};
