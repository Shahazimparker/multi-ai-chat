// ============================================================
// FILE: .github/scripts/audit-gate.mjs
// PURPOSE: Blocking `npm audit` gate with an explicit, documented allowlist.
//
//   `npm audit --audit-level=high` is all-or-nothing: it cannot pass a build
//   that carries a high advisory with no upstream fix without also going blind
//   to every *new* high advisory. This wrapper keeps the gate blocking and
//   narrows the exception to specific advisory IDs, each of which must be
//   justified in ALLOWED below.
//
//   Run from a package directory (the CI step sets working-directory: backend).
// ============================================================

import { execSync } from 'node:child_process';

// Every entry needs: why it cannot be fixed, and what to check to remove it.
const ALLOWED = new Map([
  [
    'GHSA-w3rx-r6r6-pgpr',
    'image-size ICNS parser infinite loop (DoS), reached via pptxgenjs -> image-size.',
  ],
  [
    'GHSA-5p2g-fcmc-qvqq',
    'image-size JXL/HEIF parser infinite loops (DoS), reached via pptxgenjs -> image-size.',
  ],
]);

// Shared rationale for the two image-size entries above.
//
//   NO PATCHED RELEASE EXISTS. Both advisories have range "<=2.0.2", and 2.0.2
//   is the newest version image-size has ever published (dist-tags: latest
//   2.0.2, legacy 1.2.1). An `overrides` entry therefore cannot resolve this —
//   there is nothing to point it at.
//
//   The dependency is not directly ours: pptxgenjs 4.0.1 (the latest release)
//   pins image-size ^1.2.1, resolving to 1.2.1. npm's only suggested "fix" is
//   downgrading to pptxgenjs 1.1.5, a 2015 release that predates the API this
//   codebase uses. pptxgenjs is genuinely used, by
//   backend/services/pptGeneration.service.js, so it cannot be dropped.
//
//   Reachability: the vulnerable code paths are image-size's ICNS/JXL/HEIF
//   decoders, which pptxgenjs only touches when measuring an embedded image.
//   pptGeneration.service.js builds text-only decks and never calls addImage,
//   so no image is ever handed to image-size.
//
//   TO REMOVE THIS EXCEPTION:
//     npm view image-size versions --json   # any version above 2.0.2 yet?
//     npm view pptxgenjs@latest dependencies --json
//   If image-size has published a fixed release, add an `overrides` entry in
//   backend/package.json (or bump pptxgenjs if it has moved to the fixed line)
//   and delete the two IDs above. Any advisory ID not listed above still fails
//   this step.

const BLOCKING = new Set(['high', 'critical']);

let report;
try {
  // execSync (fixed command string, no interpolation) rather than execFileSync:
  // on Windows npm is a .cmd shim, which execFileSync refuses to spawn (EINVAL).
  const raw = execSync('npm audit --omit=dev --json', {
    encoding: 'utf8',
    // npm audit exits non-zero when it finds anything; the JSON is still on stdout.
    stdio: ['ignore', 'pipe', 'inherit'],
  });
  report = JSON.parse(raw);
} catch (err) {
  if (!err.stdout) {
    console.error('audit-gate: `npm audit` produced no output.');
    console.error(err.message);
    process.exit(1);
  }
  try {
    report = JSON.parse(err.stdout);
  } catch {
    console.error('audit-gate: could not parse `npm audit --json` output.');
    console.error(err.stdout.slice(0, 2000));
    process.exit(1);
  }
}

const idFromUrl = (url) => (url ?? '').split('/').pop() || null;

/** @type {Map<string, {severity: string, title: string, paths: Set<string>}>} */
const found = new Map();

for (const [pkg, vuln] of Object.entries(report.vulnerabilities ?? {})) {
  for (const via of vuln.via ?? []) {
    if (typeof via !== 'object') continue; // string = transitive pointer, not an advisory
    if (!BLOCKING.has(via.severity)) continue;
    const id = idFromUrl(via.url) ?? `source-${via.source}`;
    if (!found.has(id)) {
      found.set(id, { severity: via.severity, title: via.title ?? '(no title)', paths: new Set() });
    }
    found.get(id).paths.add(pkg);
  }
}

const unexpected = [...found].filter(([id]) => !ALLOWED.has(id));
const stale = [...ALLOWED.keys()].filter((id) => !found.has(id));

for (const [id, info] of found) {
  if (ALLOWED.has(id)) {
    console.log(`ALLOWED  ${id}  [${info.severity}]  ${info.title}`);
    console.log(`         via: ${[...info.paths].join(', ')}`);
  }
}

if (stale.length) {
  console.log('');
  console.log('NOTICE: allowlisted advisories no longer reported — remove them from');
  console.log('        .github/scripts/audit-gate.mjs:');
  for (const id of stale) console.log(`        - ${id}`);
}

if (unexpected.length) {
  console.error('');
  console.error(`FAIL: ${unexpected.length} high/critical advisory(ies) with no documented exception.`);
  for (const [id, info] of unexpected) {
    console.error(`  ${id}  [${info.severity}]  ${info.title}`);
    console.error(`    via: ${[...info.paths].join(', ')}`);
  }
  console.error('');
  console.error('Fix the dependency, or — only if no upstream fix exists — add the ID to');
  console.error('ALLOWED in .github/scripts/audit-gate.mjs with a written justification.');
  process.exit(1);
}

console.log('');
console.log(`PASS: no high/critical advisories outside the documented allowlist (${ALLOWED.size} entr${ALLOWED.size === 1 ? 'y' : 'ies'}).`);
