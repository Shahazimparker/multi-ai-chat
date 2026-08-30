import { describe, expect, it } from 'vitest';
import { messageDomId, searchMessages } from './chatSearch';

// Find-in-chat matches against message text that is markdown, often long, and
// typed by a person who is not thinking about regex syntax. These pin the parts
// that decide whether a result is findable and readable.

const messages = [
  { role: 'user', content: 'How do I configure the Vercel Blob token?', created_at: '2026-01-01T10:00:00Z' },
  { role: 'assistant', content: 'Set `BLOB_READ_WRITE_TOKEN` in your environment.\n\nThe **token** is per-store.', created_at: '2026-01-01T10:00:05Z' },
  { role: 'user', content: 'Thanks!' },
];

describe('searchMessages', () => {
  it('returns only matching messages, keeping their position in the transcript', () => {
    const results = searchMessages(messages, 'token');

    // `index` is what the panel scrolls to, so it must be the index in the full
    // transcript — not the position within the filtered results.
    expect(results.map((r) => r.index)).toEqual([0, 1]);
  });

  it('matches case-insensitively', () => {
    expect(searchMessages(messages, 'VERCEL')).toHaveLength(1);
    expect(searchMessages(messages, 'vercel')).toHaveLength(1);
  });

  it('counts every occurrence in a message, not just the shown one', () => {
    // "TOKEN" in the env var and "token" in the prose.
    const [hit] = searchMessages(messages, 'token').filter((r) => r.index === 1);
    expect(hit.matchCount).toBe(2);
  });

  it('splits the snippet around the hit instead of returning markup', () => {
    const [hit] = searchMessages(messages, 'Vercel');

    // The panel renders `match` inside <mark>; handing back pre-built HTML
    // would mean putting message text through innerHTML.
    expect(hit.match).toBe('Vercel');
    expect(`${hit.before}${hit.match}${hit.after}`).toContain('configure the Vercel Blob token');
    expect(hit.before + hit.after).not.toContain('<');
  });

  it('flattens newlines so a snippet stays on one line', () => {
    const [hit] = searchMessages(messages, 'per-store');

    expect(hit.before).not.toContain('\n');
    expect(hit.after).not.toContain('\n');
  });

  it('treats the query literally, so regex characters find themselves', () => {
    const withSymbols = [{ role: 'user', content: 'try a.repeat(3) and [x](y)' }];

    // As a regex, `a.repeat(3)` would match "arepeat3"-ish text and `[x]` would
    // be a character class. Both must be plain substrings.
    expect(searchMessages(withSymbols, 'a.repeat(3)')).toHaveLength(1);
    expect(searchMessages(withSymbols, '[x](y)')).toHaveLength(1);
    expect(searchMessages(withSymbols, 'axrepeat')).toHaveLength(0);
  });

  it('ellipsizes only where text was actually cut', () => {
    const long = [{ role: 'assistant', content: `${'a '.repeat(200)}needle${' b'.repeat(200)}` }];
    const [hit] = searchMessages(long, 'needle');

    expect(hit.before.startsWith('…')).toBe(true);
    expect(hit.after.endsWith('…')).toBe(true);

    // A short message is shown whole, with no misleading ellipsis.
    const [short] = searchMessages([{ role: 'user', content: 'needle' }], 'needle');
    expect(short.before).toBe('');
    expect(short.after).toBe('');
  });

  it('finds nothing for an empty or whitespace query', () => {
    expect(searchMessages(messages, '')).toEqual([]);
    expect(searchMessages(messages, '   ')).toEqual([]);
  });

  it('survives messages with no usable content', () => {
    const ragged = [
      { role: 'assistant', content: null },
      { role: 'assistant' },
      { role: 'user', content: 'token' },
    ];

    expect(searchMessages(ragged, 'token').map((r) => r.index)).toEqual([2]);
  });

  it('tolerates a missing message list', () => {
    expect(searchMessages(undefined, 'token')).toEqual([]);
    expect(searchMessages(null, 'token')).toEqual([]);
  });
});

describe('messageDomId', () => {
  it('is the same id the transcript stamps on each row', () => {
    // Both sides import this; if it ever stopped agreeing, results would
    // silently scroll nowhere.
    expect(messageDomId(0)).toBe('chat-msg-0');
    expect(messageDomId(42)).toBe('chat-msg-42');
  });
});
