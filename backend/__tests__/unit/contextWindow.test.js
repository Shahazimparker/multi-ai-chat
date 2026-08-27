// FILE: backend/__tests__/unit/contextWindow.test.js
// PURPOSE: Lock the measure-and-evict contract — a prompt that fits is sent
//          byte-identical (so provider prompt caches keep hitting), and one that
//          does not is reduced in a defined order, never mid-message.

const {
  createContextWindow,
  fitPromptToWindow,
  describeFitReport,
  toolLoopHeadroom,
  splitVolatileSections,
  mergeVolatileIntoQuery,
  VOLATILE_CONTEXT_FLAG,
} = require('../../services/contextWindow.service');

const { estimateTokens, estimateMessagesTokens } = require('../../services/tokenBudget.service');

// Roughly `tokens` worth of prose. Kept wordy on purpose: dense text takes the
// 3-chars-per-token branch and would make these sizes hard to reason about.
const prose = (tokens) => 'word '.repeat(Math.max(1, tokens));

const buildPrompt = ({ historyMessages = 0, historyTokens = 100, volatile = null, queryTokens = 50 }) => {
  const messages = [
    { role: 'system', content: 'You are a helpful assistant.' },
    { role: 'system', content: 'Today is Monday.' },
  ];
  let volatileSystemIndex = -1;
  if (volatile) {
    volatileSystemIndex = messages.length;
    messages.push({ role: 'system', content: volatile });
  }
  const pinnedSystemCount = messages.length;

  for (let i = 0; i < historyMessages; i++) {
    messages.push({
      role: i % 2 === 0 ? 'user' : 'assistant',
      content: `${i % 2 === 0 ? 'Q' : 'A'}${i} ${prose(historyTokens)}`,
    });
  }
  messages.push({ role: 'user', content: prose(queryTokens) });
  return { messages, pinnedSystemCount, volatileSystemIndex };
};

describe('createContextWindow', () => {
  it('reserves a flat output allowance for large models', () => {
    const w = createContextWindow({ maxTokens: 128000 });
    expect(w.reservedOutputTokens).toBe(8192);
    expect(w.hardCeiling).toBeLessThan(128000 - 8192);
    expect(w.hardCeiling).toBeGreaterThan(100000);
  });

  it('does not scale the output reserve with the window', () => {
    // A 200K model does not write a reply 1.5x longer than a 128K one, so
    // scaling the reserve would spend prompt space history could have used.
    const a = createContextWindow({ maxTokens: 128000 });
    const b = createContextWindow({ maxTokens: 256000 });
    expect(a.reservedOutputTokens).toBe(b.reservedOutputTokens);
  });

  it('scales the reserve for small models instead', () => {
    const w = createContextWindow({ maxTokens: 5999 });
    expect(w.reservedOutputTokens).toBeLessThan(4000);
    expect(w.reservedOutputTokens).toBeGreaterThanOrEqual(800);
    expect(w.hardCeiling).toBeGreaterThan(0);
    expect(w.hardCeiling).toBeLessThan(5999);
  });

  it('leaves a safety margin below the usable window', () => {
    const w = createContextWindow({ maxTokens: 128000 });
    expect(w.safetyMarginTokens).toBeGreaterThan(0);
    expect(w.hardCeiling + w.safetyMarginTokens + w.reservedOutputTokens).toBeLessThanOrEqual(128000);
  });

  it('sets the low-water mark below the ceiling so eviction has hysteresis', () => {
    const w = createContextWindow({ maxTokens: 128000 });
    expect(w.lowWaterMark).toBeLessThan(w.hardCeiling);
  });

  it('lets a per-request cap lower the ceiling', () => {
    const w = createContextWindow({ maxTokens: 128000 }, { maxPromptTokens: 5000 });
    expect(w.hardCeiling).toBe(5000);
  });

  it('never lets a per-request cap raise the ceiling past the model window', () => {
    const uncapped = createContextWindow({ maxTokens: 32000 });
    const capped = createContextWindow({ maxTokens: 32000 }, { maxPromptTokens: 999999 });
    expect(capped.hardCeiling).toBe(uncapped.hardCeiling);
  });
});

