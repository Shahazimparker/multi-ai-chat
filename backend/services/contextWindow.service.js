// ============================================================
// FILE: backend/services/contextWindow.service.js
// PURPOSE: Enforce the model's real context window by measuring the assembled
//          prompt and evicting only when it genuinely does not fit.
// ============================================================
//
// WHY THIS EXISTS
//
// The percentage budgets in tokenBudget.service.js decide how much to *fetch*
// (how much RAG to retrieve, how much file text to pull). They are soft targets
// and they run before anything is assembled, so they cannot know what the turn
// actually weighs. Using them as the safety mechanism meant two failures at
// once: history was cut on a 128K model that had 100K to spare, and the
// sections could still sum past the window, at which point the pipeline gave up
// with "Query context too large" and the user got no answer at all.
//
// This module inverts that. Assemble everything raw, measure it, and send it
// untouched when it fits — which on a 128K-200K model is the normal path. Evict
// only on the turns that genuinely overflow, in a defined order, never mid-message.
//
// THREE PROPERTIES THAT MATTER AND ARE EASY TO GET WRONG
//
// 1. Hysteresis. Evicting the exact minimum needed means the next turn
//    overflows again, and the next, so the prompt prefix changes on every
//    single request. Provider prompt caches key on an exact prefix hash, so
//    that pattern drives the cache-hit rate to zero — on DeepSeek a cache hit
//    costs ~0.8% of an uncached read, so losing it is a real bill. Eviction
//    therefore runs down to a low-water mark below the ceiling, buying quiet
//    turns in between where the prefix is byte-identical and caching works.
//
// 2. Whole messages only. A half-truncated assistant turn is worse than an
//    absent one: the model reads the fragment as fact and reasons from a
//    mutilated premise. History is dropped in whole turns, oldest first.
//
// 3. The cached prefix survives. Leading system blocks are pinned, so eviction
//    starts *after* the block the provider adapters mark cacheable. Dropping
//    old history invalidates the cache from the eviction point onward but never
//    the system prefix itself.
//
// Eviction order, least damaging first:
//   1. Oldest history turns  — a turn from 40 exchanges ago is the least likely
//      to bear on the current question, and long-context models attend worst to
//      the middle of the window anyway ("lost in the middle", arXiv 2307.03172).
//   2. Retrieved context     — RAG/file/web blocks, lowest-priority section first.
//   3. The current query     — last resort, and only down to a floor.
// Past that the request is genuinely impossible and the caller is told so.

const {
  estimateTokens,
  estimateMessagesTokens,
  trimTextByTokens,
} = require('./tokenBudget.service');

const {
  CONTEXT_RESERVED_OUTPUT_TOKENS,
  CONTEXT_SAFETY_MARGIN_RATIO,
  CONTEXT_EVICTION_TARGET_RATIO,
  CONTEXT_MIN_RECENT_MESSAGES,
  CONTEXT_MIN_QUERY_TOKENS,
} = require('../config/chatRuntime.config');

// Below this the model is small enough that output reservation has to scale
// with the window rather than sit at a flat figure.
const LARGE_MODEL_THRESHOLD = 32000;

// A flat reservation is right for large models: a 128K and a 200K model both
// write replies of the same order, so scaling the reservation with the window
// just wastes prompt space that history could have used.
const LARGE_MODEL_OUTPUT_RESERVE = 8192;

/**
 * Derives the hard ceiling a prompt must fit under, plus the low-water mark
 * eviction aims for.
 *
 * `modelConfig.maxTokens` is the context window (128000 / 200000 / 256000 in
 * config/models.js), NOT an output cap — the providers' own max_tokens is set
 * separately in services/ai/*.
 *
 * @param {object} modelConfig
 * @param {object} [overrides] - per-call caps, e.g. a user's per_query_limit
 * @returns {{modelLimit:number, reservedOutputTokens:number, safetyMarginTokens:number,
 *            hardCeiling:number, lowWaterMark:number}}
 */
