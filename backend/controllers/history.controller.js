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
    .eq('is_summary', false)
    .order('created_at', { ascending: true });

  if (error) return res.status(500).json({ error: error.message });
  res.json({ messages: data || [] });
};

const deleteTopic = async (req, res) => {
  try {
    const topicId = req.params.id;
    const user = req.user;

    if (!user) return res.status(401).json({ error: 'Unauthorized' });

    // DELETE related documents from RAG
    await supabase
      .from('rag_documents')
      .delete()
      .eq('topic_id', topicId);

    // DELETE query_cache entries scoped to this topic
    await supabase
      .from('query_cache')
      .delete()
      .eq('topic_id', topicId);

    // DELETE messages
    await supabase
      .from('messages')
      .delete()
      .eq('topic_id', topicId);

    // DELETE uploaded_files (chunk-level RAG) — cascades to rag_chunks
    await supabase
      .from('uploaded_files')
      .delete()
      .eq('topic_id', topicId);

    // DELETE uploaded_files_rag (legacy file-level RAG)
    await supabase
      .from('uploaded_files_rag')
      .delete()
      .eq('topic_id', topicId);

    // DELETE code_files
    await supabase
      .from('code_files')
      .delete()
      .eq('topic_id', topicId);

    // DELETE topic (last — FK references depend on it)
    await supabase
      .from('topics')
      .delete()
      .eq('id', topicId)
      .eq('user_id', user.id);

    res.json({ success: true, message: 'Topic and related data deleted' });
  } catch (err) {
    console.error('[History] Delete error:', err.message);
    res.status(500).json({ error: err.message });
  }
};

const renameTopic = async (req, res) => {
  try {
    const { id } = req.params;
    const { title } = req.body;
    const user = req.user;

    if (!user) return res.status(401).json({ error: 'Unauthorized' });
    if (!title) return res.status(400).json({ error: 'Title required' });

    const { data, error } = await supabase
      .from('topics')
      .update({ title, updated_at: new Date().toISOString() })
      .eq('id', id)
      .eq('user_id', user.id)
      .select();

    if (error) return res.status(500).json({ error: error.message });
    res.json({ success: true, topic: data[0] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

module.exports = { getTopics, getMessages, deleteTopic, renameTopic };