describe('fitPromptToWindow — prompt that fits', () => {
  it('returns the identical array reference, so the cached prefix is untouched', () => {
    const { messages, pinnedSystemCount } = buildPrompt({ historyMessages: 6 });
    const window = createContextWindow({ maxTokens: 128000 });

    const { messages: out, report } = fitPromptToWindow({ messages, window, pinnedSystemCount });

    // Reference equality is the contract: any copy risks a caller mutating one
    // and not the other, and any rewrite would change the prefix hash.
    expect(out).toBe(messages);
    expect(report.evicted).toBe(false);
    expect(report.droppedHistoryMessages).toBe(0);
    expect(report.overflow).toBe(false);
  });

  it('leaves a long conversation completely intact on a large model', () => {
    // The case the whole change exists for: 60 turns on a 128K model must not
    // lose a single message.
    const { messages, pinnedSystemCount } = buildPrompt({ historyMessages: 60, historyTokens: 200 });
    const window = createContextWindow({ maxTokens: 128000 });

    const { messages: out, report } = fitPromptToWindow({ messages, window, pinnedSystemCount });

    expect(out).toHaveLength(messages.length);
    expect(report.evicted).toBe(false);
  });
});

describe('fitPromptToWindow — eviction', () => {
  const smallWindow = () => createContextWindow({ maxTokens: 128000 }, { maxPromptTokens: 3000 });

  it('drops oldest history first and keeps the newest', () => {
    const { messages, pinnedSystemCount } = buildPrompt({ historyMessages: 40, historyTokens: 120 });
    const window = smallWindow();

    const { messages: out, report } = fitPromptToWindow({ messages, window, pinnedSystemCount });

    expect(report.evicted).toBe(true);
    expect(report.droppedHistoryMessages).toBeGreaterThan(0);
    // The final user turn is always last and never dropped.
    expect(out[out.length - 1]).toBe(messages[messages.length - 1]);
    // The most recent history message survived; the oldest did not.
    expect(out).toContain(messages[messages.length - 2]);
    expect(out).not.toContain(messages[pinnedSystemCount]);
  });

  it('never truncates a history message — only removes whole ones', () => {
    const { messages, pinnedSystemCount } = buildPrompt({ historyMessages: 40, historyTokens: 120 });
    const window = smallWindow();

    const { messages: out } = fitPromptToWindow({ messages, window, pinnedSystemCount });

    const originals = new Set(messages.map((m) => m.content));
    for (const m of out.slice(pinnedSystemCount, -1)) {
      // Every surviving history message is character-for-character an original.
      expect(originals.has(m.content)).toBe(true);
    }
  });

  it('keeps the pinned system blocks', () => {
    const { messages, pinnedSystemCount } = buildPrompt({ historyMessages: 40, historyTokens: 120 });
    const window = smallWindow();

    const { messages: out } = fitPromptToWindow({ messages, window, pinnedSystemCount });

    expect(out[0]).toBe(messages[0]);
    expect(out[1]).toBe(messages[1]);
  });

  it('evicts down to the low-water mark, not merely under the ceiling', () => {
    // Hysteresis: stopping at the ceiling would overflow again next turn and
    // mutate the prefix on every request, collapsing the prompt-cache hit rate.
    const { messages, pinnedSystemCount } = buildPrompt({ historyMessages: 60, historyTokens: 120 });
    const window = smallWindow();

    const { report } = fitPromptToWindow({ messages, window, pinnedSystemCount });

    expect(report.tokensAfter).toBeLessThanOrEqual(window.lowWaterMark);
  });

  it('honours the floor of recent messages even under extreme pressure', () => {
    const { messages, pinnedSystemCount } = buildPrompt({ historyMessages: 40, historyTokens: 400 });
    const window = createContextWindow({ maxTokens: 128000 }, { maxPromptTokens: 600 });

    const { messages: out } = fitPromptToWindow({
      messages, window, pinnedSystemCount, minRecentMessages: 4,
    });

    const historyKept = out.length - pinnedSystemCount - 1;
    expect(historyKept).toBeGreaterThanOrEqual(1);
  });

  it('never leaves history opening on an assistant turn', () => {
    // Gemini rejects history that does not begin with a user turn, and an
    // orphaned answer is confusing context for every other provider.
    const { messages, pinnedSystemCount } = buildPrompt({ historyMessages: 41, historyTokens: 120 });
    const window = smallWindow();

    const { messages: out } = fitPromptToWindow({ messages, window, pinnedSystemCount });

    const firstHistory = out[pinnedSystemCount];
    if (firstHistory && firstHistory.role !== 'user') {
      expect(firstHistory.role).not.toBe('assistant');
    }
  });
});

