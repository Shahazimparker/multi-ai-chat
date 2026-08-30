// ============================================================
// FILE: backend/routes/history.routes.js
// PURPOSE: Chat history endpoints (auth required)
// ============================================================

const express  = require('express');
const router   = express.Router();
const { requireAuth } = require('../middleware/auth');
const { getTopics, getMessages, createTopic, deleteTopic, renameTopic } = require('../controllers/history.controller');

router.use(requireAuth); // all history routes require login

router.get('/topics',                   getTopics);
router.post('/topics',                  createTopic);
router.get('/topics/:id/messages',      getMessages);
router.delete('/topics/:id',            deleteTopic);
router.patch('/topics/:id',             renameTopic);

module.exports = router;