const createContextWindow = (modelConfig = {}, overrides = {}) => {
  const modelLimit = Math.max(1024, modelConfig.maxTokens || 8000);

  const reservedOutputTokens = CONTEXT_RESERVED_OUTPUT_TOKENS > 0
    ? Math.min(CONTEXT_RESERVED_OUTPUT_TOKENS, Math.floor(modelLimit * 0.5))
    : (modelLimit >= LARGE_MODEL_THRESHOLD
      ? LARGE_MODEL_OUTPUT_RESERVE
      : Math.min(4000, Math.max(800, Math.floor(modelLimit * 0.25))));

  // Token counts here are estimates, and estimates drift — worst on exactly the
  // dense log/stack-trace content this app handles most. The margin is what
  // keeps an underestimate from turning into a provider-side rejection.
  const usable = modelLimit - reservedOutputTokens;
  const safetyMarginTokens = Math.max(256, Math.floor(usable * CONTEXT_SAFETY_MARGIN_RATIO));

  let hardCeiling = Math.max(512, usable - safetyMarginTokens);

  // A per-request cap (per_query_limit, anonymous cap) can only ever lower the
  // ceiling; it must never raise it above what the model can physically take.
  if (Number.isFinite(overrides.maxPromptTokens) && overrides.maxPromptTokens > 0) {
    hardCeiling = Math.min(hardCeiling, Math.floor(overrides.maxPromptTokens));
  }

  return {
    modelLimit,
    reservedOutputTokens,
    safetyMarginTokens,
    hardCeiling,
    lowWaterMark: Math.max(256, Math.floor(hardCeiling * CONTEXT_EVICTION_TARGET_RATIO)),
  };
};

/**
 * Splits the retrieved-context system block back into the sections chatPipeline
 * joined with a blank line, so eviction can drop whole sections rather than
 * cutting one in half.
 *
 * Sections are emitted as "## Heading\n...", except the memory and knowledge
 * blocks which bring their own headers — anything before the first "## " is
 * kept as a leading section so nothing is silently lost.
 */
// Written via char codes rather than escape literals so the joiner used to
// rebuild the block is provably the same one chatPipeline joined it with.
// Marks the retrieved-context block wherever it sits in the array. Tracked by
// marker rather than by index because the block now lives AFTER the history:
// evicting a history message shifts every index behind it, and a stale index
// would have the fitter operating on the wrong message.
const VOLATILE_CONTEXT_FLAG = '__volatileContext';

const NL = String.fromCharCode(10);
const SECTION_JOINER = NL + NL;

