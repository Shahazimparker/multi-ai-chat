// ============================================================
// FILE: backend/services/knowledgeGraph.service.js
// PURPOSE: Extract entities and relations from chunks, so retrieval can reach
//          answers that no single chunk contains.
//
//   WHY. Dense and sparse retrieval both ask "which chunk resembles this
//   query?". A question whose answer is assembled from two passages is out of
//   reach of both, because the answer is not textually similar to the question.
//   A graph makes the join explicit: entities are nodes, the facts connecting
//   them are edges, and each carries the chunk it came from so an answer stays
//   citable.
//
//   COST. This is the expensive technique in the stack: one LLM call per chunk
//   at ingest, versus RAPTOR's one per cluster. That is why extraction is a
//   deliberate, resumable batch job rather than part of upload, and why it
//   leads with the free-quota model.
//
//   WHAT IT DOES NOT DO. Entities are matched by name at query time, not
//   resolved semantically — "SSE" and "server-sent events" stay separate nodes
//   unless the model happens to emit the same surface form. Proper coreference
//   resolution is a much larger problem, and pretending otherwise would make
//   the graph look more complete than it is.
// ============================================================

const supabase = require('../config/supabase');
const dispatcher = require('./ai/dispatcher.service');
const { trimTextByTokens } = require('./tokenBudget.service');

const cfg = () => ({
  enabled: String(process.env.GRAPHRAG_ENABLED ?? 'true').toLowerCase() !== 'false',
  // Entities per chunk. A cap keeps the model from listing every noun.
  maxEntitiesPerChunk: Number(process.env.GRAPHRAG_MAX_ENTITIES || 8),
  maxRelationsPerChunk: Number(process.env.GRAPHRAG_MAX_RELATIONS || 8),
  concurrency: Number(process.env.GRAPHRAG_CONCURRENCY || 3),
  chunkTokenBudget: Number(process.env.GRAPHRAG_CHUNK_TOKENS || 700),
});

const isEnabled = () => cfg().enabled;

/**
 * A closed set of entity types.
 *
 * Left open, the model invents a fresh taxonomy per chunk — one real run
 * produced 30 distinct types across 90 entities, including "shape",
 * "ShapeType", "shape_category" and "category" as four separate things. Types
 * are stored for later filtering, and a vocabulary that varies per chunk is
 * useless for that. Anything unrecognised is coerced to "other" rather than
 * kept, so the column stays queryable.
 */
const ENTITY_TYPES = [
  'person', 'organization', 'product', 'technology', 'concept',
  'identifier', 'location', 'event', 'document', 'other',
];

const coerceType = (raw) => {
  const value = String(raw || '').toLowerCase().trim().replace(/[\s_-]+/g, '');
  const match = ENTITY_TYPES.find((t) => t === value);
  return match || 'other';
};

/** Free-quota model first, same reasoning as the vision and RAPTOR chains. */
const extractionChain = () => [
  {
    provider: 'mistral',
    model: process.env.GRAPHRAG_FREE_MODEL || 'mistral-small-latest',
    apiKey: process.env.MISTRAL_SUMMARY_API_KEY || process.env.MISTRAL_API_KEY,
  },
  {
    provider: 'openrouter',
    model: process.env.GRAPHRAG_MODEL || 'google/gemini-2.5-flash-lite',
    apiKey: process.env.OPENROUTER_API_KEY,
  },
].filter((c) => c.apiKey);

/**
 * The dedupe key. Case and surrounding punctuation vary between mentions of
 * the same thing; the interior is left alone so identifiers like
 * "mxgraph.flowchart.decision" survive intact.
 */
const normalizeName = (name) => String(name || '')
  .toLowerCase()
  .replace(/\s+/g, ' ')
  .replace(/^[^a-z0-9]+|[^a-z0-9)\]]+$/g, '')
  .trim();

const buildPrompt = (chunkText, documentTitle) => {
  const c = cfg();
  return [
    'Extract the entities and relationships stated in the passage below.',
    '',
    'Rules:',
    `- At most ${c.maxEntitiesPerChunk} entities and ${c.maxRelationsPerChunk} relationships.`,
    `- "type" MUST be exactly one of: ${ENTITY_TYPES.join(', ')}. Use "other" if none fit.`,
    '- Only what the passage actually states. Do not infer, generalise or add outside knowledge.',
    '- Use the exact surface form from the text, including identifiers and code strings.',
    '- Every relationship\'s source and target MUST also appear in the entities list.',
    '- Reply with JSON only, no prose and no code fence.',
    '',
    'Schema:',
    '{"entities":[{"name":"...","type":"...","description":"..."}],',
    ' "relations":[{"source":"...","target":"...","relation":"..."}]}',
    '',
    documentTitle ? `Document: ${documentTitle}` : '',
    'Passage:',
    chunkText,
  ].filter(Boolean).join('\n');
};

