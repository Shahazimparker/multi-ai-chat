// ============================================================
// FILE: backend/services/temporalContext.service.js
// PURPOSE: Ground every model call in the real current date and time.
// ============================================================
// A model has no clock. Left ungrounded it answers "what is today's date?"
// from its training distribution — wrong, and confidently stated — and it
// silently mis-resolves every relative expression the user writes ("this
// quarter", "next Friday", "the last 30 days"). That is not a prompt problem
// to patch per model: it is missing request context. So it is produced once,
// on the server, and injected on every path that builds a prompt.
//
// Three things this module owns:
//   1. The clock seam. Nothing else in prompt-building calls `new Date()`, so
//      tests can freeze time and assert on an exact rendered block.
//   2. Timezone resolution. "Now" is meaningless without a zone, and the zone
//      belongs to the user, not to the server the container happens to run in.
//   3. The rendered block itself, in one deterministic format, so changing the
//      wording is one diff instead of a hunt through every service.
// ============================================================

const { DEFAULT_TIMEZONE, TEMPORAL_PRECISION_MS } = require('../config/chatRuntime.config');

// ── Clock seam ───────────────────────────────────────────────
let clock = () => new Date();

/** Test-only: freeze or drive the clock. Pass a Date or a () => Date. */
const setClock = (source) => {
  clock = typeof source === 'function' ? source : () => new Date(source);
};
const resetClock = () => { clock = () => new Date(); };
const now = () => clock();

// ── Timezone resolution ──────────────────────────────────────
// A client-supplied IANA name reaches Intl, so it is validated rather than
// trusted: an unknown zone makes DateTimeFormat throw, which would turn a
// cosmetic field into a 500 on the chat path.
//
// The cache is keyed by client-supplied strings, so it is bounded: an attacker
// sending many distinct (or garbage) zone names must not grow it without limit.
const ZONE_CACHE_MAX_ENTRIES = 256;
const zoneCache = new Map();
const isValidTimeZone = (tz) => {
  if (typeof tz !== 'string' || tz.length === 0 || tz.length > 64) return false;
  if (zoneCache.has(tz)) return zoneCache.get(tz);
  let ok = true;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
  } catch {
    ok = false;
  }
  // Evict the oldest entry (Map preserves insertion order) before growing past
  // the cap, so the cache stays at a fixed, small footprint.
  if (zoneCache.size >= ZONE_CACHE_MAX_ENTRIES) {
    zoneCache.delete(zoneCache.keys().next().value);
  }
  zoneCache.set(tz, ok);
  return ok;
};

/**
 * Precedence, most specific first. Each layer is something a deployment can
 * actually set, and the last one always succeeds.
 *
 * @param {Object} [sources]
 * @param {string} [sources.requestTimeZone] — per-request override / browser-reported zone
 * @param {string} [sources.userTimeZone]    — the user's saved profile preference
 * @param {string} [sources.tenantTimeZone]  — org default, for deployments with tenants
 * @returns {{ timeZone: string, source: string }}
 */
const resolveTimeZone = (sources = {}) => {
  const candidates = [
    ['request', sources.requestTimeZone],
    ['user', sources.userTimeZone],
    ['tenant', sources.tenantTimeZone],
    ['default', DEFAULT_TIMEZONE],
  ];
  for (const [source, tz] of candidates) {
    if (isValidTimeZone(tz)) return { timeZone: tz, source };
  }
  return { timeZone: 'UTC', source: 'fallback' };
};

// ── Formatting ───────────────────────────────────────────────
const partsToMap = (formatter, date) =>
  Object.fromEntries(formatter.formatToParts(date).map(p => [p.type, p.value]));

const longLocal = (timeZone) => new Intl.DateTimeFormat('en-GB', {
  timeZone,
  weekday: 'long',
  day: '2-digit',
  month: 'long',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
  timeZoneName: 'longOffset',
});

const isoLocal = (timeZone) => new Intl.DateTimeFormat('en-CA', {
  timeZone,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
});

/** ISO-8601 week number, computed on the user's local calendar date. */
const isoWeekOf = (y, m, d) => {
  const target = Date.UTC(y, m - 1, d);
  const dayNum = (new Date(target).getUTCDay() + 6) % 7; // Mon = 0
  const thursday = target + (3 - dayNum) * 86400000;
  const weekYear = new Date(thursday).getUTCFullYear();
  const week = Math.floor((thursday - Date.UTC(weekYear, 0, 1)) / 604800000) + 1;
  return { week, weekYear };
};

