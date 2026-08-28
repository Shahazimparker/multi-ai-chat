// ============================================================
// FILE: backend/services/logTemplateMiner.service.js
// PURPOSE: Structure-aware log analysis — turn an unstructured log into
//          templates, frequencies, rare events and time buckets.
//
// WHY THIS EXISTS
// The keyword scanner in toolProcessor finds lines matching a fixed severity
// vocabulary, and tabularProfiler finds rows carrying numbers. Neither can
// answer the two questions that actually locate an incident in a large log:
//   - "what is normal here, and what happened only once?"
//   - "when did the rate change?"
// Both need the log grouped into event types first, and log lines are not
// naturally groupable: every line carries ids, timings and paths that make it
// textually unique.
//
// TECHNIQUE
// Drain (He et al., ICWS 2017, https://jiemingzhu.github.io/pub/pjhe_icws2017.pdf),
// the log parser used by logpai/Drain3, IBM's AIOps work and Salesforce's LogAI.
// It is an online parser using a fixed-depth parse tree:
//   1. mask volatile substrings (ips, uuids, numbers, paths) with placeholders
//   2. bucket by token count — messages of different lengths are different events
//   3. descend the tree by the first `depth` tokens
//   4. at the leaf, score candidate clusters by positional token similarity and
//      join the best if it clears `simTh`, replacing differing tokens with <*>
// Chosen over embedding-based clustering because it is single-pass, needs no
// model call, and runs inside a request on a 300k-line file.
//
// Time bucketing follows LogAI's feature-extractor idea: counting templates per
// interval turns "an error appears somewhere" into "the rate changed at 10:42".
// ============================================================

// Bounds — this runs inside a request.
const MAX_LINES = 300000;
const MAX_CLUSTERS = 2000;
const MAX_CHILDREN = 120;
const DEFAULT_DEPTH = 4;
const DEFAULT_SIM_TH = 0.4;
const MAX_EXAMPLES = 2;

const WILDCARD = '<*>';

/**
 * Masks applied before tokenisation. Drain's accuracy depends far more on this
 * step than on its tree parameters: an unmasked request id or duration makes
 * every occurrence of one event look like a distinct event, and the parser
 * produces thousands of one-off clusters instead of one template with a count.
 * Ordered longest-pattern-first so a timestamp is not eaten piecewise by the
 * number rule.
 */
const MASKS = [
  [/\b\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(?:[.,]\d+)?(?:Z|[+-]\d{2}:?\d{2})?/g, '<TIME>'],
  [/\b\d{2}:\d{2}:\d{2}(?:[.,]\d+)?\b/g, '<TIME>'],
  [/\b\d{4}[-/]\d{2}[-/]\d{2}\b/g, '<DATE>'],
  [/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, '<UUID>'],
  [/\b(?:\d{1,3}\.){3}\d{1,3}(?::\d+)?\b/g, '<IP>'],
  [/\b[\w.+-]+@[\w-]+\.[\w.-]+\b/g, '<EMAIL>'],
  [/\b0x[0-9a-f]+\b/gi, '<HEX>'],
  [/\b[0-9a-f]{16,}\b/gi, '<HEX>'],
  [/(?:[A-Za-z]:)?[\\/](?:[\w.-]+[\\/])+[\w.-]*/g, '<PATH>'],
  [/\b\d+(?:\.\d+)?(?:ms|s|sec|kb|mb|gb|%)\b/gi, '<NUM>'],
  [/\b\d+(?:\.\d+)?\b/g, '<NUM>'],
];

const applyMasks = (line) => {
  let out = line;
  for (const [pattern, replacement] of MASKS) out = out.replace(pattern, replacement);
  return out;
};

