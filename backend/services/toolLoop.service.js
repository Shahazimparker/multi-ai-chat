const { dispatchToAI, dispatchToAIStream } = require('./ai/dispatcher.service');
const { estimateMessagesTokens, estimateTokens } = require('./tokenBudget.service');
const { processToolCall } = require('./toolProcessor.service');

// Every marker toolProcessor.service.js looks for, up to the delimiter that
// makes it unambiguous. Kept in sync with the find*Match helpers there.
// The gate below holds back at most the longest of these, so the delay a reader
// can perceive is bounded by this list, not by the reply length.
const TOOL_MARKER_OPENINGS = [
  '[SEARCH_FILES:',
  '[SEARCH_KB:',
  '[GET_FILE:',
  '[WEB_SEARCH:',
  '[GENERATE_IMAGE:',
  '[GENERATE_PPT]',
  '[GENERATE_PDF]',
  '[GENERATE_EXCEL]',
  '[GENERATE_DOCX]',
  '[GENERATE_CSV]',
  '[GENERATE_CHART]',
  '[GENERATE_HTML]',
  '[GENERATE_JSON]',
  '[GENERATE_MD]',
];

const isMarkerOpening = (s) => TOOL_MARKER_OPENINGS.some((m) => s.startsWith(m));
const isMarkerPrefix = (s) => TOOL_MARKER_OPENINGS.some((m) => m.startsWith(s));

/**
 * Forwards provider deltas to the client as they arrive, instead of buffering
 * the whole reply until the call finishes.
 *
 * The reason the old code buffered is that a reply may *be* a tool call, and
 * tool markers must never reach the user. The gate handles that without waiting
 * for the full text: it emits everything eagerly except a trailing run starting
 * at a '[' that could still grow into a marker. That run is at most
 * '[GENERATE_IMAGE:' long, so the hold-back is imperceptible.
 *
 * Three outcomes for a held run:
 *   - it completes a marker -> this round is a tool call. Stop emitting for the
 *     rest of the round and fire onReset so the client clears any preamble it
 *     already rendered (the tool's real answer arrives in the next round).
 *   - it can no longer match -> release it (ordinary text like "[note]").
 *   - the round ends first   -> flush() releases it.
 *
 * @param {(text: string) => void} emitChunk
 * @param {(() => void) | null} onReset
 */
const createStreamGate = (emitChunk, onReset) => {
  let held = '';          // withheld tail; always starts with '[' when non-empty
  let suppressed = false; // a marker opened: nothing more goes out this round
  let visible = false;    // text is on the client's screen and not yet cleared
  let resetFired = false;

  const emit = (text) => {
    if (!text) return;
    emitChunk(text);
    visible = true;
  };

  const fireReset = () => {
    if (resetFired || !visible) return;
    resetFired = true;
    visible = false;
    if (onReset) onReset();
  };

  // Walk the held run, releasing any leading '[' that cannot start a marker.
  // Returns true when a marker opened.
  const drain = () => {
    while (held) {
      if (isMarkerOpening(held)) {
        suppressed = true;
        held = '';
        fireReset();
        return true;
      }
      if (isMarkerPrefix(held)) return false; // still ambiguous — keep holding
      const next = held.indexOf('[', 1);
      if (next === -1) { emit(held); held = ''; return false; }
      emit(held.slice(0, next));
      held = held.slice(next);
    }
    return false;
  };

  return {
    /** Feed one provider delta. Returns true if this delta opened a marker. */
    push(delta) {
      if (suppressed || !delta) return false;
      const text = held + delta;
      held = '';

      const open = text.indexOf('[');
      if (open === -1) { emit(text); return false; }

      emit(text.slice(0, open));
      held = text.slice(open);
      return drain();
    },

    /** Round ended with no tool call — release whatever is still held. */
    flush() {
      if (suppressed) return;
      emit(held);
      held = '';
    },

    fireReset,
    get visible() { return visible; },
  };
};

