// ============================================================
// FILE: backend/services/memory.service.js
// PURPOSE: RAG-based cross-chat memory
//   - Embeds every user + assistant message on save
//   - Searches semantically similar past messages across all chats
//   - Only active in 'accurate' memory mode (not 'summarized')
// ============================================================

const supabase = require('../config/supabase');
const { embedText } = require('./rag.service');

const MIN_CONTENT_LENGTH = 10; // skip very short messages ("ok", "thanks", etc.)

/**
 * Embed a single message and store in message_embeddings table.
 * Called after every message save (user + assistant).
 * Non-blocking — failures are logged but don't break the chat flow.
 * Skips messages shorter than MIN_CONTENT_LENGTH to save costs.
 *
 * @param {Object} params
 * @param {string} params.userId
 * @param {string} params.topicId
 * @param {string} params.messageId - UUID of the saved message
 * @param {string} params.role - 'user' | 'assistant'
 * @param {string} params.content - message text
 * @param {string} [params.provider='openrouter'] - embedding provider
 * @returns {number} tokensUsed (0 if skipped/failed)
 */
const embedAndStoreMessage = async ({ userId, topicId, messageId, role, content, provider = 'openrouter' }) => {
  if (!userId || !topicId || !messageId || !content) return 0;
  if (content.trim().length < MIN_CONTENT_LENGTH) return 0; // skip short/noise messages

  try {
    const embedResult = await embedText(content, provider, 2, null, userId);
    if (!embedResult || !embedResult.vector) {
      console.warn('[Memory] Embedding failed for message:', messageId);
      return 0;
    }

    const { error } = await supabase.from('message_embeddings').insert({
      user_id: userId,
      topic_id: topicId,
      message_id: messageId,
      role,
      content,
      embedding: embedResult.vector,
    });

    if (error) {
      console.warn('[Memory] Insert failed for message:', messageId, error.message);
      return 0;
    }

    return embedResult.tokensUsed || 0;
  } catch (err) {
    // Non-critical — log and continue
    console.warn('[Memory] embedAndStoreMessage error:', err.message);
    return 0;
  }
};

/**
 * Search semantically similar past messages across ALL user chats.
 * Excludes the current topic (already in context).
 * Deduplicates near-identical results — keeps only the most recent.
 * Only called when memoryMode === 'accurate'.
 *
 * @param {number[]} queryEmbedding - vector from embedText
 * @param {string} userId
 * @param {Object} options
 * @param {string} [options.excludeTopicId] - skip current topic
 * @param {number} [options.topK=5] - max results
 * @param {number} [options.threshold=0.5] - minimum cosine similarity
 * @returns {string} formatted memory context block (or empty string)
 */
const searchMemory = async (queryEmbedding, userId, options = {}) => {
  if (!queryEmbedding || !userId) return '';

  const { excludeTopicId = null, topK = 5, threshold = 0.5 } = options;

  try {
    const { data, error } = await supabase.rpc('search_memory', {
      query_embedding: queryEmbedding,
      p_user_id: userId,
      p_exclude_topic: excludeTopicId,
      match_threshold: threshold,
      match_count: topK * 2, // fetch extra for dedup
    });

    if (error || !data || data.length === 0) return '';

    // Deduplicate: group by normalized content, keep most recent
    const seen = new Map();
    for (const m of data) {
      const key = m.content.trim().toLowerCase().slice(0, 100); // normalize
      if (!seen.has(key) || new Date(m.created_at) > new Date(seen.get(key).created_at)) {
        seen.set(key, m);
      }
    }

    // Take top-K after dedup
    const deduped = [...seen.values()].slice(0, topK);

    // Format as readable context block
    const lines = deduped.map((m, i) => {
      const speaker = m.role === 'user' ? 'User' : 'Assistant';
      const timeAgo = getRelativeTime(m.created_at);
      return `[Memory ${i + 1}] (${speaker}, ${timeAgo})\n${m.content}`;
    });

    return `[RELEVANT PAST MEMORIES — from other conversations]\n${lines.join('\n\n')}\n[END MEMORIES]\n\nIf relevant, use the above memories to inform your response.`;
  } catch (err) {
    console.warn('[Memory] searchMemory error:', err.message);
    return '';
  }
};

/**
 * Simple relative time helper (e.g., "2 days ago", "3 hours ago")
 */
const getRelativeTime = (timestamp) => {
  if (!timestamp) return '';
  const now = Date.now();
  const then = new Date(timestamp).getTime();
  const diffMs = now - then;
  const diffMin = Math.floor(diffMs / 60000);
  const diffHrs = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffMin < 1) return 'just now';
  if (diffMin < 60) return `${diffMin}m ago`;
  if (diffHrs < 24) return `${diffHrs}h ago`;
  if (diffDays < 30) return `${diffDays}d ago`;
  return `${Math.floor(diffDays / 30)}mo ago`;
};

module.exports = { embedAndStoreMessage, searchMemory };