// Canonical level names, longest-first so WARNING is not read as WARN.
const LEVEL_ALIASES = [
  ['FATAL', ['FATAL', 'EMERGENCY', 'EMERG', 'CRITICAL', 'CRIT', 'PANIC', 'SEVERE', 'ALERT']],
  ['ERROR', ['ERROR', 'ERR', 'SEVERE_ERROR']],
  ['WARN', ['WARNING', 'WARN']],
  ['INFO', ['INFORMATION', 'INFO', 'NOTICE']],
  ['DEBUG', ['DEBUG', 'TRACE', 'VERBOSE', 'FINE', 'FINEST']],
];

const LEVEL_LOOKUP = new Map();
for (const [canonical, aliases] of LEVEL_ALIASES) {
  for (const alias of aliases) LEVEL_LOOKUP.set(alias, canonical);
}

const ALL_LEVELS = [...LEVEL_LOOKUP.keys()].sort((a, b) => b.length - a.length).join('|');

// An explicit level marker: a bracketed level, a structured level= / "level":
// field, or a standalone uppercase level token near the start of the line.
const EXPLICIT_LEVEL = new RegExp(
  `(?:\\[\\s*(${ALL_LEVELS})\\s*\\]` +
  // The optional quote after the key name matters: JSON structured logging
  // (pino, winston, zap, logrus) writes `"level":"error"`, and without it the
  // key never matches and every JSON log line comes back unlabelled.
  `|\\b(?:level|severity|lvl|loglevel)"?\\s*[=:]\\s*"?(${ALL_LEVELS})"?` +
  `|(?:^|\\s)(${ALL_LEVELS})(?=\\s|:|\\]|$))`,
  'i'
);

// Fallback only. These words describe what happened, not the line's level, so
// they are consulted ONLY when the line declares no level of its own.
const CONTENT_HINTS = [
  ['FATAL', /\b(kernel panic|out of memory|oom[-_]?kill|segfault|segmentation fault|core dumped|stack overflow)\b/i],
  ['ERROR', /\b(exception|traceback|failed to|failure|refused|aborted|cannot|could not|denied)\b/i],
  ['WARN', /\b(deprecat(ed|ion)|retry(ing)?|slow|throttl(ed|ing))\b/i],
];

/**
 * Read a line's severity.
 *
 * An explicit level always wins. Matching content words first — as a plain
 * keyword scan does — misreads `INFO retrying after failed attempt` as an
 * ERROR, and a severity mix built from those is wrong in the direction that
 * matters: it inflates the error count the reader is most likely to act on.
 */
const detectSeverity = (line) => {
  const head = line.slice(0, 200);

  const explicit = EXPLICIT_LEVEL.exec(head);
  if (explicit) {
    const token = (explicit[1] || explicit[2] || explicit[3] || '').toUpperCase();
    const level = LEVEL_LOOKUP.get(token);
    if (level) return level;
  }

  for (const [label, pattern] of CONTENT_HINTS) {
    if (pattern.test(head)) return label;
  }
  return null;
};

const TIMESTAMP_PATTERNS = [
  /\b(\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(?:[.,]\d+)?(?:Z|[+-]\d{2}:?\d{2})?)/,
  /\b(\d{4}\/\d{2}\/\d{2}[ T]\d{2}:\d{2}:\d{2})/,
  /\b(\d{2}\/[A-Za-z]{3}\/\d{4}:\d{2}:\d{2}:\d{2})/,
];

/** Pull a parseable timestamp off a log line, if it carries one. */
const extractTimestamp = (line) => {
  for (const pattern of TIMESTAMP_PATTERNS) {
    const m = pattern.exec(line);
    if (!m) continue;
    const t = Date.parse(m[1].replace(/^(\d{2})\/([A-Za-z]{3})\/(\d{4}):/, '$1 $2 $3 '));
    if (Number.isFinite(t)) return { ms: t, raw: m[1] };
  }
  return null;
};

/**
 * Positional token similarity, as defined in the Drain paper: the fraction of
 * positions holding identical tokens. A wildcard in the template does not count
 * as a match, which is what stops a cluster from generalising without limit
 * until it swallows unrelated events.
 */
