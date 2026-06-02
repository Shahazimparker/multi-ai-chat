const { approvalManager } = require('../services/approvalManager.shared');

const listPendingApprovals = async (req, res) => {
  try {
    const approvals = await approvalManager.listPending('default');
    res.json({ approvals });
  } catch (err) {
    res.status(500).json({ error: err.message || 'Failed to list approvals' });
  }
};

const approveRequest = async (req, res) => {
  try {
    const approval = await approvalManager.approve(req.params.id, req.body?.response ?? true, req.user?.email || req.user?.username || 'human', req.body?.reason || '');
    res.json({ approval: approval.toJSON() });
  } catch (err) {
    res.status(404).json({ error: err.message || 'Approval not found' });
  }
};

const rejectRequest = async (req, res) => {
  try {
    const approval = await approvalManager.reject(req.params.id, req.body?.reason || 'Rejected', req.user?.email || req.user?.username || 'human');
    res.json({ approval: approval.toJSON() });
  } catch (err) {
    res.status(404).json({ error: err.message || 'Approval not found' });
  }
};

/**
 * POST /api/approval/:id/respond
 * Public route (authenticated users) — used from the chat UI to approve/reject/cancel
 * Body: { response: true|false|null, reason?: string }
 *   - true = approve
 *   - false = reject
 *   - null = cancel
 */
const respondFromChat = async (req, res) => {
  try {
    const { response, reason } = req.body;
    const approver = req.user?.email || req.user?.username || 'user';

    if (response === true) {
      const approval = await approvalManager.approve(req.params.id, null, approver, reason || 'Approved from chat');
      return res.json({ success: true, status: 'approved', approval: approval.toJSON() });
    }

    const rejectReason = reason || (response === null ? 'Cancelled by user' : 'Rejected from chat');
    const approval = await approvalManager.reject(req.params.id, rejectReason, approver);
    res.json({ success: true, status: response === null ? 'cancelled' : 'rejected', approval: approval.toJSON() });
  } catch (err) {
    res.status(404).json({ error: err.message || 'Approval request not found' });
  }
};

const checkApprovalStatus = async (req, res) => {
  try {
    const handler = approvalManager.getHandler('default');
    const request = await handler.getRequest(req.params.id);
    if (!request) {
      return res.status(404).json({ error: 'Approval request not found' });
    }
    res.json({ status: request.status, approval: request.toJSON() });
  } catch (err) {
    res.status(500).json({ error: err.message || 'Failed to check approval status' });
  }
};

module.exports = { listPendingApprovals, approveRequest, rejectRequest, respondFromChat, checkApprovalStatus };
