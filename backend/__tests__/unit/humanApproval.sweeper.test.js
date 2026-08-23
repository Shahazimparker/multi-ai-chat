// vitest globals: describe, it, expect, vi, beforeAll, afterAll
//
// Bug D, second order. The first attempt at "nothing ever calls cleanup()" was a
// setInterval in the HumanApprovalHandler constructor. That closes over `this`,
// and the timer list is a GC root, so every handler ever built becomes immortal
// — a bigger leak than the one being fixed, and unref() does not help (it only
// stops the timer holding the event loop open, not the reference). The service
// now uses one process-wide sweeper holding WeakRefs instead.
//
// This lives in its own file on purpose: the sweeper timer is created lazily by
// the FIRST handler constructed in the process, so it can only be observed
// under fake timers if nothing has constructed one yet. Any handler built by an
// earlier test in the same file would start the timer against real timers and
// make these assertions silently vacuous.

const { HumanApprovalHandler } = require('../../services/humanApproval.service');

const SWEEP_MS = 10 * 60 * 1000;

describe('cleanup sweeper', () => {
  beforeAll(() => { vi.useFakeTimers(); });
  afterAll(() => { vi.useRealTimers(); });

  it('runs cleanup() on every live handler from a single shared timer', () => {
    const intervalSpy = vi.spyOn(global, 'setInterval');

    const a = new HumanApprovalHandler({ waitForApproval: false });
    const b = new HumanApprovalHandler({ waitForApproval: false });
    const c = new HumanApprovalHandler({ waitForApproval: false });

    // One timer for three handlers — not one each.
    const sweepTimers = intervalSpy.mock.calls.filter(([, ms]) => ms === SWEEP_MS);
    expect(sweepTimers).toHaveLength(1);
    intervalSpy.mockRestore();

    const cleanupA = vi.spyOn(a, 'cleanup');
    const cleanupB = vi.spyOn(b, 'cleanup');
    const cleanupC = vi.spyOn(c, 'cleanup');
    expect(cleanupA).not.toHaveBeenCalled();

    vi.advanceTimersByTime(SWEEP_MS + 1);
    expect(cleanupA).toHaveBeenCalledTimes(1);
    expect(cleanupB).toHaveBeenCalledTimes(1);
    expect(cleanupC).toHaveBeenCalledTimes(1);

    // One handler throwing must not abort the sweep for the rest.
    cleanupA.mockImplementation(() => { throw new Error('boom'); });
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.advanceTimersByTime(SWEEP_MS + 1);
    expect(cleanupB).toHaveBeenCalledTimes(2);
    expect(cleanupC).toHaveBeenCalledTimes(2);

    // A disposed handler stops being swept; the others carry on.
    b.dispose();
    vi.advanceTimersByTime(SWEEP_MS + 1);
    expect(cleanupB).toHaveBeenCalledTimes(2);
    expect(cleanupC).toHaveBeenCalledTimes(3);

    vi.restoreAllMocks();
  });

  it('really does sweep expired state, not just call a method', async () => {
    const handler = new HumanApprovalHandler({ waitForApproval: false });
    handler._logAudit('ancient', {});
    handler.auditLog[0].timestamp = new Date(Date.now() - 7200000).toISOString();
    handler.saveSnapshot({ id: 'snap-old' });
    handler.snapshots.get('snap-old').timestamp = new Date(Date.now() - 7200000).toISOString();

    vi.advanceTimersByTime(SWEEP_MS + 1);

    expect(handler.getAuditLog().some((e) => e.action === 'ancient')).toBe(false);
    expect(handler.snapshots.has('snap-old')).toBe(false);
  });
});