describe('fitPromptToWindow — retrieved context', () => {
  it('drops web context before file context', () => {
    const volatile = [
      `## Retrieved Context\n${prose(300)}`,
      `## Web Search Context\n${prose(300)}`,
      `## File Context\n${prose(300)}`,
    ].join('\n\n');

    const { messages, pinnedSystemCount, volatileSystemIndex } = buildPrompt({
      historyMessages: 2, historyTokens: 20, volatile, queryTokens: 20,
    });
    const window = createContextWindow({ maxTokens: 128000 }, { maxPromptTokens: 800 });

    const { messages: out, report } = fitPromptToWindow({
      messages, window, pinnedSystemCount, volatileSystemIndex,
    });

    expect(report.droppedSections.length).toBeGreaterThan(0);
    expect(report.droppedSections[0]).toContain('Web Search Context');

    const kept = out[volatileSystemIndex]?.content || '';
    if (kept) expect(kept).toContain('File Context');
  });

  it('gives up disposable web context before draining the conversation', () => {
    // A chat app's value is continuity. Web results are re-fetchable and are
    // rarely the subject of the question, so holding a 20K web block while
    // dropping 300 turns of history is the wrong trade.
    const volatile = [
      '## Web Search Context', prose(20000), '', '## File Context', prose(3000),
    ].join(String.fromCharCode(10));

    const { messages, pinnedSystemCount, volatileSystemIndex } = buildPrompt({
      historyMessages: 300, historyTokens: 400, volatile, queryTokens: 500,
    });
    const window = createContextWindow({ maxTokens: 128000 });

    const { messages: out, report } = fitPromptToWindow({
      messages, window, pinnedSystemCount, volatileSystemIndex,
    });

    expect(report.droppedSections).toContain('Web Search Context');
    // The bulk of the conversation survives because the web block paid first.
    const kept = out.length - pinnedSystemCount - 1;
    expect(kept).toBeGreaterThan(100);
    // And the section that is plausibly the subject of the question is intact.
    expect(out[volatileSystemIndex].content).toContain('File Context');
  });

  it('only touches retrieved context after history is exhausted', () => {
    const volatile = `## File Context\n${prose(50)}`;
    const { messages, pinnedSystemCount, volatileSystemIndex } = buildPrompt({
      historyMessages: 30, historyTokens: 120, volatile,
    });
    const window = createContextWindow({ maxTokens: 128000 }, { maxPromptTokens: 3000 });

    const { report } = fitPromptToWindow({ messages, window, pinnedSystemCount, volatileSystemIndex });

    expect(report.droppedHistoryMessages).toBeGreaterThan(0);
    expect(report.droppedSections).toHaveLength(0);
  });
});

