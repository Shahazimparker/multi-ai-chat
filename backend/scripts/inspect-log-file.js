#!/usr/bin/env node
// ============================================================
// FILE: backend/scripts/inspect-log-file.js
// PURPOSE: Run a real log / trace / spreadsheet export through the exact
//          analysis chain the chat uses, straight from disk.
//
//   The file analysis (column classification, unit inference, SQL
//   fingerprinting, Drain templating, burst detection) is built from
//   heuristics. Unit tests prove the code does what was intended; they cannot
//   prove the intent matches a real ST05, AWR or pg_stat_statements export.
//   Only a real file answers that, and this is the cheapest way to ask.
//
//   Deliberately offline: it reads from disk, so it needs no upload, no
//   database, no Vercel Blob and no API key, costs nothing, and is not subject
//   to the 4MB request-body cap. A 200MB export can be checked before any of
//   the upload path is configured.
//
//   READ THE "HOW THIS FILE WAS READ" BLOCK FIRST. If the wrong column was
//   picked as the duration, every number under it describes something else —
//   that is the failure this script exists to catch.
//
// USAGE:
//   node backend/scripts/inspect-log-file.js <path>
//   node backend/scripts/inspect-log-file.js <path> --full     # + raw excerpts
//   node backend/scripts/inspect-log-file.js <path> --extract  # extracted text only
// ============================================================

const fs = require('fs');
const path = require('path');

const { loadDocument, getLoaderType } = require('../services/documentLoader.service');
const { profileTabularContent, describeTable } = require('../services/tabularProfiler.service');
const { mineLogTemplates } = require('../services/logTemplateMiner.service');

const args = process.argv.slice(2);
const filePath = args.find((a) => !a.startsWith('--'));
const showFull = args.includes('--full');
const extractOnly = args.includes('--extract');

if (!filePath) {
  console.error('Usage: node backend/scripts/inspect-log-file.js <path> [--full] [--extract]');
  process.exit(1);
}

if (!fs.existsSync(filePath)) {
  console.error(`No such file: ${filePath}`);
  process.exit(1);
}

const rule = (label) => `\n${'='.repeat(78)}\n${label}\n${'='.repeat(78)}`;

(async () => {
  const buffer = fs.readFileSync(filePath);
  const fileName = path.basename(filePath);
  const sizeMb = (buffer.length / 1048576).toFixed(2);

  console.log(rule('INPUT'));
  console.log(`file        : ${fileName}`);
  console.log(`size        : ${sizeMb} MB`);
  console.log(`loader type : ${getLoaderType(fileName)}`);

  // The 4MB direct-upload cap does not apply to this script, but it decides
  // whether the file could reach the app at all — worth noting while looking
  // at it.
  //
  // This only ever reports the environment the script is running in. Most
  // secrets in this project live in Vercel rather than a local .env, so a
  // missing token here is NOT evidence that production lacks it — do not
  // conclude anything about the deployment from this line.
  if (buffer.length > 4 * 1024 * 1024) {
    const blobHere = Boolean(process.env.BLOB_READ_WRITE_TOKEN);
    console.log(
      `note        : over the 4MB direct-upload cap, so uploading it needs Vercel Blob. ` +
      `BLOB_READ_WRITE_TOKEN is ${blobHere ? 'set' : 'not set'} in THIS environment ` +
      `(production is configured separately in Vercel).`
    );
  }

  let extracted;
  const t0 = Date.now();
  try {
    const loaded = await loadDocument(buffer, fileName);
    extracted = loaded.content || '';
    console.log(`extraction  : ${loaded.metadata?.extraction || loaded.metadata?.type || 'ok'} (${Date.now() - t0}ms)`);
    if (loaded.metadata?.sheets) console.log(`sheets      : ${loaded.metadata.sheets.join(', ')}`);
  } catch (err) {
    console.error(`\nExtraction failed: ${err.message}`);
    process.exit(1);
  }

  const lineCount = extracted.split('\n').length;
  console.log(`text        : ${extracted.length.toLocaleString()} chars, ${lineCount.toLocaleString()} lines`);

  if (extractOnly) {
    console.log(rule('EXTRACTED TEXT (first 200 lines)'));
    console.log(extracted.split('\n').slice(0, 200).join('\n'));
    return;
  }

  // Shown first because it is what the model sees first, and because it is the
  // path that does not depend on the header vocabulary — if the profile below
  // misreads a column, this is what the model uses to correct it.
  console.log(rule('TABLE SCHEMA  (column census — no meaning assumed)'));
  const t0c = Date.now();
  const census = describeTable(extracted, fileName);
  console.log(census || '(no table structure found)');
  console.log(`\n[${Date.now() - t0c}ms]`);

  console.log(rule('NUMERIC PROFILE  (tabularProfiler)'));
  const t1 = Date.now();
  const profile = profileTabularContent(extracted, fileName);
  console.log(profile || '(declined — no tabular shape and no timings found)');
  console.log(`\n[${Date.now() - t1}ms]`);

  console.log(rule('LOG STRUCTURE  (Drain templating + burst detection)'));
  const t2 = Date.now();
  const structure = mineLogTemplates(extracted, fileName);
  console.log(structure || '(declined — no repeated line structure found)');
  console.log(`\n[${Date.now() - t2}ms]`);

  if (showFull) {
    // Requires the full toolProcessor graph, so it is loaded only on demand.
    const { extractDiagnosticDigest } = require('../services/toolProcessor.service');
    console.log(rule('FULL DIGEST AS THE MODEL RECEIVES IT'));
    const digest = extractDiagnosticDigest(extracted, fileName);
    console.log(digest);
    console.log(`\n[digest: ${digest.length.toLocaleString()} chars]`);
  }

  console.log(rule('WHAT TO CHECK'));
  console.log('1. Did it pick the right duration column? See "HOW THIS FILE WAS READ".');
  console.log('2. Is the unit right? An unstated unit is assumed to be milliseconds.');
  console.log('3. Do the slowest statements match what you already know is slow?');
  console.log('4. Anything marked GUESSED or UNVERIFIED is inference, not measurement.');
  console.log('');
})().catch((err) => {
  console.error('\nFailed:', err);
  process.exit(1);
});