/** Models wrap JSON in prose or fences despite instructions; recover it. */
const parseExtraction = (raw) => {
  const text = String(raw || '').trim();
  if (!text) return null;

  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced ? fenced[1] : text;

  const start = candidate.indexOf('{');
  const end = candidate.lastIndexOf('}');
  if (start < 0 || end <= start) return null;

  try {
    const parsed = JSON.parse(candidate.slice(start, end + 1));
    return {
      entities: Array.isArray(parsed.entities) ? parsed.entities : [],
      relations: Array.isArray(parsed.relations) ? parsed.relations : [],
    };
  } catch {
    return null;
  }
};

/**
 * extractFromChunk — entities and relations stated in one chunk.
 * Returns null when every model failed; the caller skips that chunk rather
 * than writing a half-formed graph.
 */
const extractFromChunk = async (chunkText, { documentTitle = '', signal = null } = {}) => {
  const c = cfg();
  const prompt = buildPrompt(trimTextByTokens(chunkText, c.chunkTokenBudget), documentTitle);
  let tokensUsed = 0;

  for (const model of extractionChain()) {
    try {
      const res = await dispatcher.dispatchToAI(
        model,
        [{ role: 'user', content: prompt }],
        signal,
        { disableTools: true }
      );
      tokensUsed += res?.tokensUsed || 0;

      const parsed = parseExtraction(res?.text);
      if (!parsed) {
        console.warn(`[Graph] ${model.provider}/${model.model} returned unparseable JSON.`);
        continue;
      }

      // Drop relations whose endpoints were not declared as entities. The model
      // is told not to do this; when it does anyway, the edge would point at a
      // node that does not exist.
      const names = new Set(parsed.entities.map((e) => normalizeName(e?.name)).filter(Boolean));
      const relations = parsed.relations.filter((r) =>
        names.has(normalizeName(r?.source)) && names.has(normalizeName(r?.target))
        && normalizeName(r?.source) !== normalizeName(r?.target));

      return {
        entities: parsed.entities.slice(0, c.maxEntitiesPerChunk),
        relations: relations.slice(0, c.maxRelationsPerChunk),
        tokensUsed,
      };
    } catch (err) {
      if (err?.name === 'AbortError' || err?.name === 'CanceledError') throw err;
      console.warn(`[Graph] Extraction via ${model.provider}/${model.model} failed: ${err.message}`);
    }
  }

  return { entities: [], relations: [], tokensUsed, failed: true };
};

/**
 * Upsert entities for a collection and return normalized_name -> id.
 * Repeated mentions strengthen an existing node rather than duplicating it.
 */
const persistEntities = async (collectionId, entities) => {
  const byName = new Map();
  for (const e of entities) {
    const normalized = normalizeName(e?.name);
    if (!normalized || normalized.length < 2) continue;
    if (!byName.has(normalized)) {
      byName.set(normalized, {
        collection_id: collectionId,
        name: String(e.name).trim(),
        normalized_name: normalized,
        entity_type: coerceType(e?.type),
        description: e?.description ? String(e.description).slice(0, 500) : null,
      });
    }
  }

  if (byName.size === 0) return new Map();

  const { data, error } = await supabase
    .from('knowledge_entities')
    .upsert([...byName.values()], { onConflict: 'collection_id,normalized_name' })
    .select('id, normalized_name');

  if (error) throw new Error(`Could not persist entities: ${error.message}`);

  return new Map((data || []).map((row) => [row.normalized_name, row.id]));
};

