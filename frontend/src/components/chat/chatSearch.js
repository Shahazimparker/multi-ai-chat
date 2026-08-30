// ============================================================
// FILE: frontend/src/components/chat/chatSearch.js
// PURPOSE: Find a phrase inside the conversation already on screen.
//          Pure and synchronous by design — the open chat's messages are
//          already in memory, so searching them needs no request and can
//          update on every keystroke.
// ============================================================

// How much of the line to show around a hit. Enough to recognise the moment in
// the conversation, short enough that a result row stays one or two lines.
const LEAD = 40;
const TRAIL = 90;

// Markdown, code fences and hard-wrapped prose all survive into `content`, and
// a snippet built from them renders as a ragged block. Flattening to a single
// spaced line keeps the result rows uniform; the message itself is untouched.
const flatten = (text) => String(text ?? '').replace(/\s+/g, ' ').trim();

const ELLIPSIS = '…';

/**
 * Every message containing `query`, in conversation order.
 *
 * Matching is case-insensitive and literal — a plain substring, not a regex, so
 * a query full of parentheses or asterisks searches for those characters
 * instead of throwing or quietly meaning something else.
 *
 * @param {Array<{role: string, content: string, created_at?: string}>} messages
 * @param {string} query
 * @returns {Array<{index: number, role: string, createdAt?: string, matchCount: number,
 *                  before: string, match: string, after: string}>}
 */
export const searchMessages = (messages, query) => {
  const needle = String(query ?? '').trim().toLowerCase();
  if (!needle || !Array.isArray(messages)) return [];

  const results = [];

  messages.forEach((message, index) => {
    const flat = flatten(message?.content);
    if (!flat) return;

    const haystack = flat.toLowerCase();
    const first = haystack.indexOf(needle);
    if (first === -1) return;

    // Count every occurrence, not just the one shown: "3 matches" tells the
    // reader this message is where the topic was actually discussed.
    let matchCount = 0;
    let cursor = first;
    while (cursor !== -1) {
      matchCount += 1;
      cursor = haystack.indexOf(needle, cursor + needle.length);
    }

    const start = Math.max(0, first - LEAD);
    const end = Math.min(flat.length, first + needle.length + TRAIL);

    results.push({
      index,
      role: message.role,
      createdAt: message.created_at,
      matchCount,
      // Split rather than pre-highlighted markup, so the panel can render the
      // hit in a <mark> without ever putting message text through innerHTML.
      before: (start > 0 ? ELLIPSIS : '') + flat.slice(start, first),
      match: flat.slice(first, first + needle.length),
      after: flat.slice(first + needle.length, end) + (end < flat.length ? ELLIPSIS : ''),
    });
  });

  return results;
};

// The id `ChatMessagesPanel` stamps on each rendered row. Shared so the panel
// that writes it and the search that scrolls to it cannot drift apart.
export const messageDomId = (index) => `chat-msg-${index}`;

export default searchMessages;