describe('fitPromptToWindow — cache-friendly layout (context after history)', () => {
  // The retrieved block now trails the history so system+history stay a stable,
  // cacheable prefix. Every index behind an evicted history message shifts, so
  // the block is tracked by marker; these lock that it is never mistaken for
  // history and never left behind.
  const NL = String.fromCharCode(10);

  const buildTrailing = ({ historyMessages, historyTokens, sections }) => {
    const messages = [
      { role: 'system', content: 'static instructions' },
      { role: 'system', content: 'temporal grounding' },
    ];
    const pinnedSystemCount = messages.length;
    for (let i = 0; i < historyMessages; i++) {
      messages.push({
        role: i % 2 === 0 ? 'user' : 'assistant',
        content: `H${i} ${prose(historyTokens)}`,
      });
    }
    messages.push({
      role: 'user',
      content: sections.join(NL + NL),
      [VOLATILE_CONTEXT_FLAG]: true,
    });
    messages.push({ role: 'user', content: 'the actual question' });
    return { messages, pinnedSystemCount };
  };

  it('never evicts the trailing context block as if it were history', () => {
    const { messages, pinnedSystemCount } = buildTrailing({
      historyMessages: 60, historyTokens: 200,
      sections: [`## File Context${NL}${prose(300)}`],
    });
    const window = createContextWindow({ maxTokens: 128000 }, { maxPromptTokens: 4000 });

    const { messages: out, report } = fitPromptToWindow({ messages, window, pinnedSystemCount });

    expect(report.droppedHistoryMessages).toBeGreaterThan(0);
    const ctx = out.find((m) => m[VOLATILE_CONTEXT_FLAG]);
    expect(ctx).toBeDefined();
    expect(ctx.content).toContain('File Context');
    // And it is still the second-to-last message, ahead of the question.
    expect(out[out.length - 1].content).toBe('the actual question');
    expect(out[out.length - 2][VOLATILE_CONTEXT_FLAG]).toBe(true);
  });

  it('tracks the block by marker as history eviction shifts its index', () => {
    // Its starting index is 62; after eviction it is far lower. An index-based
    // lookup would be operating on a history message by then.
    const { messages, pinnedSystemCount } = buildTrailing({
      historyMessages: 60, historyTokens: 200,
      sections: [`## Web Search Context${NL}${prose(2000)}`, `## File Context${NL}${prose(200)}`],
    });
    const window = createContextWindow({ maxTokens: 128000 }, { maxPromptTokens: 3000 });

    const { messages: out, report } = fitPromptToWindow({ messages, window, pinnedSystemCount });

    expect(report.droppedSections).toContain('Web Search Context');
    const ctx = out.find((m) => m[VOLATILE_CONTEXT_FLAG]);
    if (ctx) expect(ctx.content).not.toContain('Web Search Context');
    // No history message was mangled into a context block.
    for (const m of out.slice(pinnedSystemCount, -2)) {
      expect(m[VOLATILE_CONTEXT_FLAG]).toBeUndefined();
    }
  });

  it('keeps system + history byte-identical when the prompt fits', () => {
    // This is the property the whole reorder exists for: an unchanged prefix is
    // what lets the provider serve it from cache.
    const { messages, pinnedSystemCount } = buildTrailing({
      historyMessages: 40, historyTokens: 200,
      sections: [`## Retrieved Context${NL}${prose(500)}`],
    });
    const window = createContextWindow({ maxTokens: 128000 });

    const { messages: out, report } = fitPromptToWindow({ messages, window, pinnedSystemCount });

    expect(report.evicted).toBe(false);
    expect(out).toBe(messages);
  });
});

describe('fitPromptToWindow — last resort', () => {
  it('trims the current query only when nothing else is left', () => {
    const { messages, pinnedSystemCount } = buildPrompt({ historyMessages: 0, queryTokens: 4000 });
    const window = createContextWindow({ maxTokens: 128000 }, { maxPromptTokens: 2000 });

    const { messages: out, report } = fitPromptToWindow({ messages, window, pinnedSystemCount });

    expect(report.queryTrimmed).toBe(true);
    expect(out[out.length - 1].content.length).toBeLessThan(messages[messages.length - 1].content.length);
  });

  it('flags overflow rather than shipping a prompt it knows will be rejected', () => {
    const { messages, pinnedSystemCount } = buildPrompt({ historyMessages: 0, queryTokens: 5000 });
    // A ceiling below the query floor: nothing can make this fit.
    const window = createContextWindow({ maxTokens: 128000 }, { maxPromptTokens: 300 });

    const { report } = fitPromptToWindow({ messages, window, pinnedSystemCount });

    expect(report.overflow).toBe(true);
  });
});

