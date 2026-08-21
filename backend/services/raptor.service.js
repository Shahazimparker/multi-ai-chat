// ============================================================
// FILE: backend/services/raptor.service.js
// PURPOSE: RAPTOR — recursive summary tree over a document's chunks.
//
//   THE PROBLEM. Chunks are independent islands. "What does this document
//   cover?" or "what are the main categories?" has no answer in any single
//   chunk, so retrieval returns whichever fragment is least unrelated and the
//   model answers from scraps. This is why rag2 carries a hand-written
//   manifest of document titles: a partial workaround for exactly this gap.
//
//   THE FIX. Cluster a document's chunks by embedding similarity, summarise
//   each cluster, embed the summary, and repeat on the summaries. The result
//   is a tree whose leaves are the original chunks and whose upper levels are
//   progressively broader syntheses. Retrieval searches every level at once:
//   a specific question matches a leaf, a broad one matches a summary.
//
//   WHY SUMMARIES ARE JUST CHUNKS. They are written to knowledge_chunks with
//   metadata.level, so match_knowledge_chunks and the FTS function find them
//   with no query-side change and no migration. The cross-encoder reranker
//   then decides per query whether a summary or a leaf is the better answer,
//   which is exactly the judgement RAPTOR needs and already exists here.
//
//   WHY THE TREE IS PER DOCUMENT. Both retrieval RPCs INNER JOIN
//   knowledge_documents on chunk.document_id, so a summary spanning several
//   documents would either be unretrievable (null document_id) or be
//   mis-attributed to one of them — and that attribution reaches the user as a
//   citation. Per-document trees keep every citation literally true.
//
//   WHY IT IS RESUMABLE. Vercel Hobby caps a function at 10s by default and
//   60s at most, while summarising 20 clusters costs far more than that. Every
//   entry point takes a deadline, stops cleanly when it runs out, and reports
//   how far it got. Re-running continues from there. The CLI script has no such
//   limit and is the intended path for bulk builds.
// ============================================================

const supabase = require('../config/supabase');
const dispatcher = require('./ai/dispatcher.service');
const ragService = require('./rag.service');
const { estimateTokens, trimTextByTokens } = require('./tokenBudget.service');

const cfg = () => ({
  enabled: String(process.env.RAPTOR_ENABLED ?? 'true').toLowerCase() !== 'false',
  // Children per cluster. Lower means a taller tree and more LLM calls.
  branchFactor: Number(process.env.RAPTOR_BRANCH_FACTOR || 5),
  // Depth cap. Level 0 is the original chunks.
  maxLevels: Number(process.env.RAPTOR_MAX_LEVELS || 3),
  // A document with fewer chunks than this fits in a prompt whole; a tree over
  // it would cost LLM calls to summarise what retrieval could already return.
  minChunks: Number(process.env.RAPTOR_MIN_CHUNKS || 8),
  // Concurrent summarisation calls. Enough to be quick, few enough to avoid
  // tripping a free tier's rate limit mid-build.
  concurrency: Number(process.env.RAPTOR_CONCURRENCY || 3),
  summaryTokenBudget: Number(process.env.RAPTOR_SUMMARY_TOKENS || 220),
});

const isEnabled = () => cfg().enabled;

/** Free-quota model first, same reasoning as the vision chain. */
const summaryChain = () => [
  {
    provider: 'mistral',
    model: process.env.RAPTOR_FREE_MODEL || 'mistral-small-latest',
    apiKey: process.env.MISTRAL_SUMMARY_API_KEY || process.env.MISTRAL_API_KEY,
  },
  {
    provider: 'openrouter',
    model: process.env.RAPTOR_MODEL || 'google/gemini-2.5-flash-lite',
    apiKey: process.env.OPENROUTER_API_KEY,
  },
].filter((c) => c.apiKey);

// ── Clustering ──────────────────────────────────────────────

const dot = (a, b) => {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i] * b[i];
  return s;
};

const norm = (a) => Math.sqrt(dot(a, a)) || 1;

const cosine = (a, b) => dot(a, b) / (norm(a) * norm(b));

