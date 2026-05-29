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
});