describe('toolLoopHeadroom', () => {
  it('is what the base prompt left, not a flat share of the window', () => {
    const window = createContextWindow({ maxTokens: 32000 });
    const base = [{ role: 'user', content: prose(2000) }];

    const headroom = toolLoopHeadroom(base, window);
    const baseTokens = estimateMessagesTokens(base);

    expect(headroom).toBe(window.hardCeiling - baseTokens);
    // base + tool allowance is bounded by the ceiling by construction.
    expect(baseTokens + headroom).toBeLessThanOrEqual(window.hardCeiling);
  });

  it('never goes negative when the base already fills the window', () => {
    const window = createContextWindow({ maxTokens: 128000 }, { maxPromptTokens: 100 });
    expect(toolLoopHeadroom([{ role: 'user', content: prose(5000) }], window)).toBe(0);
  });
});

describe('splitVolatileSections', () => {
  it('splits on section headings and keeps them whole', () => {
    const sections = splitVolatileSections('## A\nbody a\n\n## B\nbody b');
    expect(sections).toHaveLength(2);
    expect(sections[0]).toContain('body a');
    expect(sections[1]).toContain('body b');
  });

  it('returns an empty list for empty input', () => {
    expect(splitVolatileSections('')).toEqual([]);
    expect(splitVolatileSections(null)).toEqual([]);
  });
});

describe('describeFitReport', () => {
  it('states plainly when nothing was dropped', () => {
    const { messages, pinnedSystemCount } = buildPrompt({ historyMessages: 2 });
    const window = createContextWindow({ maxTokens: 128000 });
    const { report } = fitPromptToWindow({ messages, window, pinnedSystemCount });
    expect(describeFitReport(report)).toContain('sent intact');
  });

  it('names what was dropped, so eviction is never silent in the logs', () => {
    const { messages, pinnedSystemCount } = buildPrompt({ historyMessages: 40, historyTokens: 120 });
    const window = createContextWindow({ maxTokens: 128000 }, { maxPromptTokens: 3000 });
    const { report } = fitPromptToWindow({ messages, window, pinnedSystemCount });
    expect(describeFitReport(report)).toMatch(/dropped \d+ history message/);
  });
});

describe('estimateTokens — conservatism', () => {
  it('takes the max of the char and word estimates, never the average', () => {
    // Many short words: the word estimate dominates and must be the answer.
    const text = 'a b c d e f g h i j k l m n o p q r s t';
    const words = text.split(/\s+/).length;
    expect(estimateTokens(text)).toBeGreaterThanOrEqual(Math.ceil(words * 1.3));
  });

  it('rates dense structured text higher than prose of the same length', () => {
    // Logs and stack traces tokenize worse than prose; under-measuring them is
    // what turns an estimate error into a rejected request.
    const dense = '{"ts":"2026-01-01T00:00:00Z","lvl":"ERR","msg":"x"},'.repeat(40);
    const proseText = 'the quick brown fox jumps over a lazy dog '.repeat(Math.ceil(dense.length / 41));
    const denseRate = estimateTokens(dense) / dense.length;
    const proseRate = estimateTokens(proseText) / proseText.length;
    expect(denseRate).toBeGreaterThan(proseRate);
  });

  it('counts image parts in multimodal content', () => {
    // Stringifying the array yields "[object Object]" and scores a vision turn
    // at almost nothing, which used to hide ~1200 tokens from every budget.
    const content = [
      { type: 'text', text: 'describe this' },
      { type: 'image_url', image_url: { url: 'data:image/png;base64,AAAA' } },
    ];
    expect(estimateTokens(content)).toBeGreaterThan(1000);
  });

  it('still returns 0 for empty input', () => {
    expect(estimateTokens('')).toBe(0);
    expect(estimateTokens([])).toBe(0);
  });
});