const splitVolatileSections = (content = '') => {
  if (!content) return [];
  const parts = String(content).split(/\n\n(?=## )/);
  return parts.filter((p) => p.trim().length > 0);
};

// Which retrieved sections are given up first. Web and URL context are the most
// disposable (the model can search again); the knowledge base and file context
// are usually the subject of the question and go last.
const SECTION_EVICTION_ORDER = [
  '## Web Search Context',
  '## URL Context',
  '## Retrieved Context',
  '## File Context',
];

const sectionPriority = (section) => {
  const idx = SECTION_EVICTION_ORDER.findIndex((h) => section.startsWith(h));
  // Unrecognised blocks (cross-chat memory, knowledge base) are kept longest:
  // they are small and carry the user's own established facts.
  return idx === -1 ? SECTION_EVICTION_ORDER.length : idx;
};

/**
 * Fits an assembled prompt under the model's context window.
 *
 * Returns a NEW array when anything changed and the original array untouched
 * when it already fits — callers rely on the untouched case leaving the
 * provider's cached prefix byte-identical.
 *
 * @param {object}   args
 * @param {Array}    args.messages            - assembled prompt, system blocks first, current user turn last
 * @param {object}   args.window              - from createContextWindow
 * @param {number}   [args.pinnedSystemCount] - leading system messages that must never be dropped
 * @param {number}   [args.volatileSystemIndex] - index of the retrieved-context block, or -1
 * @param {number}   [args.minRecentMessages] - floor of history messages to keep
 * @returns {{messages:Array, report:object}}
 */
const fitPromptToWindow = ({
  messages,
  window,
  pinnedSystemCount = 0,
  volatileSystemIndex = -1,
  minRecentMessages = CONTEXT_MIN_RECENT_MESSAGES,
}) => {
  const tokensBefore = estimateMessagesTokens(messages);

  const baseReport = {
    tokensBefore,
    tokensAfter: tokensBefore,
    hardCeiling: window.hardCeiling,
    lowWaterMark: window.lowWaterMark,
    evicted: false,
    droppedHistoryMessages: 0,
    droppedSections: [],
    queryTrimmed: false,
    overflow: false,
  };

  // Fast path — the normal one on a 128K-200K model. No mutation, so the
  // provider sees the same prefix it cached last turn.
  if (tokensBefore <= window.hardCeiling) {
    return { messages, report: baseReport };
  }

  const working = messages.slice();
  const report = { ...baseReport, evicted: true };

  // Evict past the ceiling down to the low-water mark, so the next few turns
  // fit without another eviction and the prefix stays stable meanwhile.
  const target = Math.min(window.lowWaterMark, window.hardCeiling);
  const currentTokens = () => estimateMessagesTokens(working);

  // Disposable retrieved sections are given up BEFORE the conversation is.
  // Web and URL results are re-fetchable and rarely the subject of the question;
  // draining 300 turns of history while still holding a web-search block is the
  // wrong trade for a chat app whose value is continuity.
  // Recomputed on every use: the flagged block sits after the history, so each
  // evicted history message moves it one place forward.
  const findVolatile = () => {
    const flagged = working.findIndex((m) => m && m[VOLATILE_CONTEXT_FLAG]);
    if (flagged >= 0) return flagged;
    return volatileSystemIndex >= 0 && volatileSystemIndex < working.length
      ? volatileSystemIndex
      : -1;
  };

  const dropSectionsWhileOver = (maxRank, ceiling) => {
    const volIdx = findVolatile();
    if (volIdx < 0 || !working[volIdx]) return;
    const sections = splitVolatileSections(working[volIdx].content);
    if (sections.length === 0) return;

    const order = sections
      .map((section, idx) => ({ idx, rank: sectionPriority(section) }))
      .filter((entry) => entry.rank <= maxRank)
      .sort((a2, b2) => a2.rank - b2.rank);

    const dropped = new Set();
    for (const { idx } of order) {
      if (currentTokens() <= ceiling) break;
      // Never empty the block here; removing it entirely is handled below so
      // the array shape stays predictable for the caller.
      if (dropped.size >= sections.length - 1) break;
      dropped.add(idx);
      const kept = sections.filter((_, i) => !dropped.has(i));
      working[volIdx] = {
        ...working[volIdx],
        content: kept.join(SECTION_JOINER),
      };
      report.droppedSections.push(
        (sections[idx].split(NL)[0] || 'section').replace(/^#+ */, '').trim()
      );
    }
  };

  // -- Step 0: disposable retrieved context (web, URL) --------
  dropSectionsWhileOver(SECTION_EVICTION_ORDER.indexOf('## URL Context'), target);

  // -- Step 1: oldest history turns, whole messages only ------
  // The region between the pinned system blocks and the current user turn.
  const historyStart = pinnedSystemCount;
  // History runs from the pinned system blocks up to the trailing turn. When the
  // retrieved-context block trails the history (the cache-friendly layout), it
  // is not history and must not be evicted as though it were.
  const historyEndExclusive = () => {
    const volIdx = findVolatile();
    return volIdx > historyStart ? volIdx : working.length - 1;
  };

  while (currentTokens() > target && (historyEndExclusive() - historyStart) > minRecentMessages) {
    working.splice(historyStart, 1);
    report.droppedHistoryMessages += 1;
  }

  // A history window that now opens on an assistant turn is an orphaned answer,
  // and Gemini rejects history that does not begin with a user turn.
  while (
    historyEndExclusive() > historyStart &&
    working[historyStart] &&
    working[historyStart].role === 'assistant'
  ) {
    working.splice(historyStart, 1);
    report.droppedHistoryMessages += 1;
  }

  // -- Step 2: the remaining retrieved context ----------------
  dropSectionsWhileOver(Number.MAX_SAFE_INTEGER, window.hardCeiling);

  // Every section but one is gone and it still does not fit: drop the block.
  const volAfterSections = findVolatile();
  if (currentTokens() > window.hardCeiling && volAfterSections >= 0 && working[volAfterSections]) {
    working.splice(volAfterSections, 1);
    report.droppedSections.push('all retrieved context');
  }


  // ── Step 3: the current query, last resort ─────────────────
  const lastIdx = working.length - 1;
  const lastMessage = working[lastIdx];
  if (
    currentTokens() > window.hardCeiling &&
    lastMessage &&
    lastMessage.role === 'user' &&
    typeof lastMessage.content === 'string'
  ) {
    const others = estimateMessagesTokens(working.slice(0, lastIdx));
    const roomForQuery = window.hardCeiling - others - 8;
    if (roomForQuery >= CONTEXT_MIN_QUERY_TOKENS) {
      working[lastIdx] = {
        ...lastMessage,
        content: trimTextByTokens(lastMessage.content, roomForQuery),
      };
      report.queryTrimmed = true;
    }
  }

  report.tokensAfter = currentTokens();
  // Nothing left to give. The caller decides whether to refuse the turn; this
  // module never silently ships a prompt it knows the provider will reject.
  report.overflow = report.tokensAfter > window.hardCeiling;

  return { messages: working, report };
};

/**
 * Folds the flagged retrieved-context block into the trailing user turn.
 *
 * Kept separate through assembly and eviction so the fitter can drop whole
 * sections from it, then merged here so the provider sees a single user
 * message — Anthropic rejects consecutive same-role turns, and the others read
 * a split turn as two questions.
 *
 * @param {Array} messages
 * @returns {Array} a new array when a merge happened, the original otherwise
 */
const mergeVolatileIntoQuery = (messages) => {
  const idx = messages.findIndex((m) => m && m[VOLATILE_CONTEXT_FLAG]);
  if (idx < 0) return messages;

  const out = messages.slice();
  const [ctx] = out.splice(idx, 1);
  const target = out[out.length - 1];
  // Nothing sane to merge into; leaving the block in place beats silently
  // discarding retrieved context the model was meant to see.
  if (!target || target.role !== 'user') return messages;

  const preamble = `${ctx.content}${SECTION_JOINER}`;

  if (Array.isArray(target.content)) {
    // Multimodal turn: the preamble belongs on the text part, never on the
    // image part, which providers parse structurally.
    const parts = target.content.slice();
    const t = parts.findIndex((part) => part && part.type === 'text');
    if (t >= 0) {
      parts[t] = { ...parts[t], text: `${preamble}${parts[t].text || ''}` };
    } else {
      parts.unshift({ type: 'text', text: preamble });
    }
    out[out.length - 1] = { ...target, content: parts };
  } else {
    out[out.length - 1] = { ...target, content: `${preamble}${target.content || ''}` };
  }
  return out;
};

/**
 * One-line summary for the pipeline log. Context that was dropped must be
 * visible in production — silent eviction is indistinguishable from the model
 * simply forgetting, which is the hardest class of bug to diagnose from a
 * support ticket.
 */
const describeFitReport = (report) => {
  if (!report.evicted) {
    return `prompt ${report.tokensBefore} tok fits under ceiling ${report.hardCeiling} — sent intact`;
  }
  const parts = [
    `prompt ${report.tokensBefore} → ${report.tokensAfter} tok (ceiling ${report.hardCeiling}, target ${report.lowWaterMark})`,
  ];
  if (report.droppedHistoryMessages > 0) parts.push(`dropped ${report.droppedHistoryMessages} history message(s)`);
  if (report.droppedSections.length > 0) parts.push(`dropped context: ${report.droppedSections.join(', ')}`);
  if (report.queryTrimmed) parts.push('trimmed current query');
  if (report.overflow) parts.push('STILL OVER CEILING');
  return parts.join('; ');
};

/**
 * Headroom a tool loop may spend on top of an already-assembled prompt.
 *
 * The loop appends a request/result pair per round, so its budget has to come
 * out of what the base prompt left behind. Sizing it as a flat fraction of the
 * window instead let base + tool rounds exceed the window together even when
 * each was individually within its own allowance.
 */
const toolLoopHeadroom = (baseMessages, window) => {
  const base = estimateMessagesTokens(baseMessages);
  return Math.max(0, window.hardCeiling - base);
};

module.exports = {
  createContextWindow,
  fitPromptToWindow,
  describeFitReport,
  toolLoopHeadroom,
  splitVolatileSections,
  mergeVolatileIntoQuery,
  VOLATILE_CONTEXT_FLAG,
};