/**
 * Deterministic PRNG. Seeding matters: an unseeded k-means gives a different
 * tree on every rebuild, so a re-index would silently reshuffle what users
 * retrieve for no reason.
 */
const seededRandom = (seed) => {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
};

/**
 * k-means over embeddings, cosine distance, deterministic.
 *
 * k-means++ seeding rather than random: picking far-apart starting centroids
 * avoids the degenerate split where one cluster swallows nearly everything and
 * the summary for it says nothing useful.
 *
 * @returns {number[][]} clusters as arrays of indices into `vectors`
 */
const kMeans = (vectors, k, { maxIterations = 25, seed = 42 } = {}) => {
  const n = vectors.length;
  if (n === 0) return [];
  if (k <= 1) return [vectors.map((_, i) => i)];
  if (k >= n) return vectors.map((_, i) => [i]);

  const rand = seededRandom(seed);

  // k-means++ seeding
  const centroids = [vectors[Math.floor(rand() * n)].slice()];
  while (centroids.length < k) {
    const distances = vectors.map((v) => {
      const best = Math.max(...centroids.map((c) => cosine(v, c)));
      return Math.max(0, 1 - best); // cosine distance
    });
    const total = distances.reduce((s, d) => s + d, 0);
    if (total === 0) {
      centroids.push(vectors[Math.floor(rand() * n)].slice());
      continue;
    }
    let target = rand() * total;
    let picked = n - 1;
    for (let i = 0; i < n; i++) {
      target -= distances[i];
      if (target <= 0) { picked = i; break; }
    }
    centroids.push(vectors[picked].slice());
  }

  let assignment = new Array(n).fill(0);

  for (let iter = 0; iter < maxIterations; iter++) {
    let moved = false;

    for (let i = 0; i < n; i++) {
      let bestIdx = 0;
      let bestSim = -Infinity;
      for (let c = 0; c < centroids.length; c++) {
        const sim = cosine(vectors[i], centroids[c]);
        if (sim > bestSim) { bestSim = sim; bestIdx = c; }
      }
      if (assignment[i] !== bestIdx) { assignment[i] = bestIdx; moved = true; }
    }

    if (!moved && iter > 0) break;

    const dims = vectors[0].length;
    const sums = centroids.map(() => new Array(dims).fill(0));
    const counts = new Array(centroids.length).fill(0);
    for (let i = 0; i < n; i++) {
      const c = assignment[i];
      counts[c]++;
      const v = vectors[i];
      for (let d = 0; d < dims; d++) sums[c][d] += v[d];
    }
    for (let c = 0; c < centroids.length; c++) {
      if (counts[c] === 0) continue;
      for (let d = 0; d < dims; d++) centroids[c][d] = sums[c][d] / counts[c];
    }
  }

  const clusters = centroids.map(() => []);
  assignment.forEach((c, i) => clusters[c].push(i));
  return clusters.filter((c) => c.length > 0);
};

// ── Summarisation ───────────────────────────────────────────

const buildSummaryPrompt = (texts, documentTitle, level) => {
  const scope = level === 1
    ? 'passages from a document'
    : 'summaries of sections of a document';

  return [
    `Write a single condensed summary of the following ${scope}.`,
    '',
    'Rules:',
    '- Cover what the material as a whole is about, and what topics it contains.',
    '- Keep concrete identifiers verbatim: names, codes, style strings, version numbers.',
    '- Write plain prose. No preamble, no bullet list, no "this document".',
    `- Around ${cfg().summaryTokenBudget} tokens.`,
    '',
    documentTitle ? `Document: ${documentTitle}` : '',
    '',
    ...texts.map((t, i) => `--- ${i + 1} ---\n${t}`),
  ].filter(Boolean).join('\n');
};

/**
 * Summarise one cluster, trying each configured model in turn.
 * Returns null if every model failed — the caller drops that cluster rather
 * than writing a placeholder into the index.
 */
