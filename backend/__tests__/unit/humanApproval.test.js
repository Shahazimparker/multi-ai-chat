const { ApprovalManager, HumanApprovalHandler } = require('../../services/humanApproval.service');

const createMemoryStore = () => {
  const rows = new Map();
  const api = {
    upsert: async (payload) => {
      rows.set(payload.id, { created_at: new Date().toISOString(), ...rows.get(payload.id), ...payload });
      return { data: rows.get(payload.id), error: null };
    },
    update: (patch) => ({
      eq: async (_field, id) => {
        rows.set(id, { ...rows.get(id), ...patch });
        return { data: rows.get(id), error: null };
      },
    }),
    select: () => ({
      eq: (field, value) => ({
        maybeSingle: async () => ({ data: [...rows.values()].find((row) => row[field] === value) || null, error: null }),
        order: async () => ({ data: [...rows.values()].filter((row) => row[field] === value), error: null }),
      }),
    }),
  };
  return { from: () => api, rows };
};

describe('human approval deploy-safe mode', () => {
  it('persists approval and returns immediately without long wait', async () => {
    const store = createMemoryStore();
    const handler = new HumanApprovalHandler({ store, waitForApproval: false });

    const started = Date.now();
    const request = await handler.requestApproval({ title: 'Approve tool', timeout: 300000, requiredBy: 'test' });

    expect(Date.now() - started).toBeLessThan(1000);
    expect(request.status).toBe('pending');
    expect(store.rows.get(request.id).status).toBe('pending');
    expect(request.timeout).toBeLessThanOrEqual(1000);
  });

  it('approves persisted request across manager instances', async () => {
    const store = createMemoryStore();
    const creator = new ApprovalManager({ store, waitForApproval: false });
    const handler = creator.createHandler('default', { store, waitForApproval: false });
    const request = await handler.requestApproval({ title: 'Approve deploy-safe action' });

    const responder = new ApprovalManager({ store, waitForApproval: false });
    const approved = await responder.approve(request.id, true, 'admin@example.com', 'ok');

    expect(approved.status).toBe('approved');
    expect(store.rows.get(request.id).status).toBe('approved');
    expect(store.rows.get(request.id).approver).toBe('admin@example.com');
  });

  // Bug E: the serverless clamp exists to stop THIS process blocking, not to
  // shorten the deadline a human actually has to respond — those used to be
  // the same number.
  it('persists the real approval window in expires_at, independent of the serverless wait clamp', async () => {
    const store = createMemoryStore();
    const handler = new HumanApprovalHandler({ store, waitForApproval: false });

    const request = await handler.requestApproval({ title: 'Generate PPT', timeout: 120000 });

    // In-process wait cap stays clamped — this is what stops the handler blocking.
    expect(request.timeout).toBeLessThanOrEqual(1000);

    // The persisted deadline must reflect the real 120s window, not the 1s clamp.
    const persistedExpiry = new Date(store.rows.get(request.id).expires_at).getTime();
    const msUntilExpiry = persistedExpiry - Date.now();
    expect(msUntilExpiry).toBeGreaterThan(60000);
    expect(msUntilExpiry).toBeLessThanOrEqual(120000);

    // And it must still be "pending" for the duration of that real window —
    // this is the thing the fix must not accidentally break.
    expect(request.isPending()).toBe(true);
  });

  // Bug A: status reads during polling (and the status endpoint) must not trust
  // a same-instance cache — the approval is routinely granted from a different
  // lambda instance than the one asking about it.
  it('getRequestFresh reflects a status change made by a different handler instance', async () => {
    const store = createMemoryStore();
    const creatorHandler = new HumanApprovalHandler({ store, waitForApproval: false });
    const request = await creatorHandler.requestApproval({ title: 'Generate image' });

    // Simulate the poller: it has already cached the pending request locally,
    // the same way a lambda instance that created the request would.
    expect(creatorHandler.getRequest(request.id).status).toBe('pending');

    // Approval happens on a totally separate handler/instance sharing only the DB.
    const responderHandler = new HumanApprovalHandler({ store, waitForApproval: false });
    await responderHandler.approve(request.id, true, 'human', 'looks good');

    // The stale in-memory cache would still say "pending" — getRequestFresh must not.
    expect(creatorHandler.getRequest(request.id).status).toBe('pending');
    const fresh = await creatorHandler.getRequestFresh(request.id);
    expect(fresh.status).toBe('approved');
  });

  it('getRequestFresh throws on a store error rather than silently reporting not-found', async () => {
    const store = createMemoryStore();
    const handler = new HumanApprovalHandler({ store, waitForApproval: false });
    const request = await handler.requestApproval({ title: 'Generate PDF' });

    store.from = () => ({
      select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: { message: 'connection reset' } }) }) }),
    });

    await expect(handler.getRequestFresh(request.id)).rejects.toThrow('connection reset');
  });

  // Bug D: nothing ever called cleanup() before, so requests/snapshots/audit
  // entries accumulated forever in a long-lived process.
  it('caps the audit log length as entries are logged', async () => {
    const handler = new HumanApprovalHandler({ waitForApproval: false });

    for (let i = 0; i < 5010; i++) {
      handler._logAudit('test_event', { i });
    }

    expect(handler.getAuditLog().length).toBeLessThanOrEqual(5000);
    // The most recent entries must survive the trim, not the oldest.
    const last = handler.getAuditLog().at(-1);
    expect(last.data.i).toBe(5009);
  });

  it('cleanup() trims old audit entries in addition to old requests/snapshots', async () => {
    const handler = new HumanApprovalHandler({ waitForApproval: false });
    handler._logAudit('old_event', {});
    handler.auditLog[0].timestamp = new Date(Date.now() - 7200000).toISOString(); // 2h old
    handler._logAudit('recent_event', {});

    handler.cleanup(3600000); // 1h retention

    const remaining = handler.getAuditLog();
    expect(remaining.some((e) => e.action === 'old_event')).toBe(false);
    expect(remaining.some((e) => e.action === 'recent_event')).toBe(true);
  });

  // Bug D, second order: the periodic cleanup must not itself leak. A
  // setInterval created per handler closes over `this` and the timer list is a
  // GC root, so every handler ever built would be immortal — turning the
  // memory-leak fix into a bigger memory leak. One shared sweeper holding
  // WeakRefs is what keeps handlers collectable.
  it('does not start a timer per handler, and leaves handlers garbage-collectable', async () => {
    const store = createMemoryStore();
    const timerSpy = vi.spyOn(global, 'setInterval');
    const handlers = [];
    for (let i = 0; i < 50; i++) handlers.push(new HumanApprovalHandler({ store, waitForApproval: false }));

    const sweepTimers = timerSpy.mock.calls.filter(([, ms]) => ms === 10 * 60 * 1000);
    expect(sweepTimers.length).toBeLessThanOrEqual(1);
    timerSpy.mockRestore();

    // Nothing may hold a strong reference to a dropped handler.
    const ref = new WeakRef(handlers[0]);
    handlers.length = 0;
    if (typeof global.gc === 'function') {
      global.gc();
      await new Promise((r) => setTimeout(r, 0));
      global.gc();
      expect(ref.deref()).toBeUndefined();
    }
  });

  // The sweeper timer itself is asserted in humanApproval.sweeper.test.js —
  // it has to be the first thing in its file to observe the lazy start.

  it('createHandler replacing a name disposes the handler it evicts', async () => {
    const store = createMemoryStore();
    const manager = new ApprovalManager({ store, waitForApproval: false });
    const first = manager.createHandler('default', { store });
    const disposeSpy = vi.spyOn(first, 'dispose');
    const second = manager.createHandler('default', { store });

    expect(disposeSpy).toHaveBeenCalled();
    expect(manager.getHandler('default')).toBe(second);
    expect(manager.handlers.size).toBe(1);
  });
});