const seqSimilarity = (templateTokens, tokens) => {
  if (templateTokens.length !== tokens.length) return 0;
  if (tokens.length === 0) return 0;
  let same = 0;
  for (let i = 0; i < tokens.length; i++) {
    if (templateTokens[i] === tokens[i]) same++;
  }
  return same / tokens.length;
};

/** Merge an accepted line into its cluster: differing positions become <*>. */
const mergeTemplate = (templateTokens, tokens) => {
  for (let i = 0; i < templateTokens.length; i++) {
    if (templateTokens[i] !== tokens[i]) templateTokens[i] = WILDCARD;
  }
};

// A token holding a masked placeholder or a digit is volatile, so it must not
// become a fixed branch in the tree — otherwise the tree grows a child per id.
const isVolatileToken = (token) => /<[A-Z]+>/.test(token) || /\d/.test(token);

class DrainParser {
  constructor({ depth = DEFAULT_DEPTH, simTh = DEFAULT_SIM_TH } = {}) {
    // Drain counts the root and leaf in its depth; the number of tokens used to
    // branch is therefore depth - 2.
    this.prefixDepth = Math.max(1, depth - 2);
    this.simTh = simTh;
    this.root = new Map();
    this.clusters = [];
  }

  /** Find or create the leaf bucket for a token sequence. */
  _leafFor(tokens, create) {
    const byLength = this.root;
    const lengthKey = tokens.length;

    let node = byLength.get(lengthKey);
    if (!node) {
      if (!create) return null;
      node = new Map();
      byLength.set(lengthKey, node);
    }

    for (let d = 0; d < this.prefixDepth && d < tokens.length; d++) {
      const token = tokens[d];
      const key = isVolatileToken(token) ? WILDCARD : token;

      let next = node.get(key);
      if (!next) {
        // Fall back to the wildcard branch rather than growing without bound.
        next = node.get(WILDCARD);
        if (!next) {
          if (!create) return null;
          if (node.size >= MAX_CHILDREN) {
            next = new Map();
            node.set(WILDCARD, next);
          } else {
            next = new Map();
            node.set(key, next);
          }
        }
      }
      node = next;
    }

    let leaf = node.get('__clusters__');
    if (!leaf) {
      if (!create) return null;
      leaf = [];
      node.set('__clusters__', leaf);
    }
    return leaf;
  }

  add(rawLine, lineNumber, meta) {
    const masked = applyMasks(rawLine.trim());
    const tokens = masked.split(/\s+/).filter(Boolean);
    if (tokens.length === 0) return null;

    const leaf = this._leafFor(tokens, this.clusters.length < MAX_CLUSTERS);
    if (!leaf) return null;

    let best = null;
    let bestSim = -1;
    for (const cluster of leaf) {
      const sim = seqSimilarity(cluster.tokens, tokens);
      if (sim > bestSim) {
        bestSim = sim;
        best = cluster;
      }
    }

    if (best && bestSim >= this.simTh) {
      mergeTemplate(best.tokens, tokens);
      best.count++;
      if (meta?.source) best.bySource.set(meta.source, (best.bySource.get(meta.source) || 0) + 1);
      best.lastLine = lineNumber;
      if (best.examples.length < MAX_EXAMPLES) best.examples.push(rawLine.trim());
      if (meta?.severity && !best.severity) best.severity = meta.severity;
      if (meta?.timestamp) {
        if (best.firstSeen === null || meta.timestamp.ms < best.firstSeen) best.firstSeen = meta.timestamp.ms;
        if (best.lastSeen === null || meta.timestamp.ms > best.lastSeen) best.lastSeen = meta.timestamp.ms;
      }
      return best;
    }

    if (this.clusters.length >= MAX_CLUSTERS) return best || null;

    const cluster = {
      id: this.clusters.length + 1,
      tokens: [...tokens],
      count: 1,
      firstLine: lineNumber,
      lastLine: lineNumber,
      examples: [rawLine.trim()],
      severity: meta?.severity || null,
      firstSeen: meta?.timestamp ? meta.timestamp.ms : null,
      lastSeen: meta?.timestamp ? meta.timestamp.ms : null,
      // Per-file tallies, used when two files are parsed through ONE parser so
      // their templates are the same objects and can be compared directly.
      bySource: new Map(meta?.source ? [[meta.source, 1]] : []),
    };
    leaf.push(cluster);
    this.clusters.push(cluster);
    return cluster;
  }
}

