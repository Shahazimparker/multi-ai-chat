import { describe, expect, it } from 'vitest';
import { createSseParser } from './sse';

describe('createSseParser', () => {
  it('parses a complete frame', () => {
    const parser = createSseParser();
    expect(parser.push('data: {"type":"chunk","text":"hi"}\n\n')).toEqual([
      { type: 'chunk', text: 'hi' },
    ]);
  });

  it('parses several frames arriving in one chunk', () => {
    const parser = createSseParser();
    const events = parser.push(
      'data: {"type":"chunk","text":"a"}\n\ndata: {"type":"chunk","text":"b"}\n\n'
    );
    expect(events).toEqual([
      { type: 'chunk', text: 'a' },
      { type: 'chunk', text: 'b' },
    ]);
  });

  // The regression this parser exists for: a frame split across two reads used
  // to fail JSON.parse and be silently dropped.
  it('reassembles a frame split across chunk boundaries', () => {
    const parser = createSseParser();
    expect(parser.push('data: {"type":"chunk","te')).toEqual([]);
    expect(parser.push('xt":"split"}\n\n')).toEqual([{ type: 'chunk', text: 'split' }]);
  });

  it('reassembles a frame split one character at a time', () => {
    const parser = createSseParser();
    const payload = 'data: {"type":"done","tokensUsed":42}\n\n';
    const events = [];
    for (const char of payload) events.push(...parser.push(char));
    expect(events).toEqual([{ type: 'done', tokensUsed: 42 }]);
  });

  it('holds a partial frame until its terminator arrives', () => {
    const parser = createSseParser();
    expect(parser.push('data: {"type":"chunk","text":"pending"}')).toEqual([]);
    expect(parser.push('\n\n')).toEqual([{ type: 'chunk', text: 'pending' }]);
  });

  it('emits a trailing frame with no terminator on flush', () => {
    const parser = createSseParser();
    expect(parser.push('data: {"type":"done","topicId":"t1"}')).toEqual([]);
    expect(parser.flush()).toEqual([{ type: 'done', topicId: 't1' }]);
  });

  it('flush is empty when the buffer holds nothing usable', () => {
    const parser = createSseParser();
    parser.push('data: {"type":"chunk","text":"x"}\n\n');
    expect(parser.flush()).toEqual([]);
  });

  it('handles CRLF frame separators', () => {
    const parser = createSseParser();
    expect(parser.push('data: {"type":"chunk","text":"crlf"}\r\n\r\n')).toEqual([
      { type: 'chunk', text: 'crlf' },
    ]);
  });

  it('ignores non-data lines such as comments and heartbeats', () => {
    const parser = createSseParser();
    expect(parser.push(': keep-alive\n\n')).toEqual([]);
    expect(parser.push('event: ping\n\n')).toEqual([]);
  });

  it('skips malformed JSON without throwing or losing later frames', () => {
    const parser = createSseParser();
    const events = parser.push('data: {not json}\n\ndata: {"type":"chunk","text":"ok"}\n\n');
    expect(events).toEqual([{ type: 'chunk', text: 'ok' }]);
  });

  it('preserves multi-byte characters reassembled across chunks', () => {
    const parser = createSseParser();
    parser.push('data: {"type":"chunk","text":"emoji ');
    const events = parser.push('\\ud83d\\ude80 done"}\n\n');
    expect(events).toEqual([{ type: 'chunk', text: 'emoji 🚀 done' }]);
  });

  it('joins multi-line data fields into one payload', () => {
    const parser = createSseParser();
    expect(parser.push('data: {"type":"chunk",\ndata: "text":"joined"}\n\n')).toEqual([
      { type: 'chunk', text: 'joined' },
    ]);
  });

  it('treats the sentinel [DONE] payload as non-data', () => {
    const parser = createSseParser();
    expect(parser.push('data: [DONE]\n\n')).toEqual([]);
  });
});
