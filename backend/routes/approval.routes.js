const express = require('express');
const router = express.Router();
const { requireAuth, requireAdmin } = require('../middleware/auth');
const { sanitizeBody } = require('../middleware/sanitize');
const { approveRequest, listPendingApprovals, rejectRequest, respondFromChat, checkApprovalStatus } = require('../controllers/approval.controller');

router.use(requireAuth);

// Public routes — any authenticated user can respond to approvals or check status (used from chat UI)
router.get('/:id/status', checkApprovalStatus);
router.post('/:id/respond', sanitizeBody(['response', 'reason']), respondFromChat);

// Admin-only routes
router.use(requireAdmin);

router.get('/', listPendingApprovals);
router.post('/:id/approve', sanitizeBody(['reason']), approveRequest);
router.post('/:id/reject', sanitizeBody(['reason']), rejectRequest);

module.exports = router;