const fmt = (n) => {
  if (!Number.isFinite(n)) return 'n/a';
  const rounded = Math.abs(n) >= 100 ? Math.round(n) : Math.round(n * 100) / 100;
  return rounded.toLocaleString('en-US');
};

const truncate = (s, max = 170) => {
  const flat = String(s || '').replace(/\s+/g, ' ').trim();
  return flat.length > max ? `${flat.slice(0, max)}...` : flat;
};

/**
 * Bucket events over time and flag intervals whose volume departs from the
 * file's own baseline. This is LogAI's counter-vector idea reduced to what a
 * single file supports: a median-and-MAD comparison rather than a fitted model,
 * because there is no history here to fit against and a robust estimator will
 * not be dragged upward by the very spike it is meant to find.
 */
const detectBursts = (events, bucketCount = 60) => {
  const stamped = events.filter((e) => e.timestamp);
  if (stamped.length < 20) return null;

  let min = Infinity;
  let max = -Infinity;
  for (const e of stamped) {
    if (e.timestamp.ms < min) min = e.timestamp.ms;
    if (e.timestamp.ms > max) max = e.timestamp.ms;
  }
  const span = max - min;
  if (!Number.isFinite(span) || span <= 0) return null;

  const bucketMs = Math.max(1000, Math.ceil(span / bucketCount));
  const buckets = new Map();

  for (const e of stamped) {
    const idx = Math.floor((e.timestamp.ms - min) / bucketMs);
    let b = buckets.get(idx);
    if (!b) {
      b = { idx, total: 0, errors: 0, start: min + idx * bucketMs };
      buckets.set(idx, b);
    }
    b.total++;
    if (e.severity === 'ERROR' || e.severity === 'FATAL') b.errors++;
  }

  const ordered = [...buckets.values()].sort((a, b) => a.idx - b.idx);
  if (ordered.length < 4) return null;

  const totals = ordered.map((b) => b.total).sort((a, b) => a - b);
  const median = totals[Math.floor(totals.length / 2)];
  // Median absolute deviation — a spike does not inflate it the way a standard
  // deviation would, so the threshold stays where the normal traffic is.
  const deviations = totals.map((t) => Math.abs(t - median)).sort((a, b) => a - b);
  const mad = deviations[Math.floor(deviations.length / 2)] || 1;
  const threshold = median + 4 * mad;

  const spikes = ordered
    .filter((b) => b.total > threshold && b.total > median * 1.5)
    .sort((a, b) => b.total - a.total)
    .slice(0, 5);

  const errorSpikes = ordered
    .filter((b) => b.errors > 0)
    .sort((a, b) => b.errors - a.errors)
    .slice(0, 5);

  return {
    bucketMs,
    bucketCount: ordered.length,
    median,
    threshold,
    spikes,
    errorSpikes,
    windowStart: min,
    windowEnd: max,
  };
};

const isoOrRaw = (ms) => {
  try {
    return new Date(ms).toISOString();
  } catch {
    return String(ms);
  }
};

/**
 * Mine an unstructured log into templates, rare events and time buckets.
 *
 * @param {string} text      raw log text
 * @param {string} fileName  for the report heading
 * @param {object} [options] { depth, simTh }
 * @returns {string|null}    report block, or null when the text does not look
 *                           like a line-oriented log
 */
