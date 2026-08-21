#!/usr/bin/env node
// ============================================================
// FILE: backend/scripts/build-raptor-tree.js
// PURPOSE: Build RAPTOR summary trees over indexed documents.
//
//   Run this from your own machine rather than the deployed app. Vercel Hobby
//   caps a function at 10s by default (60s at most), and summarising a real
//   document costs far more than that. The service is resumable so the API can
//   chip away at it, but a CLI run has no such limit and finishes in one pass.
//
// USAGE:
//   node backend/scripts/build-raptor-tree.js --list
//   node backend/scripts/build-raptor-tree.js --document <uuid> [--force]
//   node backend/scripts/build-raptor-tree.js --collection <uuid> [--force]
//   node backend/scripts/build-raptor-tree.js --all [--dry-run] [--force]
//
// SAFETY:
//   - --dry-run reports what would be built and makes no API calls.
//   - Without --force, a document whose tree already exists resumes from the
//     highest level built rather than starting over.
//   - Summary nodes are ordinary rows in knowledge_chunks tagged
//     metadata.raptor, so --force cleanly removes them. Leaf chunks are never
//     touched, and no re-embedding of the original text happens.
// ============================================================

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const supabase = require('../config/supabase');
const raptor = require('../services/raptor.service');
const { DEFAULT_PROVIDER } = require('../config/embedding');

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
    .select('id, title, collection_id, chunk_count, status, knowledge_collections(name, user_id, embedding_provider)')
    .eq('status', 'indexed');

  if (documentId) q = q.eq('id', documentId);
  else if (collectionId) q = q.eq('collection_id', collectionId);
  else if (!all) return [];

  const { data, error } = await q;
  if (error) throw new Error(error.message);
  return data || [];
};

const treeStats = async (documentId) => {
  const { data, error } = await supabase
    .from('knowledge_chunks')
    .select('metadata')
    .eq('document_id', documentId);

  if (error) throw new Error(error.message);

  const byLevel = new Map();
  for (const row of data || []) {
    const level = Number(row?.metadata?.level) || 0;
    byLevel.set(level, (byLevel.get(level) || 0) + 1);
  }
  return byLevel;
};

const describeTree = (byLevel) => {
  const levels = [...byLevel.entries()].sort((a, b) => a[0] - b[0]);
  return levels.map(([level, count]) => `L${level}:${count}`).join(' ');
};

const listAll = async () => {
  const docs = await loadDocuments({ all: true });
  if (!docs.length) { console.log('No indexed documents found.'); return; }

  console.log('\nIndexed documents:\n');
  for (const doc of docs) {
    const byLevel = await treeStats(doc.id);
    const built = [...byLevel.keys()].some((l) => l > 0);
    console.log(
      '  ' + doc.id +
      '  ' + String(doc.title || '(untitled)').slice(0, 34).padEnd(36) +
      describeTree(byLevel).padEnd(22) +
      (built ? 'tree built' : 'no tree')
    );
  }
  console.log('');
};

const buildOne = async (doc, { dryRun, force }) => {
  const collection = doc.knowledge_collections || {};
  const byLevel = await treeStats(doc.id);
  const leaves = byLevel.get(0) || 0;
  const c = raptor.cfg();

  console.log(`\n[${doc.title || doc.id}]`);
  console.log(`  chunks : ${leaves} leaf | current tree: ${describeTree(byLevel) || '(none)'}`);

  if (dryRun) {
    if (leaves < c.minChunks && !force) {
      console.log(`  DRY RUN — would SKIP (below RAPTOR_MIN_CHUNKS=${c.minChunks})`);
      return { nodesCreated: 0, tokensUsed: 0 };
    }
    // Mirror the service's arithmetic so the estimate cannot drift from it.
    let n = leaves;
    let calls = 0;
    for (let level = 0; level + 1 < c.maxLevels && n > 1; level++) {
      const k = Math.max(1, Math.ceil(n / c.branchFactor));
      if (k >= n) break;
      calls += k;
      n = k;
    }
    console.log(`  DRY RUN — would create ~${calls} summary node(s) using ~${calls} LLM call(s) + ~${calls} embedding(s)`);
    return { nodesCreated: 0, tokensUsed: 0 };
  }

  const result = await raptor.buildDocumentTree({
    documentId: doc.id,
    userId: collection.user_id,
    documentTitle: doc.title || '',
    embedProvider: collection.embedding_provider || DEFAULT_PROVIDER,
    force,
  });

  if (result.skipped) {
    console.log(`  skipped: ${result.skipped}`);
    return result;
  }

  const after = await treeStats(doc.id);
  console.log(`  built  : ${result.levelsBuilt} level(s), ${result.nodesCreated} node(s), ~${result.tokensUsed} tokens`);
  console.log(`  tree   : ${describeTree(after)}`);
  return result;
};

const main = async () => {
  const args = parseArgs();

  if (args.list) { await listAll(); return; }

  if (!args.documentId && !args.collectionId && !args.all) {
    console.log('Usage:');
    console.log('  node backend/scripts/build-raptor-tree.js --list');
    console.log('  node backend/scripts/build-raptor-tree.js --document <uuid> [--force]');
    console.log('  node backend/scripts/build-raptor-tree.js --collection <uuid> [--force]');
    console.log('  node backend/scripts/build-raptor-tree.js --all [--dry-run] [--force]');
    process.exitCode = 1;
    return;
  }

  const docs = await loadDocuments(args);
  if (!docs.length) { console.log('No matching indexed documents.'); return; }

  const totals = { nodesCreated: 0, tokensUsed: 0 };
  for (const doc of docs) {
    const r = await buildOne(doc, args);
    totals.nodesCreated += r.nodesCreated || 0;
    totals.tokensUsed += r.tokensUsed || 0;
  }

  if (docs.length > 1) {
    console.log(`\nTotal: ${totals.nodesCreated} summary node(s), ~${totals.tokensUsed} tokens`);
  }
};

main().catch((err) => {
  console.error('[Raptor] Failed:', err.message);
  process.exit(1);
});
