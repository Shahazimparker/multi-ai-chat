#!/usr/bin/env node
// ============================================================
// FILE: backend/scripts/build-knowledge-graph.js
// PURPOSE: Extract the entity/relation graph for indexed documents.
//
//   This is the most expensive job in the stack: one LLM call per chunk, where
//   RAPTOR costs one per cluster. Run it deliberately, check --dry-run first,
//   and expect it to take a while on a large collection.
//
//   Extraction is resumable — chunks already linked to entities are skipped —
//   so interrupting it is safe and re-running continues rather than re-billing.
//
// USAGE:
//   node backend/scripts/build-knowledge-graph.js --list
//   node backend/scripts/build-knowledge-graph.js --document <uuid> [--force]
//   node backend/scripts/build-knowledge-graph.js --collection <uuid> [--force]
//   node backend/scripts/build-knowledge-graph.js --all [--dry-run] [--force]
// ============================================================

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const supabase = require('../config/supabase');
const graph = require('../services/knowledgeGraph.service');

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
    documentId: arg('--document'),
    collectionId: arg('--collection'),
  };
};

const loadDocuments = async ({ documentId, collectionId, all }) => {
  let q = supabase
    .from('knowledge_documents')
    .select('id, title, collection_id, status')
    .eq('status', 'indexed');

  if (documentId) q = q.eq('id', documentId);
  else if (collectionId) q = q.eq('collection_id', collectionId);
  else if (!all) return [];

  const { data, error } = await q;
  if (error) throw new Error(error.message);
  return data || [];
};

/** Leaf chunks only — summaries are synthesis and are never extracted from. */
const leafChunks = async (documentId) => {
  const { data, error } = await supabase
    .from('knowledge_chunks')
    .select('id, metadata')
    .eq('document_id', documentId);
  if (error) throw new Error(error.message);
  return (data || []).filter((c) => c.metadata?.raptor !== true);
};

const extractedCount = async (chunkIds) => {
  if (chunkIds.length === 0) return 0;
  const { data } = await supabase
    .from('knowledge_entity_chunks')
    .select('chunk_id')
    .in('chunk_id', chunkIds);
  return new Set((data || []).map((r) => r.chunk_id)).size;
};

const collectionGraphStats = async (collectionId) => {
  const [{ count: entities }, { count: relations }] = await Promise.all([
    supabase.from('knowledge_entities').select('id', { count: 'exact', head: true }).eq('collection_id', collectionId),
    supabase.from('knowledge_relations').select('id', { count: 'exact', head: true }).eq('collection_id', collectionId),
  ]);
  return { entities: entities || 0, relations: relations || 0 };
};

const listAll = async () => {
  const docs = await loadDocuments({ all: true });
  if (!docs.length) { console.log('No indexed documents found.'); return; }

  console.log('\nIndexed documents:\n');
  for (const doc of docs) {
    const chunks = await leafChunks(doc.id);
    const done = await extractedCount(chunks.map((c) => c.id));
    const stats = await collectionGraphStats(doc.collection_id);
    console.log(
      '  ' + doc.id +
      '  ' + String(doc.title || '(untitled)').slice(0, 32).padEnd(34) +
      `${done}/${chunks.length} chunks extracted`.padEnd(28) +
      `collection graph: ${stats.entities}e ${stats.relations}r`
    );
  }
  console.log('');
};

const buildOne = async (doc, { dryRun, force }) => {
  const chunks = await leafChunks(doc.id);
  const done = force ? 0 : await extractedCount(chunks.map((c) => c.id));
  const pending = chunks.length - done;

  console.log(`\n[${doc.title || doc.id}]`);
  console.log(`  chunks : ${chunks.length} leaf | already extracted: ${done} | pending: ${pending}`);

  if (dryRun) {
    console.log(`  DRY RUN — would make ~${pending} LLM call(s), one per pending chunk`);
    return { chunksProcessed: 0, entities: 0, relations: 0, tokensUsed: 0 };
  }

  if (pending === 0) { console.log('  nothing to do.'); return { chunksProcessed: 0, entities: 0, relations: 0, tokensUsed: 0 }; }

  const result = await graph.buildDocumentGraph({
    documentId: doc.id,
    collectionId: doc.collection_id,
    documentTitle: doc.title || '',
    force,
  });

  if (result.skipped) { console.log(`  skipped: ${result.skipped}`); return result; }

  const stats = await collectionGraphStats(doc.collection_id);
  console.log(`  built  : ${result.chunksProcessed} chunk(s), ~${result.tokensUsed} tokens`);
  console.log(`  graph  : ${stats.entities} entities, ${stats.relations} relations in this collection`);
  if (result.stopped) console.log('  NOTE: stopped on deadline — re-run to continue.');
  return result;
};

const main = async () => {
  const args = parseArgs();

  if (args.list) { await listAll(); return; }

  if (!args.documentId && !args.collectionId && !args.all) {
    console.log('Usage:');
    console.log('  node backend/scripts/build-knowledge-graph.js --list');
    console.log('  node backend/scripts/build-knowledge-graph.js --document <uuid> [--force]');
    console.log('  node backend/scripts/build-knowledge-graph.js --collection <uuid> [--force]');
    console.log('  node backend/scripts/build-knowledge-graph.js --all [--dry-run] [--force]');
    process.exitCode = 1;
    return;
  }

  const docs = await loadDocuments(args);
  if (!docs.length) { console.log('No matching indexed documents.'); return; }

  const totals = { chunksProcessed: 0, tokensUsed: 0 };
  for (const doc of docs) {
    const r = await buildOne(doc, args);
    totals.chunksProcessed += r.chunksProcessed || 0;
    totals.tokensUsed += r.tokensUsed || 0;
  }

  if (docs.length > 1) {
    console.log(`\nTotal: ${totals.chunksProcessed} chunk(s), ~${totals.tokensUsed} tokens`);
  }
};

main().catch((err) => {
  console.error('[Graph] Failed:', err.message);
  process.exit(1);
});