const mineLogTemplates = (text, fileName = 'log', options = {}) => {
  if (!text || typeof text !== 'string' || text.length < 500) return null;

  try {
    const lines = text.split('\n');
    if (lines.length < 30) return null;

    const parser = new DrainParser(options);
    const events = [];
    let scanned = 0;

    for (let i = 0; i < lines.length && i < MAX_LINES; i++) {
      const raw = lines[i];
      if (!raw || raw.trim() === '') continue;
      if (raw.length > 4000) continue;

      const severity = detectSeverity(raw);
      const timestamp = extractTimestamp(raw);
      const cluster = parser.add(raw, i + 1, { severity, timestamp });
      if (!cluster) continue;
      scanned++;
      events.push({ severity, timestamp });
    }

    if (scanned < 30 || parser.clusters.length === 0) return null;

    // A parser that produced almost as many templates as lines has not found
    // structure — the input is prose, not a log, and reporting "1,000 events
    // each occurring once" would be noise dressed as a finding.
    if (parser.clusters.length > scanned * 0.6) return null;

    const out = [];
    out.push(`[LOG STRUCTURE ANALYSIS: ${fileName}]`);
    out.push('Every line was parsed into an event template (Drain algorithm: volatile values such');
    out.push('as ids, numbers, paths and timestamps are replaced with <*> so repeats of the same');
    out.push('event group together). Counts below are exact over the whole file.');
    out.push('');
    out.push(`${fmt(scanned)} parsed lines resolved to ${fmt(parser.clusters.length)} distinct event templates.`);

    const bySeverity = new Map();
    for (const e of events) {
      const key = e.severity || 'UNLABELLED';
      bySeverity.set(key, (bySeverity.get(key) || 0) + 1);
    }
    const severityLine = [...bySeverity.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([k, v]) => `${k}: ${fmt(v)}`)
      .join('  |  ');
    if (severityLine) {
      out.push('');
      out.push('--- SEVERITY MIX ---');
      out.push(severityLine);
    }

    // -- Most frequent templates ---------------------------------------------
    const byCount = [...parser.clusters].sort((a, b) => b.count - a.count);
    out.push('');
    out.push('--- MOST FREQUENT EVENTS (what this log mostly is) ---');
    // Only label the severity when the template does not already carry the
    // level inline, which most application logs do.
    const severityPrefix = (c) => {
      if (!c.severity) return '';
      const template = c.tokens.join(' ');
      return new RegExp(`\\b${c.severity}\\b`, 'i').test(template) ? '' : `${c.severity} `;
    };

    byCount.slice(0, 8).forEach((c, i) => {
      const pct = ((c.count / scanned) * 100).toFixed(1);
      out.push(`${String(i + 1).padStart(2)}. ${fmt(c.count)}x (${pct}%) ${severityPrefix(c)}${truncate(c.tokens.join(' '), 150)}`);
    });

    // -- Rare templates ------------------------------------------------------
    // The signal Drain-based tooling is actually used for: in a log where one
    // event repeats 40,000 times, the line that occurred twice is the one worth
    // reading, and no severity keyword is needed to find it.
    const rare = byCount
      .filter((c) => c.count <= Math.max(2, Math.floor(scanned * 0.0005)))
      .sort((a, b) => a.count - b.count);

    if (rare.length > 0) {
      out.push('');
      out.push(`--- RARE EVENTS (${fmt(rare.length)} templates seen only once or twice) ---`);
      out.push('Statistically unusual for this file. Rarity is not severity — but in a log dominated');
      out.push('by repetition, a one-off event is where an incident usually shows first.');
      rare.slice(0, 12).forEach((c, i) => {
        out.push(`${String(i + 1).padStart(2)}. ${fmt(c.count)}x [line ${fmt(c.firstLine)}] ${severityPrefix(c)}${truncate(c.examples[0], 160)}`);
      });
    }

    // -- Error templates -----------------------------------------------------
    const errorTemplates = byCount.filter((c) => c.severity === 'ERROR' || c.severity === 'FATAL');
    if (errorTemplates.length > 0) {
      out.push('');
      out.push(`--- ERROR / FATAL EVENT TYPES (${fmt(errorTemplates.length)} distinct) ---`);
      errorTemplates.slice(0, 10).forEach((c, i) => {
        out.push(`${String(i + 1).padStart(2)}. ${fmt(c.count)}x [first line ${fmt(c.firstLine)}, last ${fmt(c.lastLine)}] ${severityPrefix(c)}${truncate(c.examples[0], 150)}`);
      });
    }

    // -- Time buckets --------------------------------------------------------
    const bursts = detectBursts(events);
    if (bursts) {
      out.push('');
      out.push(`--- EVENT RATE OVER TIME (${fmt(bursts.bucketCount)} buckets of ${fmt(bursts.bucketMs / 1000)} s) ---`);
      out.push(`Window: ${isoOrRaw(bursts.windowStart)} to ${isoOrRaw(bursts.windowEnd)}`);
      out.push(`Median ${fmt(bursts.median)} events/bucket; a bucket is called a spike above ${fmt(bursts.threshold)} (median + 4x median-absolute-deviation).`);

      if (bursts.spikes.length > 0) {
        out.push('Volume spikes:');
        for (const b of bursts.spikes) {
          out.push(`  - ${isoOrRaw(b.start)}: ${fmt(b.total)} events (${fmt(b.total / Math.max(1, bursts.median))}x median)${b.errors > 0 ? `, ${fmt(b.errors)} error/fatal` : ''}`);
        }
      } else {
        out.push('No volume spike stood out above the baseline.');
      }

      if (bursts.errorSpikes.length > 0) {
        out.push('Buckets with the most error/fatal events:');
        for (const b of bursts.errorSpikes) {
          out.push(`  - ${isoOrRaw(b.start)}: ${fmt(b.errors)} error/fatal of ${fmt(b.total)} events`);
        }
      }
    } else {
      out.push('');
      out.push('--- EVENT RATE OVER TIME ---');
      out.push('Not enough parseable timestamps to build a rate timeline.');
    }

    out.push('');
    out.push('This section reports structure and counts only. It does not diagnose a cause.');
    out.push('[END LOG STRUCTURE ANALYSIS]');

    return out.join('\n');
  } catch (err) {
    console.warn(`[LogTemplateMiner] Mining failed for "${fileName}":`, err.message);
    return null;
  }
};

