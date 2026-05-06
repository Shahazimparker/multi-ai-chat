// ============================================================
// FILE: backend/routes/auth.routes.js
// PURPOSE: Authentication endpoints
// ============================================================

const express = require('express');
const router  = express.Router();
const { login, getMe, logout }  = require('../controllers/auth.controller');
const { requireAuth }           = require('../middleware/auth');

router.post('/login',   login);
router.get('/me',       requireAuth, getMe);
router.post('/logout',  requireAuth, logout);

module.exports = router;
