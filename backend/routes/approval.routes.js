const express = require('express');
const router = express.Router();
const { requireAuth, requireAdmin } = require('../middleware/auth');
const { sanitizeBody } = require('../middleware/sanitize');
const { approveRequest, listPendingApprovals, rejectRequest } = require('../controllers/approval.controller');

router.use(requireAuth, requireAdmin);

router.get('/', listPendingApprovals);
router.post('/:id/approve', sanitizeBody(['reason']), approveRequest);
router.post('/:id/reject', sanitizeBody(['reason']), rejectRequest);

module.exports = router;
