// vitest globals: describe, it, expect, vi, afterEach
//
// human_approvals has no user_id column at the DB level before the IDOR fix,
// so any authenticated user could approve/read someone else's pending tool
// action. These tests exercise the ownership check added to the two "public"
// routes (any authenticated user, not just admins) without needing a real DB —
// approvalManager's methods are stubbed directly.

const { approvalManager } = require('../../services/approvalManager.shared');
const { respondFromChat, checkApprovalStatus } = require('../../controllers/approval.controller');

const makeRes = () => ({
  statusCode: 200,
  body: null,
  status(code) { this.statusCode = code; return this; },
  json(data) { this.body = data; return this; },
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('checkApprovalStatus ownership enforcement', () => {
  const handler = approvalManager.getHandler('default');

  it('returns 404 (not 403) when the caller does not own the request', async () => {
    vi.spyOn(handler, 'getRequestFresh').mockResolvedValue({ userId: 'owner-1', status: 'pending', toJSON: () => ({}) });

    const res = makeRes();
    await checkApprovalStatus({ params: { id: 'approval-1' }, user: { id: 'attacker-2', role: 'user' } }, res);

    expect(res.statusCode).toBe(404);
  });

  it('succeeds for the owning user', async () => {
    vi.spyOn(handler, 'getRequestFresh').mockResolvedValue({ userId: 'owner-1', status: 'pending', toJSON: () => ({ id: 'approval-1' }) });

    const res = makeRes();
    await checkApprovalStatus({ params: { id: 'approval-1' }, user: { id: 'owner-1', role: 'user' } }, res);

    expect(res.statusCode).toBe(200);
    expect(res.body.status).toBe('pending');
  });

  it('lets an admin read a request they do not own', async () => {
    vi.spyOn(handler, 'getRequestFresh').mockResolvedValue({ userId: 'owner-1', status: 'pending', toJSON: () => ({ id: 'approval-1' }) });

    const res = makeRes();
    await checkApprovalStatus({ params: { id: 'approval-1' }, user: { id: 'admin-9', role: 'admin' } }, res);

    expect(res.statusCode).toBe(200);
  });

  // Legacy rows predate the user_id column and cannot be attributed to
  // anyone — they must not become readable by everyone as a side effect.
  it('denies a non-admin on a legacy request with no owner', async () => {
    vi.spyOn(handler, 'getRequestFresh').mockResolvedValue({ userId: null, status: 'pending', toJSON: () => ({}) });

    const res = makeRes();
    await checkApprovalStatus({ params: { id: 'approval-legacy' }, user: { id: 'someone', role: 'user' } }, res);

    expect(res.statusCode).toBe(404);
  });

  it('returns 404 when the request does not exist at all', async () => {
    const handlerFresh = vi.spyOn(handler, 'getRequestFresh').mockResolvedValue(null);

    const res = makeRes();
    await checkApprovalStatus({ params: { id: 'approval-nonexistent' }, user: { id: 'someone', role: 'user' } }, res);

    expect(res.statusCode).toBe(404);
    expect(handlerFresh).toHaveBeenCalledWith('approval-nonexistent');
  });
});

describe('respondFromChat ownership enforcement', () => {
  const handler = approvalManager.getHandler('default');

  it('returns 404 and never calls approve() when the caller does not own the request', async () => {
    vi.spyOn(handler, 'getRequestFresh').mockResolvedValue({ userId: 'owner-1', status: 'pending' });
    const approveSpy = vi.spyOn(approvalManager, 'approve');

    const res = makeRes();
    await respondFromChat({ params: { id: 'approval-1' }, user: { id: 'attacker-2', role: 'user' }, body: { response: true } }, res);

    expect(res.statusCode).toBe(404);
    expect(approveSpy).not.toHaveBeenCalled();
  });

  it('allows the owning user to approve their own request', async () => {
    vi.spyOn(handler, 'getRequestFresh').mockResolvedValue({ userId: 'owner-1', status: 'pending' });
    vi.spyOn(approvalManager, 'approve').mockResolvedValue({ toJSON: () => ({ id: 'approval-1', status: 'approved' }) });

    const res = makeRes();
    await respondFromChat({ params: { id: 'approval-1' }, user: { id: 'owner-1', role: 'user' }, body: { response: true } }, res);

    expect(res.statusCode).toBe(200);
    expect(res.body.status).toBe('approved');
  });
});
