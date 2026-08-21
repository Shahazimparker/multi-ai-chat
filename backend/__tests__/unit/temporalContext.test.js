const {
  setClock,
  resetClock,
  isValidTimeZone,
  resolveTimeZone,
  buildTemporalContext,
  renderTemporalSystemBlock,
} = require('../../services/temporalContext.service');

// A fixed instant that exercises the interesting cases at once: an offset with
// a half-hour component, a date that differs from UTC in some zones, and a
// quarter/ISO-week boundary that is not the obvious one.
const INSTANT = new Date('2026-08-22T09:05:47.123Z');

afterEach(() => resetClock());

describe('resolveTimeZone', () => {
  it('prefers the request zone over the profile zone', () => {
    expect(resolveTimeZone({ requestTimeZone: 'Asia/Kolkata', userTimeZone: 'Europe/London' }))
      .toEqual({ timeZone: 'Asia/Kolkata', source: 'request' });
  });

  it('falls back to the profile zone when the request carries none', () => {
    expect(resolveTimeZone({ userTimeZone: 'Europe/London' }))
      .toEqual({ timeZone: 'Europe/London', source: 'user' });
  });

  // A browser-supplied string reaches Intl, so a bad one must degrade rather
  // than throw somewhere deep in the chat path.
  it('skips an invalid zone instead of throwing', () => {
    expect(resolveTimeZone({ requestTimeZone: 'Not/AZone', userTimeZone: 'Europe/London' }))
      .toEqual({ timeZone: 'Europe/London', source: 'user' });
    expect(resolveTimeZone({ requestTimeZone: '../../etc/passwd' }).timeZone).toBe('UTC');
    expect(isValidTimeZone('Not/AZone')).toBe(false);
  });

  it('always resolves to something', () => {
    expect(resolveTimeZone().timeZone).toBeTruthy();
    expect(resolveTimeZone({ requestTimeZone: 123, userTimeZone: null }).timeZone).toBe('UTC');
  });
});

describe('buildTemporalContext', () => {
  it('renders the instant in the requested zone', () => {
    const ctx = buildTemporalContext({ timeZone: 'Asia/Kolkata', at: INSTANT });
    expect(ctx.localDate).toBe('2026-08-22');
    expect(ctx.localTime).toBe('14:35');
    expect(ctx.utcOffset).toBe('UTC+05:30');
    expect(ctx.weekday).toBe('Saturday');
    expect(ctx.utcIso).toBe('2026-08-22T09:05Z');
    expect(ctx.isoWeek).toBe('2026-W34');
    expect(ctx.quarter).toBe('Q3 2026');
  });

  it('gives UTC a signed offset rather than a bare label', () => {
    expect(buildTemporalContext({ timeZone: 'UTC', at: INSTANT }).utcOffset).toBe('UTC+00:00');
  });

  it('crosses the date line correctly for zones behind UTC', () => {
    const ctx = buildTemporalContext({ timeZone: 'Pacific/Honolulu', at: new Date('2026-08-22T05:00:00Z') });
    expect(ctx.localDate).toBe('2026-08-21');
  });

  // Prompt caching keys on an exact prefix match. If the block changed every
  // second, every request would miss the cache.
  it('quantizes to the minute so repeated turns produce an identical block', () => {
    const early = buildTemporalContext({ timeZone: 'UTC', at: new Date('2026-08-22T09:05:01Z') });
    const late = buildTemporalContext({ timeZone: 'UTC', at: new Date('2026-08-22T09:05:59Z') });
    expect(renderTemporalSystemBlock(early)).toBe(renderTemporalSystemBlock(late));

    const next = buildTemporalContext({ timeZone: 'UTC', at: new Date('2026-08-22T09:06:00Z') });
    expect(renderTemporalSystemBlock(next)).not.toBe(renderTemporalSystemBlock(early));
  });

  it('reads the clock seam when no instant is given', () => {
    setClock(INSTANT);
    expect(buildTemporalContext({ timeZone: 'UTC' }).localDate).toBe('2026-08-22');
  });
});

describe('renderTemporalSystemBlock', () => {
  it('states the values and the rules for using them', () => {
    const block = renderTemporalSystemBlock(buildTemporalContext({ timeZone: 'Asia/Kolkata', at: INSTANT }));
    expect(block).toContain('Saturday, 22 August 2026, 14:35 (UTC+05:30)');
    expect(block).toContain('2026-08-22T09:05Z');
    // The rules are what stop the model from hedging or anchoring to UTC.
    expect(block).toContain('Never claim you do not know the current date');
    expect(block).toContain('in Asia/Kolkata');
  });
});