// Hard cap on what one slice may return, so a wide window cannot swallow the
// prompt budget the GET_FILE cap exists to protect.
const MAX_SLICE_LINES = 150;

/**
 * Read an exact slice of a file, by line range or by time window.
 *
 * Every other tool here reports a coordinate — the profile prints `[line N]`,
 * SEARCH_FILES prints `[Lines X to Y]`, the burst detector prints a timestamp —
 * and until now each of those was a dead end: the model could locate an
 * incident precisely and then had no way to read it, so it inferred from
 * summaries instead of looking. This is the tool that closes that loop.
 *
 * @param {string} text        full file text
 * @param {object} opts        { from, to, around, window, maxLines }
 *                             from/to are 1-based inclusive line numbers;
 *                             `around` is a timestamp and `window` a number of
 *                             seconds either side of it.
 * @returns {string}           the slice, always a string (explains any failure)
 */
const readRows = (text, { from = null, to = null, around = null, window = 30, maxLines = MAX_SLICE_LINES } = {}) => {
  if (!text || typeof text !== 'string') return 'No file content available to read.';

  const lines = text.split('\n');
  const total = lines.length;
  const cap = Math.max(1, Math.min(Number(maxLines) || MAX_SLICE_LINES, MAX_SLICE_LINES));

  const render = (startIdx, endIdx, headline) => {
    const out = [headline];
    const width = String(endIdx + 1).length;
    for (let i = startIdx; i <= endIdx; i++) {
      out.push(`${String(i + 1).padStart(width)} | ${lines[i]}`);
    }
    return out.join('\n');
  };

  // -- Time window ---------------------------------------------------------
  if (around) {
    const centre = Date.parse(around);
    if (!Number.isFinite(centre)) {
      return `Could not read around="${around}" as a timestamp. Use an ISO time such as 2026-08-01T10:06:39Z.`;
    }
    const windowMs = Math.max(1, Number(window) || 30) * 1000;

    const hits = [];
    for (let i = 0; i < lines.length; i++) {
      const stamp = extractTimestamp(lines[i]);
      if (!stamp) continue;
      if (Math.abs(stamp.ms - centre) <= windowMs) hits.push(i);
      // Lines are usually chronological, so once past the window there is
      // nothing later to find — but only stop after something matched, since
      // a file may open with unrelated timestamps.
      if (hits.length > 0 && stamp.ms - centre > windowMs) break;
    }

    if (hits.length === 0) {
      return `No timestamped lines within ${window}s of ${around}. The file may use a different time format, or that window may be outside its range.`;
    }

    const first = hits[0];
    const last = hits[hits.length - 1];
    const truncated = last - first + 1 > cap;
    const endIdx = truncated ? first + cap - 1 : last;

    return render(
      first,
      endIdx,
      `[LINES ${first + 1}-${endIdx + 1} of ${total}] within ${window}s of ${around}` +
      `${truncated ? ` — ${fmt(last - first + 1)} lines matched, showing the first ${cap}` : ''}`
    );
  }

  // -- Line range ----------------------------------------------------------
  const start = Number(from);
  if (!Number.isFinite(start) || start < 1) {
    return 'Give either from=<line> (with optional to=<line>) or around=<timestamp>.';
  }
  if (start > total) {
    return `from=${start} is past the end of the file, which has ${fmt(total)} lines.`;
  }

  const rawEnd = Number(to);
  const end = Number.isFinite(rawEnd) && rawEnd >= start ? Math.min(rawEnd, total) : Math.min(start + 20, total);
  const startIdx = start - 1;
  const endIdx = Math.min(end - 1, startIdx + cap - 1);
  const truncated = end - start + 1 > cap;

  return render(
    startIdx,
    endIdx,
    `[LINES ${startIdx + 1}-${endIdx + 1} of ${fmt(total)}]` +
    `${truncated ? ` — range capped at ${cap} lines` : ''}`
  );
};

