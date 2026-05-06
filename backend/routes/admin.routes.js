// ============================================================
// FILE: backend/routes/admin.routes.js
// PURPOSE: Admin-only endpoints for user & analytics management
// ============================================================

const express  = require('express');
const router   = express.Router();
const { requireAuth, requireAdmin } = require('../middleware/auth');
const {
  getUsers, createUser, updateUser, deleteUser, resetTokens, getAnalytics,
} = require('../controllers/admin.controller');

// All admin routes require both auth + admin role
router.use(requireAuth, requireAdmin);

router.get('/users',                  getUsers);
router.post('/users',                 createUser);
router.put('/users/:id',              updateUser);
router.delete('/users/:id',           deleteUser);
router.post('/users/:id/reset-tokens', resetTokens);
router.get('/analytics',              getAnalytics);

module.exports = router;