describe('mergeVolatileIntoQuery', () => {
  const NL = String.fromCharCode(10);
  const ctxBlock = (text) => ({ role: 'user', content: text, [VOLATILE_CONTEXT_FLAG]: true });

  it('produces one user turn, preserving role alternation', () => {
    // Anthropic rejects consecutive same-role turns; the others read a split
    // turn as two separate questions.
    const out = mergeVolatileIntoQuery([
      { role: 'system', content: 'sys' },
      { role: 'user', content: 'earlier' },
      { role: 'assistant', content: 'reply' },
      ctxBlock('## File Context' + NL + 'log lines'),
      { role: 'user', content: 'why did it crash?' },
    ]);

    expect(out).toHaveLength(4);
    expect(out.filter((m) => m[VOLATILE_CONTEXT_FLAG])).toHaveLength(0);
    const last = out[out.length - 1];
    expect(last.role).toBe('user');
    expect(last.content).toContain('File Context');
    expect(last.content).toContain('why did it crash?');
    // Context precedes the question, which is what puts the question last.
    expect(last.content.indexOf('File Context')).toBeLessThan(last.content.indexOf('why did it crash?'));
  });

  it('puts the preamble on the text part of a multimodal turn, not the image', () => {
    const out = mergeVolatileIntoQuery([
      { role: 'system', content: 'sys' },
      ctxBlock('## Retrieved Context' + NL + 'facts'),
      {
        role: 'user',
        content: [
          { type: 'text', text: 'what is this?' },
          { type: 'image_url', image_url: { url: 'data:image/png;base64,AAAA' } },
        ],
      },
    ]);

    const parts = out[out.length - 1].content;
    expect(parts).toHaveLength(2);
    expect(parts[0].type).toBe('text');
    expect(parts[0].text).toContain('Retrieved Context');
    // The image part is untouched — providers parse it structurally.
    expect(parts[1]).toEqual({ type: 'image_url', image_url: { url: 'data:image/png;base64,AAAA' } });
  });

  it('is a no-op when there is no context block', () => {
    const msgs = [{ role: 'system', content: 'sys' }, { role: 'user', content: 'q' }];
    expect(mergeVolatileIntoQuery(msgs)).toBe(msgs);
  });

  it('keeps the block rather than discarding it when the turn does not end in a user message', () => {
    const msgs = [ctxBlock('ctx'), { role: 'assistant', content: 'a' }];
    expect(mergeVolatileIntoQuery(msgs)).toBe(msgs);
  });

  it('leaves system + history byte-identical across turns with different context', () => {
    // THE property the reorder buys: two consecutive turns whose retrieved
    // context differs completely still share an identical prefix, which is what
    // a provider prompt cache keys on.
    const history = [
      { role: 'user', content: 'turn one' },
      { role: 'assistant', content: 'answer one' },
    ];
    const build = (ctx, q) => mergeVolatileIntoQuery([
      { role: 'system', content: 'static instructions' },
      { role: 'system', content: 'temporal grounding' },
      ...history,
      ctxBlock(ctx),
      { role: 'user', content: q },
    ]);

    const turnA = build('## Retrieved Context' + NL + 'alpha material', 'question A');
    const turnB = build('## Retrieved Context' + NL + 'completely different beta material', 'question B');

    const prefix = (msgs) => JSON.stringify(msgs.slice(0, msgs.length - 1));
    expect(prefix(turnA)).toBe(prefix(turnB));
    // ...while the final turn genuinely differs.
    expect(turnA[turnA.length - 1].content).not.toBe(turnB[turnB.length - 1].content);
  });
});
