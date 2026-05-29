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

module.exports = { listPendingApprovals, approveRequest, rejectRequest };
