// ============================================================
// FILE: frontend/src/utils/sse.js
// PURPOSE: Incremental Server-Sent Events parser.
// ============================================================
// Network chunks do not align with SSE frame boundaries: a single `data: {...}`
// frame can arrive split across two reads, and a multi-byte UTF-8 character can
// be split mid-sequence. Parsing each chunk in isolation therefore drops events
// (a truncated frame fails JSON.parse) and mangles non-ASCII text.
//
// `createSseParser` keeps the trailing partial frame in a buffer and only emits
// events once a full frame (terminated by a blank line) has arrived.

/** Parse one complete SSE frame into its JSON payload, or null if not usable. */
const parseFrame = (frame) => {
  const dataLines = [];
  for (const line of frame.split('\n')) {
    // Per spec: strip the field name and one optional leading space.
    if (line.startsWith('data:')) dataLines.push(line.slice(5).replace(/^ /, ''));
  }
  if (dataLines.length === 0) return null;

  const payload = dataLines.join('\n').trim();
  if (!payload || payload === '[DONE]') return null;

  try {
    return JSON.parse(payload);
  } catch {
    return null;
  }
};

const FRAME_SEPARATOR = /\r?\n\r?\n/;

/**
 * Create a stateful parser.
 *
 * @returns {{ push: (chunk: string) => object[], flush: () => object[] }}
 *   `push` returns the events completed by this chunk; `flush` returns any
 *   final event left in the buffer when the stream ends without a trailing
 *   blank line.
 */
export const createSseParser = () => {
  let buffer = '';

  return {
    push(chunk) {
      buffer += chunk;
      const events = [];

      for (;;) {
        const match = FRAME_SEPARATOR.exec(buffer);
        if (!match) break;

        const frame = buffer.slice(0, match.index);
        buffer = buffer.slice(match.index + match[0].length);

        const event = parseFrame(frame);
        if (event) events.push(event);
      }

      return events;
    },

    flush() {
      const remainder = buffer;
      buffer = '';
      if (!remainder.trim()) return [];
      const event = parseFrame(remainder);
      return event ? [event] : [];
    },
  };
};

export default createSseParser;