const persistRelations = async (collectionId, relations, idByName, chunkId) => {
  const rows = [];
  const seen = new Set();

  for (const r of relations) {
    const sourceId = idByName.get(normalizeName(r?.source));
    const targetId = idByName.get(normalizeName(r?.target));
    const relation = String(r?.relation || '').trim().slice(0, 120);
    if (!sourceId || !targetId || !relation || sourceId === targetId) continue;

    const key = `${sourceId}|${targetId}|${relation.toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);

    rows.push({
      collection_id: collectionId,
      source_entity_id: sourceId,
      target_entity_id: targetId,
      relation,
      chunk_id: chunkId,
    });
  }

  if (rows.length === 0) return 0;

  const { error } = await supabase
    .from('knowledge_relations')
    .upsert(rows, { onConflict: 'source_entity_id,target_entity_id,relation', ignoreDuplicates: true });

  if (error) throw new Error(`Could not persist relations: ${error.message}`);
  return rows.length;
};

const linkEntitiesToChunk = async (entityIds, chunkId) => {
  if (entityIds.length === 0) return;
  const rows = entityIds.map((entity_id) => ({ entity_id, chunk_id: chunkId }));
  const { error } = await supabase
    .from('knowledge_entity_chunks')
    .upsert(rows, { onConflict: 'entity_id,chunk_id', ignoreDuplicates: true });
  if (error) throw new Error(`Could not link entities to chunk: ${error.message}`);
};

/** Remove a document's graph contribution so a rebuild is idempotent. */
const clearDocumentGraph = async (documentId) => {
  const { data: chunks } = await supabase
    .from('knowledge_chunks')
    .select('id')
    .eq('document_id', documentId);

  const chunkIds = (chunks || []).map((c) => c.id);
  if (chunkIds.length === 0) return;

  // Entities are shared across documents in a collection, so only the links
  // and the edges traceable to these chunks are removed. Orphaned nodes are
  // harmless: with no chunk links they can never be returned by retrieval.
  await supabase.from('knowledge_entity_chunks').delete().in('chunk_id', chunkIds);
  await supabase.from('knowledge_relations').delete().in('chunk_id', chunkIds);
};

/**
 * buildDocumentGraph — extract over every chunk of one document.
 *
 * Deadline-aware and resumable: chunks already linked are skipped, so a run cut
 * short by a platform timeout resumes where it stopped instead of re-billing
 * work already done.
 */
const buildDocumentGraph = async (opts) => {
  const {
    documentId,
    collectionId,
    documentTitle = '',
    signal = null,
    deadlineAt = null,
    force = false,
  } = opts;

  const c = cfg();
  const out = { chunksProcessed: 0, entities: 0, relations: 0, tokensUsed: 0, stopped: false, skipped: null };

  if (!c.enabled) return { ...out, skipped: 'disabled' };
  if (extractionChain().length === 0) return { ...out, skipped: 'no extraction model configured' };

  if (force) await clearDocumentGraph(documentId);

  const { data: chunks, error } = await supabase
    .from('knowledge_chunks')
    .select('id, chunk_text, metadata, collection_id')
    .eq('document_id', documentId)
    .order('chunk_index', { ascending: true });

  if (error) throw new Error(`Could not load chunks: ${error.message}`);

  // Summary nodes are synthesis, not source text. Extracting from them would
  // create edges the document never actually states.
  let pending = (chunks || []).filter((ch) => ch.metadata?.raptor !== true);

  if (!force) {
    const { data: linked } = await supabase
      .from('knowledge_entity_chunks')
      .select('chunk_id')
      .in('chunk_id', pending.map((ch) => ch.id));
    const done = new Set((linked || []).map((l) => l.chunk_id));
    pending = pending.filter((ch) => !done.has(ch.id));
  }

  if (pending.length === 0) return { ...out, skipped: 'already extracted' };

  const resolvedCollectionId = collectionId || chunks[0]?.collection_id;
  let index = 0;

  const worker = async () => {
    while (true) {
      if (deadlineAt && Date.now() > deadlineAt) { out.stopped = true; return; }
      if (signal?.aborted) throw { name: 'AbortError' };

      const i = index++;
      if (i >= pending.length) return;
      const chunk = pending[i];

      const extracted = await extractFromChunk(chunk.chunk_text, { documentTitle, signal });
      out.tokensUsed += extracted.tokensUsed;
      if (extracted.failed || extracted.entities.length === 0) continue;

      const idByName = await persistEntities(resolvedCollectionId, extracted.entities);
      const entityIds = [...idByName.values()];

      await linkEntitiesToChunk(entityIds, chunk.id);
      const relCount = await persistRelations(resolvedCollectionId, extracted.relations, idByName, chunk.id);

      out.chunksProcessed++;
      out.entities += idByName.size;
      out.relations += relCount;
    }
  };

  await Promise.all(Array.from({ length: Math.min(c.concurrency, pending.length) }, worker));
  return out;
};

module.exports = {
  ENTITY_TYPES,
  coerceType,
  buildDocumentGraph,
  clearDocumentGraph,
  extractFromChunk,
  parseExtraction,
  normalizeName,
  extractionChain,
  isEnabled,
  cfg,
};