/** Feed one file's lines into a shared parser, tagged with its source. */
const feedInto = (parser, text, source) => {
  const lines = String(text || '').split('\n');
  let parsed = 0;
  for (let i = 0; i < lines.length && i < MAX_LINES; i++) {
    const raw = lines[i];
    if (!raw || raw.trim() === '') continue;
    if (raw.length > 4000) continue;
    const cluster = parser.add(raw, i + 1, {
      severity: detectSeverity(raw),
      timestamp: extractTimestamp(raw),
      source,
    });
    if (cluster) parsed++;
  }
  return parsed;
};

/**
 * Compare two logs and report what CHANGED between them.
 *
 * "What is different since it was working" is usually the question, and it is
 * one that reading either file alone cannot answer. Both files go through a
 * SINGLE Drain parser so a line in each maps to the same template object;
 * comparing two separately-built template sets would instead compare two
 * different generalisations of the same event and report spurious differences.
 *
 * Rates, not raw counts: the two files are rarely the same length, so an event
 * appearing 100 times in a 1,000-line baseline and 150 times in a 10,000-line
 * current file has become rarer, not more common.
 *
 * @returns {string} report block (always a string; explains any failure)
 */
const compareLogs = (baselineText, currentText, { baselineName = 'baseline', currentName = 'current' } = {}) => {
  if (!baselineText || !currentText) return 'Two files are needed to compare.';

  try {
    const parser = new DrainParser();
    const baseTotal = feedInto(parser, baselineText, 'baseline');
    const currTotal = feedInto(parser, currentText, 'current');

    if (baseTotal < 5 || currTotal < 5) {
      return `Not enough parseable lines to compare (${baselineName}: ${baseTotal}, ${currentName}: ${currTotal}).`;
    }

    const rows = parser.clusters.map((c) => {
      const b = c.bySource.get('baseline') || 0;
      const n = c.bySource.get('current') || 0;
      return {
        cluster: c,
        b,
        n,
        bRate: b / baseTotal,
        nRate: n / currTotal,
      };
    });

    const appeared = rows.filter((r) => r.b === 0 && r.n > 0).sort((a, b) => b.n - a.n);
    const vanished = rows.filter((r) => r.n === 0 && r.b > 0).sort((a, b) => b.b - a.b);
    const shifted = rows
      .filter((r) => r.b > 0 && r.n > 0)
      .map((r) => ({ ...r, ratio: r.nRate / r.bRate }))
      .filter((r) => r.ratio >= 3 || r.ratio <= 1 / 3)
      .sort((a, b) => b.ratio - a.ratio);

    const out = [];
    out.push(`[LOG COMPARISON: ${currentName} vs ${baselineName}]`);
    out.push('Both files were parsed with one shared template model, so the events below are');
    out.push('the same events in each. Figures are rates per file, because the files differ in');
    out.push('length. This reports what changed; it does not say which change caused which.');
    out.push('');
    out.push(`${baselineName}: ${fmt(baseTotal)} parsed lines   |   ${currentName}: ${fmt(currTotal)} parsed lines`);
    out.push(`${fmt(parser.clusters.length)} distinct event templates across both files.`);

    const describe = (c) => truncate(c.examples[0], 150);

    out.push('');
    if (appeared.length > 0) {
      out.push(`--- NEW IN ${currentName.toUpperCase()} (${fmt(appeared.length)} event types absent from ${baselineName}) ---`);
      for (const r of appeared.slice(0, 12)) {
        const sev = r.cluster.severity ? `${r.cluster.severity} ` : '';
        out.push(`  ${fmt(r.n)}x  ${sev}${describe(r.cluster)}`);
      }
    } else {
      out.push(`--- NEW IN ${currentName.toUpperCase()} ---`);
      out.push('  No event type appears that was absent from the baseline.');
    }

    out.push('');
    if (shifted.length > 0) {
      out.push('--- FREQUENCY SHIFTS (3x or more, by rate) ---');
      for (const r of shifted.slice(0, 12)) {
        const direction = r.ratio >= 1 ? `${fmt(r.ratio)}x more` : `${fmt(1 / r.ratio)}x less`;
        out.push(`  ${direction} common (${fmt(r.b)} -> ${fmt(r.n)})  ${describe(r.cluster)}`);
      }
    } else {
      out.push('--- FREQUENCY SHIFTS ---');
      out.push('  No shared event type changed rate by 3x or more.');
    }

    out.push('');
    if (vanished.length > 0) {
      out.push(`--- GONE FROM ${currentName.toUpperCase()} (${fmt(vanished.length)} event types) ---`);
      out.push('  Something that stopped happening can be the failure itself — a worker that no');
      out.push('  longer logs its heartbeat is not a quiet worker.');
      for (const r of vanished.slice(0, 10)) {
        out.push(`  was ${fmt(r.b)}x  ${describe(r.cluster)}`);
      }
    } else {
      out.push(`--- GONE FROM ${currentName.toUpperCase()} ---`);
      out.push('  Every baseline event type still appears.');
    }

    out.push('');
    out.push('[END LOG COMPARISON]');
    return out.join('\n');
  } catch (err) {
    console.warn('[LogTemplateMiner] Comparison failed:', err.message);
    return `Comparison failed: ${err.message}`;
  }
};

module.exports = {
  mineLogTemplates,
  readRows,
  compareLogs,
  // exported for unit tests
  DrainParser,
  applyMasks,
  seqSimilarity,
  detectSeverity,
  extractTimestamp,
  detectBursts,
};