const runToolLoop = async ({
  effectiveModelConfig,
  aiMessages,
  abortController,
  processToolCallArgs,
  promptBudget,
  maxToolRounds,
  deadlineAt = null,
  loggerPrefix = 'Tool',
  onBeforeDispatch = null,
  onAfterDispatch = null,
  onAfterToolHandled = null,
  onNoToolCall = null,
  onStreamChunk = null,
  onStreamReset = null,
  onReasoningChunk = null,
  reasoningRequest = {},
}) => {
  const emitStatus = (payload) => {
    if (typeof processToolCallArgs?.onStatus === 'function') {
      processToolCallArgs.onStatus(payload);
    }
  };

  let reply;
  let aiResponse = null;
  let tokensUsed = 0;
  let totalAITokens = 0;
  let totalEmbeddingTokens = 0;
  let cacheCreationTokens = 0;
  let cacheReadTokens = 0;
  let finalReply = '';
  let timedOut = false;
  let roundsUsed = 0;
  // Whether any reply text is currently on the client's screen. Callers
  // compensating for a short-circuited loop need this to avoid re-sending text
  // already streamed — and must not count text a reset has since cleared.
  let streamedToClient = false;
  // Reasoning from every round, including rounds that turned out to be tool
  // calls — deciding to reach for a tool is part of the thought process, so a
  // reset clears the answer text but never this.
  let reasoningText = '';
  const generatedMedia = [];

  const toolRoundStart = aiMessages.length;
  const maxToolTokens = Math.floor(promptBudget.maxPromptTokens * 0.5);

  const trimOldestToolRounds = () => {
    const estimatedToolTokens = estimateMessagesTokens(aiMessages.slice(toolRoundStart));
    if (estimatedToolTokens <= maxToolTokens) return;

    while (aiMessages.length > toolRoundStart + 2) {
      const oldPairTokens = estimateTokens(aiMessages[toolRoundStart].content || '') +
        estimateTokens(aiMessages[toolRoundStart + 1].content || '') + 8;
      aiMessages.splice(toolRoundStart, 2);
      console.log(`[${loggerPrefix}] Trimmed oldest tool round (~${oldPairTokens} tokens) - ${aiMessages.length - toolRoundStart} tool messages remain`);
      if (estimateMessagesTokens(aiMessages.slice(toolRoundStart)) <= maxToolTokens) break;
    }
  };

  for (let round = 0; round < maxToolRounds; round++) {
    // Stop before starting a round the invocation probably cannot finish — being
    // killed mid-round truncates the SSE stream with no error. Round 0 always
    // runs: without it there is no reply to return at all.
    if (round > 0 && deadlineAt && Date.now() >= deadlineAt) {
      timedOut = true;
      console.warn(`[${loggerPrefix}] Time budget exhausted after ${round} round(s) — stopping loop early`);
      emitStatus({
        type: 'status',
        tool: 'tool_loop',
        message: 'Taking too long — wrapping up with what I have...',
      });
      break;
    }
    roundsUsed = round + 1;
    console.log(`[${loggerPrefix}] Round ${round}/${maxToolRounds}`);
    emitStatus({
      type: 'status',
      tool: 'tool_loop',
      message: round === 0 ? 'Thinking...' : 'Continuing with tool results...',
    });
    if (onBeforeDispatch) await onBeforeDispatch({ round });

    let gate = null;

    if (onStreamChunk) {
      gate = createStreamGate(onStreamChunk, () => {
        streamedToClient = false;
        if (onStreamReset) onStreamReset();
      });
      const streamResult = await dispatchToAIStream(
        effectiveModelConfig,
        aiMessages,
        abortController.signal,
        (chunk) => { gate.push(chunk); },
        // Reasoning cannot contain a tool marker, so it bypasses the gate and
        // goes out raw — which is what makes the thinking panel fill instantly
        // on models that reason before answering.
        onReasoningChunk
          ? (chunk) => { reasoningText += chunk; onReasoningChunk(chunk); }
          : null,
        reasoningRequest
      );
      aiResponse = streamResult;
      reply = streamResult.text;
      tokensUsed = streamResult.tokensUsed;
      cacheCreationTokens += streamResult.cacheCreationTokens || 0;
      cacheReadTokens += streamResult.cacheReadTokens || 0;
      totalAITokens += tokensUsed || 0;
    } else {
      const result = await dispatchToAI(effectiveModelConfig, aiMessages, abortController.signal);
      aiResponse = result;
      reply = result.text;
      tokensUsed = result.tokensUsed;
      cacheCreationTokens += result.cacheCreationTokens || 0;
      cacheReadTokens += result.cacheReadTokens || 0;
      totalAITokens += tokensUsed || 0;
    }

    if (onAfterDispatch) {
      await onAfterDispatch({ round, result: { text: reply, tokensUsed, cacheCreationTokens, cacheReadTokens }, reply, tokensUsed });
    }

    console.log(`[${loggerPrefix}] Reply length: ${reply.length}`);
    if (abortController.signal.aborted) {
      return { aborted: true };
    }

    const toolResult = await processToolCall({
      ...processToolCallArgs,
      reply,
      aiResponse,
      aiMessages,
    });

    if (toolResult.handled) {
      // Safety net: processToolCall matched something the gate did not treat as
      // a marker, so a preamble may still be on screen. Clear it either way.
      if (gate) gate.fireReset();
      emitStatus({
        type: 'status',
        tool: 'tool_loop',
        message: 'Using tool and preparing response...',
      });
      aiMessages.push(...toolResult.newMessages);
      totalEmbeddingTokens += toolResult.embedTokens || 0;
      if (toolResult.generatedMedia?.length) generatedMedia.push(...toolResult.generatedMedia);
      trimOldestToolRounds();

      if (onAfterToolHandled) {
        await onAfterToolHandled({
          round,
          reply,
          toolResult,
        });
      }

      continue;
    }

    if (gate) {
      gate.flush();
      streamedToClient = streamedToClient || gate.visible;
    }

    if (onNoToolCall) {
      const noToolResult = await onNoToolCall({
        round,
        reply,
        aiMessages,
        trimOldestToolRounds,
      });
      if (noToolResult?.continueLoop) continue;
      finalReply = noToolResult?.finalReply !== undefined ? noToolResult.finalReply : reply;
      break;
    }

    finalReply = reply;
    break;
  }

  if (!finalReply) finalReply = reply || '';

  return {
    aborted: false,
    reply,
    tokensUsed,
    totalAITokens,
    totalEmbeddingTokens,
    cacheCreationTokens,
    cacheReadTokens,
    finalReply,
    generatedMedia,
    timedOut,
    roundsUsed,
    streamedToClient,
    reasoningText,
  };
};

module.exports = {
  runToolLoop,
};
