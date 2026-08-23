const express = require('express');
const router = express.Router();
const { requireAuth, requireAdmin } = require('../middleware/auth');
const { sanitizeBody, sanitizeInput, sanitizeText } = require('../middleware/sanitize');
const { approveRequest, listPendingApprovals, rejectRequest, respondFromChat, checkApprovalStatus } = require('../controllers/approval.controller');

router.use(requireAuth);

// `reason` is free text a user types (the "Other" instructions box) that gets
// fed back to the model verbatim as [USER MODIFICATION REQUEST] — tag-stripping
// it would mangle content like "use Array<T> generics" before the model ever
// sees it. `response` is a control value (true/false/null), not text.
const respondSanitizer = sanitizeBody({ response: sanitizeInput, reason: sanitizeText });
const reasonSanitizer = sanitizeBody({ reason: sanitizeText });

// Public routes — any authenticated user can respond to approvals or check status (used from chat UI)
router.get('/:id/status', checkApprovalStatus);
router.post('/:id/respond', respondSanitizer, respondFromChat);

// Admin-only routes
router.use(requireAdmin);

router.get('/', listPendingApprovals);
router.post('/:id/approve', reasonSanitizer, approveRequest);
router.post('/:id/reject', reasonSanitizer, rejectRequest);

module.exports = router;
