#!/usr/bin/env node
// ============================================================
// FILE: backend/scripts/reindex-collection.js
// PURPOSE: Re-embed the chunks of a knowledge collection so they carry the
//          contextual title/section prefix (see buildEmbeddingText in
//          rag2.service.js).
//
//   Chunks indexed before contextual enrichment were embedded from bare chunk
//   text. Their vectors are still valid and still comparable — nothing is
//   broken — but they do not benefit from the prefix, so a collection ingested
//   before the change retrieves slightly worse than one ingested after it.
//
//   This re-embeds in place. It does NOT re-chunk, re-download or re-parse:
//   chunk_text and parent_text are read from the database and reused, so the
//   only cost is embedding tokens.
//
// USAGE:
//   node backend/scripts/reindex-collection.js --list
//   node backend/scripts/reindex-collection.js --collection <uuid> [--dry-run]
//   node backend/scripts/reindex-collection.js --all [--dry-run]
//
// SAFETY:
//   - --dry-run reports what would change and calls no embedding API.
//   - Chunks already marked contextualized are skipped unless --force.
//   - Each chunk is updated individually, so an interrupted run leaves a
//     partially-migrated collection that a re-run finishes. Nothing is deleted.
// ============================================================

// Resolve .env relative to this file, not the cwd, so the script works from
// the repo root as well as from backend/.
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const supabase = require('../config/supabase');
const ragService = require('../services/rag.service');
const { buildEmbeddingText } = require('../services/rag2.service');
const { DEFAULT_PROVIDER } = require('../config/embedding');

const BATCH_SIZE = 5; // matches the ingest path's rate-limit budget

const parseArgs = () => {
  const argv = process.argv.slice(2);
  const arg = (name) => {
    const i = argv.indexOf(name);
    return i >= 0 ? argv[i + 1] : null;
  };
  return {
    list: argv.includes('--list'),
    all: argv.includes('--all'),
    dryRun: argv.includes('--dry-run'),
    force: argv.includes('--force'),
    collectionId: arg('--collection'),
  };
};

const listCollections = async () => {
  const { data, error } = await supabase
    .from('knowledge_collections')
    .select('id, name, embedding_provider');
  if (error) throw error;

  if (!data?.length) {
    console.log('No collections found.');
    return;
  }

  console.log('\nCollections:\n');
  for (const col of data) {
    const { count: total } = await supabase
      .from('knowledge_chunks')
      .select('id', { count: 'exact', head: true })
      .eq('collection_id', col.id);

    const { count: done } = await supabase
      .from('knowledge_chunks')
      .select('id', { count: 'exact', head: true })
      .eq('collection_id', col.id)
      .eq('metadata->>contextualized', 'true');

    const pending = (total || 0) - (done || 0);
    const status = pending === 0 ? 'up to date' : `${pending} chunk(s) need re-indexing`;
    console.log(`  ${col.id}  ${(col.name || '(unnamed)').padEnd(28)} ${String(total || 0).padStart(5)} chunks  ${status}`);
  }
  console.log('');
};