const summarizeCluster = async (texts, { documentTitle, level, signal }) => {
  const prompt = buildSummaryPrompt(texts, documentTitle, level);
  let tokensUsed = 0;

  for (const model of summaryChain()) {
    try {
      const res = await dispatcher.dispatchToAI(
        model,
        [{ role: 'user', content: prompt }],
        signal,
        { disableTools: true }
      );
      tokensUsed += res?.tokensUsed || 0;
      const text = String(res?.text || '').trim();
      if (text) return { text, tokensUsed, model: `${model.provider}/${model.model}` };
    } catch (err) {
      if (err?.name === 'AbortError' || err?.name === 'CanceledError') throw err;
      console.warn(`[Raptor] Summary via ${model.provider}/${model.model} failed: ${err.message}`);
    }
  }

  return { text: null, tokensUsed, model: null };
};

/** Run tasks with bounded concurrency, stopping early when the deadline passes. */
const mapWithConcurrency = async (items, limit, fn, deadlineAt) => {
  const results = [];
  let index = 0;
  let stopped = false;

  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (true) {
      if (deadlineAt && Date.now() > deadlineAt) { stopped = true; return; }
      const i = index++;
      if (i >= items.length) return;
      results[i] = await fn(items[i], i);
    }
  });

  await Promise.all(workers);
  return { results: results.filter((r) => r !== undefined), stopped };
};

// ── Tree building ───────────────────────────────────────────

const loadLevel = async (documentId, level) => {
  const { data, error } = await supabase
    .from('knowledge_chunks')
    .select('id, chunk_text, embedding, metadata, chunk_index, collection_id, document_id')
    .eq('document_id', documentId)
    .order('chunk_index', { ascending: true });

  if (error) throw new Error(`Could not load chunks: ${error.message}`);

  return (data || []).filter((row) => (Number(row.metadata?.level) || 0) === level);
};

/**
 * Highest level that already has summary nodes, or 0 if the tree is only
 * leaves. Drives resumption across invocations.
 */
const highestBuiltLevel = async (documentId) => {
  const { data, error } = await supabase
    .from('knowledge_chunks')
    .select('metadata')
    .eq('document_id', documentId);

  if (error) throw new Error(`Could not read chunk levels: ${error.message}`);

  return (data || []).reduce((max, row) => {
    const level = Number(row?.metadata?.level) || 0;
    return row?.metadata?.raptor === true && level > max ? level : max;
  }, 0);
};

const countLevel = async (documentId, level) => {
  const rows = await loadLevel(documentId, level);
  return rows.length;
};

/** Remove previously generated summary rows so a rebuild is idempotent. */
const clearTree = async (documentId) => {
  const { data, error } = await supabase
    .from('knowledge_chunks')
    .select('id, metadata')
    .eq('document_id', documentId);

  if (error) throw new Error(`Could not read chunks: ${error.message}`);

  const summaryIds = (data || [])
    .filter((r) => r.metadata?.raptor === true)
    .map((r) => r.id);

  if (summaryIds.length === 0) return 0;

  const { error: delError } = await supabase
    .from('knowledge_chunks')
    .delete()
    .in('id', summaryIds);

  if (delError) throw new Error(`Could not clear summaries: ${delError.message}`);
  return summaryIds.length;
};

const parseEmbedding = (value) => {
  if (Array.isArray(value)) return value;
  // pgvector comes back as a "[1,2,3]" string over PostgREST.
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed : null;
    } catch { return null; }
  }
  return null;
};

/**
 * buildDocumentTree — build every level above the leaves for one document.
 *
 * @param {{ documentId, userId, collectionId?, documentTitle?, embedProvider?,
 *           signal?, deadlineAt?, force? }} opts
 * @returns {Promise<{ levelsBuilt, nodesCreated, tokensUsed, stopped, skipped }>}
 */
