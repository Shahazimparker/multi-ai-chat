// ============================================================
// FILE: backend/controllers/history.controller.js
// PURPOSE: Fetch and manage chat history topics and messages
// ============================================================

const supabase = require('../config/supabase');

// ── GET /api/history/topics — list user's topics ──────────
const getTopics = async (req, res) => {
  const { data, error } = await supabase
    .from('topics')
    .select('id, title, model, created_at, updated_at')
    .eq('user_id', req.user.id)
    .order('updated_at', { ascending: false })
    .limit(50);

  if (error) return res.status(500).json({ error: error.message });
  res.json({ topics: data || [] });
};

// ── GET /api/history/topics/:id/messages ──────────────────
const getMessages = async (req, res) => {
  const { id } = req.params;

  // Ensure topic belongs to user
  const { data: topic } = await supabase
    .from('topics')
    .select('id')
    .eq('id', id)
    .eq('user_id', req.user.id)
    .single();

  if (!topic) return res.status(404).json({ error: 'Topic not found' });

  const { data, error } = await supabase
    .from('messages')
    .select('id, role, content, model, tokens_used, created_at')
    .eq('topic_id', id)
    .order('created_at', { ascending: true });

  if (error) return res.status(500).json({ error: error.message });
  res.json({ messages: data || [] });
};

// ── DELETE /api/history/topics/:id — delete a topic ───────
const deleteTopic = async (req, res) => {
  const { id } = req.params;

  const { error } = await supabase
    .from('topics')
    .delete()
    .eq('id', id)
    .eq('user_id', req.user.id); // cascades to messages

  if (error) return res.status(500).json({ error: error.message });
  res.json({ message: 'Topic deleted' });
};

// ── PATCH /api/history/topics/:id — rename topic ──────────
const renameTopic = async (req, res) => {
  const { id }    = req.params;
  const { title } = req.body;
  if (!title) return res.status(400).json({ error: 'Title required' });

  const { data, error } = await supabase
    .from('topics')
    .update({ title })
    .eq('id', id)
    .eq('user_id', req.user.id)
    .select('id, title')
    .single();

  if (error) return res.status(500).json({ error: error.message });
  res.json({ topic: data });
};

module.exports = { getTopics, getMessages, deleteTopic, renameTopic };
