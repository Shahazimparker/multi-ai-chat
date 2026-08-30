// ============================================================
// FILE: backend/controllers/history.controller.js
// PURPOSE: Fetch and manage chat history topics and messages
// ============================================================

const supabase = require('../config/supabase');

// Set false the first time a query proves the opt-in `reasoning` column is
// absent, so every later request skips straight to the working column list.
let reasoningColumnExists = true;

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

  const BASE_COLUMNS = 'id, role, content, model, tokens_used, created_at, generated_files';

  const fetchMessages = (columns) => supabase
    .from('messages')
    .select(columns)
    .eq('topic_id', id)
    .eq('is_summary', false)
    .order('created_at', { ascending: true });

  // `reasoning` is an opt-in migration
  // (database/migration_add_reasoning_to_messages.sql). Selecting a column that
  // does not exist fails the whole query, so drop it and retry rather than
  // return no history at all.
  let { data, error } = await fetchMessages(
    reasoningColumnExists ? `${BASE_COLUMNS}, reasoning` : BASE_COLUMNS
  );
  if (error && reasoningColumnExists && /reasoning/i.test(error.message || '')) {
    console.warn('[History] messages.reasoning column not found — run database/migration_add_reasoning_to_messages.sql to keep reasoning across reloads.');
    reasoningColumnExists = false;
    ({ data, error } = await fetchMessages(BASE_COLUMNS));
  }

  if (error) return res.status(500).json({ error: error.message });
  res.json({ messages: data || [] });
};

const deleteTopic = async (req, res) => {
  try {
    const topicId = req.params.id;
    const user = req.user;

    if (!user) return res.status(401).json({ error: 'Unauthorized' });

    // Clean up blobs from storage associated with this topic
    try {
      const { data: topicFiles } = await supabase
        .from('uploaded_files_rag')
        .select('blob_url')
        .eq('topic_id', topicId)
        .eq('user_id', user.id);

      if (topicFiles && topicFiles.length > 0) {
        const { deleteBlobFromStorage } = require('../services/blobStorage.service');
        await Promise.allSettled(
          topicFiles
            .filter((f) => Boolean(f.blob_url))
            .map((f) => deleteBlobFromStorage(f.blob_url))
        );
      }
    } catch (blobErr) {
      console.warn('[History] Topic blob cleanup error:', blobErr.message);
    }

    // Explicitly delete generated/uploaded files for this topic first.
    // The uploaded_files_rag FK is ON DELETE SET NULL, so the RPC alone may leave
    // orphaned rows if the deployed function predates the uploaded_files_rag cleanup step.
    await supabase
      .from('uploaded_files_rag')
      .delete()
      .eq('topic_id', topicId)
      .eq('user_id', user.id);

    await supabase
      .from('uploaded_files')
      .delete()
      .eq('topic_id', topicId)
      .eq('user_id', user.id);

    // Use Supabase RPC for atomic topic deletion (all-or-nothing)
    const { error } = await supabase.rpc('delete_topic_cascade', {
      p_topic_id: topicId,
      p_user_id: user.id,
    });

    if (error) {
      console.error('[History] Delete error:', error.message);
      return res.status(500).json({ error: error.message });
    }

    res.json({ success: true, message: 'Topic and related data deleted' });
  } catch (err) {
    console.error('[History] Delete error:', err.message);
    res.status(500).json({ error: err.message });
  }
};

// ── POST /api/history/topics — open an empty conversation ──
//
// The chat pipeline creates the topic for an ordinary first message, and that
// stays the normal path. This exists for the one case that cannot wait for it:
// a first message carrying an attachment. Those files are uploaded before the
// message is streamed, so without a topic to belong to they land with
// topic_id NULL and are adopted afterwards by a ten-minute backfill window —
// which means they are, briefly, in no conversation at all, and any file left
// unclaimed by a send that never completes stays that way. Handing the client
// an id up front is what every current chat app does (create the conversation,
// then attach to it), and it removes the orphan state rather than repairing it.
const createTopic = async (req, res) => {
  try {
    const user = req.user;
    if (!user) return res.status(401).json({ error: 'Unauthorized' });

    const { title, model } = req.body || {};
    // The column is TEXT, but the sidebar renders this untruncated — and the
    // pipeline caps its own titles at 60 for the same reason.
    const safeTitle = String(title || '').trim().slice(0, 60) || 'New chat';

    const { data, error } = await supabase
      .from('topics')
      .insert({
        user_id: user.id,
        title: safeTitle,
        model: typeof model === 'string' ? model : null,
      })
      .select('id, title, model, created_at, updated_at')
      .single();

    if (error) {
      console.error('[History] Create topic error:', error.message);
      return res.status(500).json({ error: error.message });
    }

    res.status(201).json({ topic: data });
  } catch (err) {
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

    // `.update()` with no matching row resolves to `{ data: [] }` rather than
    // an error, so the empty-array case must be handled explicitly — otherwise
    // renaming a missing or unowned topic reports `{ success: true, topic:
    // undefined }` with HTTP 200.
    if (!data || data.length === 0) {
      return res.status(404).json({ error: 'Topic not found' });
    }

    res.json({ success: true, topic: data[0] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

module.exports = { getTopics, getMessages, createTopic, deleteTopic, renameTopic };