// ============================================================
// FILE: backend/services/topicOwnership.service.js
// PURPOSE: "Does this caller own this conversation?" — the one question every
//          route that accepts a topic id from a request body has to ask.
// ============================================================

const supabase = require('../config/supabase');

/**
 * Every upload and file-generation route takes `topicId` straight from the
 * request and stores the file under it. Nothing downstream re-checks: the
 * Attachments panel lists a conversation's files by topic_id, and RAG retrieval
 * feeds them to whoever is chatting in that topic. Without this gate, any
 * authenticated user could plant a file in someone else's conversation —
 * visible in their panel, and readable by their model as context.
 *
 * A missing id is fine and returns true: the file is simply unscoped, which is
 * a legitimate state (uploads made before a chat exists). Only a *supplied* id
 * has to be earned.
 *
 * A malformed uuid fails the cast and surfaces as a query error, which is
 * treated as "not owned" — the same answer as a topic that does not exist, so
 * this can never be used to probe which ids are real.
 *
 * @param {string|null|undefined} topicId
 * @param {string} userId
 * @returns {Promise<boolean>} false when the topic is missing or another user's
 */
const callerOwnsTopic = async (topicId, userId) => {
  if (!topicId) return true;
  if (!userId) return false;

  const { data, error } = await supabase
    .from('topics')
    .select('id')
    .eq('id', topicId)
    .eq('user_id', userId)
    .maybeSingle();

  if (error) {
    console.warn('[TopicOwnership] Lookup failed:', error.message);
    return false;
  }
  return Boolean(data);
};

// Deliberately a 404 rather than a 403: a 403 would confirm the topic exists,
// turning the check into an existence oracle for other users' conversations.
const TOPIC_NOT_FOUND = { error: 'Topic not found' };

module.exports = { callerOwnsTopic, TOPIC_NOT_FOUND };