/**
 * Snapshot of "now" as the user experiences it.
 *
 * The instant is quantized (default: one minute) before rendering. Every
 * provider that offers prompt caching keys it on an exact prefix match, so a
 * second-precision timestamp would guarantee a cache miss on every turn — real
 * money, for precision no chat answer needs.
 *
 * @param {Object} [opts]
 * @param {string} [opts.timeZone]
 * @param {Date}   [opts.at] — override the instant (tests, replay)
 */
const buildTemporalContext = ({ timeZone = 'UTC', at } = {}) => {
  const instant = at instanceof Date ? at : now();
  const quantum = Math.max(1000, TEMPORAL_PRECISION_MS);
  const rounded = new Date(Math.floor(instant.getTime() / quantum) * quantum);

  // A formatting failure must never take down the chat path: a runtime with a
  // reduced ICU build can fall back to a different locale than the one asked
  // for. formatToParts is read by part name, so ordering differences are
  // harmless, but the zone itself degrades to UTC rather than throwing.
  let long;
  let iso;
  let zone = timeZone;
  try {
    long = partsToMap(longLocal(zone), rounded);
    iso = partsToMap(isoLocal(zone), rounded);
  } catch (err) {
    console.warn(`[TemporalContext] Falling back to UTC for "${timeZone}": ${err.message}`);
    zone = 'UTC';
    long = partsToMap(longLocal(zone), rounded);
    iso = partsToMap(isoLocal(zone), rounded);
  }

  // hour12:false yields the h24 cycle in some locales, so midnight renders as
  // "24" rather than "00". Normalise both renderings, not just the ISO one.
  const norm = (h) => (h === '24' ? '00' : h);
  const hour = norm(iso.hour);
  const { week, weekYear } = isoWeekOf(Number(iso.year), Number(iso.month), Number(iso.day));

  return {
    timeZone: zone,
    // "GMT+05:30" -> "UTC+05:30"; UTC itself formats as a bare "GMT".
    utcOffset: (long.timeZoneName || 'GMT').replace('GMT', 'UTC').replace(/^UTC$/, 'UTC+00:00'),
    weekday: long.weekday,
    localDate: `${iso.year}-${iso.month}-${iso.day}`,
    localTime: `${hour}:${iso.minute}`,
    localLong: `${long.weekday}, ${long.day} ${long.month} ${long.year}, ${norm(long.hour)}:${long.minute}`,
    utcIso: `${rounded.toISOString().slice(0, 16)}Z`,
    isoWeek: `${weekYear}-W${String(week).padStart(2, '0')}`,
    quarter: `Q${Math.floor((Number(iso.month) - 1) / 3) + 1} ${iso.year}`,
    epochMs: rounded.getTime(),
  };
};

/**
 * The system block. Kept separate from `buildTemporalContext` so the same
 * snapshot can also feed analytics, tool results and stored message metadata
 * without being re-derived.
 *
 * The rules matter as much as the values. Given only a timestamp a model still
 * hedges ("I do not have access to the current date"), still anchors relative
 * dates to UTC, and still reads retrieved documents as if written today.
 */
const renderTemporalSystemBlock = (ctx) => [
  '## Current Date & Time (authoritative)',
  `Local time (${ctx.timeZone}): ${ctx.localLong} (${ctx.utcOffset})`,
  `UTC: ${ctx.utcIso}`,
  `ISO date: ${ctx.localDate} | ISO week: ${ctx.isoWeek} | Quarter: ${ctx.quarter}`,
  '',
  'This block is generated by the server at request time. It is the single source of truth for "now" and overrides anything you infer from your training data.',
  '- Never claim you do not know the current date or time, and never estimate one from your knowledge cutoff.',
  `- Resolve relative expressions ("today", "yesterday", "next Friday", "this quarter", "in 3 weeks") against the local time above, in ${ctx.timeZone}, unless the user names another timezone.`,
  '- When converting to another timezone, convert from the UTC value, not the local one.',
  '- Dates in retrieved documents, tool results and earlier conversation turns are absolute. Compare them against the value above instead of assuming they are recent.',
  '- If an answer depends on information newer than your training data, say so and use a search tool rather than answering from memory.',
].join('\n');

/**
 * Convenience for callers that only want the finished string.
 * @param {Object} [sources] — as accepted by resolveTimeZone, plus `at`
 */
const buildTemporalSystemBlock = (sources = {}) => {
  const { timeZone } = resolveTimeZone(sources);
  return renderTemporalSystemBlock(buildTemporalContext({ timeZone, at: sources.at }));
};

module.exports = {
  now,
  setClock,
  resetClock,
  isValidTimeZone,
  resolveTimeZone,
  buildTemporalContext,
  renderTemporalSystemBlock,
  buildTemporalSystemBlock,
  // Exported so tests can assert the cache stays bounded.
  zoneCache,
};