const reindexCollection = async ({ collectionId, dryRun, force }) => {
  const { data: collection, error: colErr } = await supabase
    .from('knowledge_collections')
    .select('id, name, user_id, embedding_provider')
    .eq('id', collectionId)
    .single();

  if (colErr || !collection) {
    throw new Error(`Collection ${collectionId} not found: ${colErr?.message || 'no row'}`);
  }

  const provider = collection.embedding_provider || DEFAULT_PROVIDER;

  // Pull chunks with the document title they belong to — the prefix needs it.
  const { data: chunks, error: chunkErr } = await supabase
    .from('knowledge_chunks')
    .select('id, chunk_text, metadata, document_id, knowledge_documents(title)')
    .eq('collection_id', collectionId)
    .order('chunk_index', { ascending: true });

  if (chunkErr) throw chunkErr;

  const pending = (chunks || []).filter((c) => force || c.metadata?.contextualized !== true);

  console.log(`\n[${collection.name || collectionId}]`);
  console.log(`  provider: ${provider}`);
  console.log(`  chunks:   ${chunks?.length || 0} total, ${pending.length} to re-embed`);

  if (pending.length === 0) {
    console.log('  nothing to do.');
    return { embedded: 0, failed: 0, tokens: 0 };
  }

  if (dryRun) {
    const sample = pending[0];
    const title = sample.knowledge_documents?.title || '';
    console.log('  DRY RUN — no API calls made. Example of the new embedding input:');
    console.log('  ---');
    console.log(
      buildEmbeddingText(sample.chunk_text, title, sample.metadata?.sectionTitle)
        .slice(0, 300)
        .split('\n')
        .map((l) => `  | ${l}`)
        .join('\n')
    );
    console.log('  ---');
    return { embedded: 0, failed: 0, tokens: 0 };
  }

  let embedded = 0;
  let failed = 0;
  let tokens = 0;

  for (let i = 0; i < pending.length; i += BATCH_SIZE) {
    const batch = pending.slice(i, i + BATCH_SIZE);

    const results = await Promise.all(batch.map(async (chunk) => {
      const title = chunk.knowledge_documents?.title || '';
      const input = buildEmbeddingText(chunk.chunk_text, title, chunk.metadata?.sectionTitle);

      try {
        const res = await ragService.embedText(input, provider, 3, null, collection.user_id);
        if (!res?.vector) return { ok: false, id: chunk.id, reason: 'no vector returned' };

        const { error: updErr } = await supabase
          .from('knowledge_chunks')
          .update({
            embedding: res.vector,
            metadata: { ...(chunk.metadata || {}), contextualized: true },
          })
          .eq('id', chunk.id);

        if (updErr) return { ok: false, id: chunk.id, reason: updErr.message };
        return { ok: true, tokens: res.tokensUsed || 0 };
      } catch (err) {
        return { ok: false, id: chunk.id, reason: err.message };
      }
    }));

    for (const r of results) {
      if (r.ok) { embedded++; tokens += r.tokens; }
      else { failed++; console.warn(`  ! chunk ${r.id}: ${r.reason}`); }
    }

    const done = Math.min(i + BATCH_SIZE, pending.length);
    process.stdout.write(`\r  re-embedded ${done}/${pending.length}...`);
  }

  process.stdout.write('\n');
  console.log(`  done: ${embedded} embedded, ${failed} failed, ~${tokens} embedding tokens`);
  return { embedded, failed, tokens };
};

const main = async () => {
  const args = parseArgs();

  if (args.list) {
    await listCollections();
    return;
  }

  let targets = [];
  if (args.all) {
    const { data, error } = await supabase.from('knowledge_collections').select('id');
    if (error) throw error;
    targets = (data || []).map((c) => c.id);
  } else if (args.collectionId) {
    targets = [args.collectionId];
  } else {
    console.log('Usage:');
    console.log('  node backend/scripts/reindex-collection.js --list');
    console.log('  node backend/scripts/reindex-collection.js --collection <uuid> [--dry-run] [--force]');
    console.log('  node backend/scripts/reindex-collection.js --all [--dry-run] [--force]');
    process.exitCode = 1;
    return;
  }

  const totals = { embedded: 0, failed: 0, tokens: 0 };
  for (const id of targets) {
    const r = await reindexCollection({ collectionId: id, dryRun: args.dryRun, force: args.force });
    totals.embedded += r.embedded;
    totals.failed += r.failed;
    totals.tokens += r.tokens;
  }

  if (targets.length > 1) {
    console.log(`\nTotal: ${totals.embedded} embedded, ${totals.failed} failed, ~${totals.tokens} tokens`);
  }
  if (totals.failed > 0) process.exitCode = 1;
};

main().catch((err) => {
  console.error('[Reindex] Failed:', err.message);
  process.exit(1);
});