const buildDocumentTree = async (opts) => {
  const {
    documentId,
    userId,
    documentTitle = '',
    embedProvider = 'openrouter',
    signal = null,
    deadlineAt = null,
    force = false,
  } = opts;

  const c = cfg();
  const out = { levelsBuilt: 0, nodesCreated: 0, tokensUsed: 0, stopped: false, skipped: null };

  if (!c.enabled) return { ...out, skipped: 'disabled' };
  if (summaryChain().length === 0) return { ...out, skipped: 'no summarisation model configured' };

  // Resume rather than restart. A 10s Vercel Hobby invocation cannot finish a
  // real document, so the endpoint is expected to be called repeatedly; if each
  // call wiped the tree and began again it would never converge, just burn
  // tokens. `force` is the explicit "throw it away and rebuild" path.
  const highest = await highestBuiltLevel(documentId);

  if (force || highest === 0) {
    const cleared = await clearTree(documentId);
    if (cleared > 0) console.log(`[Raptor] Cleared ${cleared} summary node(s) for ${documentId}.`);
  }

  let level = force ? 0 : highest;
  let current = await loadLevel(documentId, level);

  if (level > 0) {
    console.log(`[Raptor] Resuming ${documentId} from level ${level} (${current.length} node(s)).`);
  }

  const leafCount = level === 0 ? current.length : await countLevel(documentId, 0);
  if (leafCount < c.minChunks && !force) {
    return { ...out, skipped: `only ${leafCount} chunk(s); below RAPTOR_MIN_CHUNKS=${c.minChunks}` };
  }

  const collectionId = current[0]?.collection_id;

  while (level + 1 < c.maxLevels && current.length > 1) {
    if (deadlineAt && Date.now() > deadlineAt) { out.stopped = true; break; }
    if (signal?.aborted) throw { name: 'AbortError' };

    const vectors = current.map((r) => parseEmbedding(r.embedding));
    if (vectors.some((v) => !v)) {
      console.warn('[Raptor] Some chunks have no usable embedding; stopping tree build.');
      break;
    }

    const k = Math.max(1, Math.ceil(current.length / c.branchFactor));
    if (k >= current.length) break; // no grouping possible

    const clusters = kMeans(vectors, k, { seed: 42 });
    const nextLevel = level + 1;

    const { results, stopped } = await mapWithConcurrency(
      clusters,
      c.concurrency,
      async (memberIdxs) => {
        const texts = memberIdxs.map((i) => trimTextByTokens(current[i].chunk_text, 400));
        const summary = await summarizeCluster(texts, { documentTitle, level: nextLevel, signal });
        out.tokensUsed += summary.tokensUsed;
        if (!summary.text) return null;

        const embed = await ragService.embedText(summary.text, embedProvider, 3, signal, userId);
        if (!embed?.vector) return null;
        out.tokensUsed += embed.tokensUsed || 0;

        return {
          document_id: documentId,
          collection_id: collectionId,
          chunk_text: summary.text,
          // Leaves carry a wider parent window for the prompt; a summary is
          // already the wide view, so it is its own parent.
          parent_text: summary.text,
          chunk_index: nextLevel * 100000 + memberIdxs[0],
          embedding: embed.vector,
          metadata: {
            raptor: true,
            level: nextLevel,
            childCount: memberIdxs.length,
            childIds: memberIdxs.map((i) => current[i].id),
            documentTitle,
            sectionTitle: `Summary (level ${nextLevel})`,
            tokens: estimateTokens(summary.text),
            contextualized: true,
          },
        };
      },
      deadlineAt
    );

    const rows = results.filter(Boolean);
    if (rows.length === 0) {
      console.warn(`[Raptor] Level ${nextLevel} produced no usable summaries; stopping.`);
      break;
    }

    const { data: inserted, error } = await supabase
      .from('knowledge_chunks')
      .insert(rows)
      .select('id, chunk_text, embedding, metadata, chunk_index, collection_id, document_id');

    if (error) throw new Error(`Could not insert summaries: ${error.message}`);

    out.nodesCreated += rows.length;
    out.levelsBuilt += 1;
    console.log(`[Raptor] Level ${nextLevel}: ${current.length} node(s) -> ${rows.length} summary node(s).`);

    if (stopped) { out.stopped = true; break; }

    current = inserted || [];
    level = nextLevel;
  }

  return out;
};

module.exports = {
  buildDocumentTree,
  clearTree,
  highestBuiltLevel,
  kMeans,
  cosine,
  summarizeCluster,
  summaryChain,
  isEnabled,
  cfg,
};
