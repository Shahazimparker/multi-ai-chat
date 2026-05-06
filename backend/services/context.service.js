// ============================================================
// FILE: backend/services/context.service.js
// PURPOSE: Fetches last 10 messages of a topic and creates a
//          trimmed summary using Gemini Flash for context injection
//          Also compresses long new queries using Gemini Flash
// ============================================================

const { GoogleGenerativeAI } = require('@google/generative-ai');
const supabase                = require('../config/supabase');
const { SUMMARY_MODEL }       = require('../config/models');

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

/**
 * getRecentMessages - fetch last N messages for a topic
 */
const getRecentMessages = async (topicId, limit = 10) => {
  const { data, error } = await supabase
    .from('messages')
    .select('role, content, created_at')
    .eq('topic_id', topicId)
    .order('created_at', { ascending: false })
    .limit(limit);

  if (error) return [];
  return (data || []).reverse(); // oldest first
};

/**
 * summarizeWithGemini - creates a concise summary of messages
 * Always uses Gemini Flash regardless of selected model
 * @param {string} text  text to summarize
 * @returns {string}     summary
 */
const summarizeWithGemini = async (text) => {
  try {
    const model = genAI.getGenerativeModel({ model: SUMMARY_MODEL.model });
    const result = await model.generateContent(
      `Summarize the following conversation in 3-5 concise bullet points. Focus on key topics, decisions, and context needed to continue the conversation:\n\n${text}`
    );
    return result.response.text();
  } catch (err) {
    console.error('[Context] Gemini summarization failed:', err.message);
    return text.slice(0, 500); // fallback: truncate
  }
};

/**
 * buildContextMessages - main function used by chat controller
 * Returns array of {role, content} messages to prepend to the AI call
 *
 * Logic:
 *  1. If no topicId -> new chat, no context
 *  2. If topicId exists -> summarize recent messages and inject as context
 */
const buildContextMessages = async (newQuery, topicId) => {
  if (!topicId) return { context: [], isNewTopic: true };

  const recent = await getRecentMessages(topicId, 10);
  if (recent.length === 0) return { context: [], isNewTopic: true };

  const historyText = recent
    .map(m => `${m.role === 'user' ? 'User' : 'Assistant'}: ${m.content}`)
    .join('\n');

  const summary = await summarizeWithGemini(historyText);

return {
  context: [{
    role: 'user',
    content: `You are continuing the same chat topic. Use the previous conversation below to answer the user's next message. Do not say the previous context is missing unless the raw messages truly do not contain it. If the user's message is short or vague, infer it from the previous conversation.

[PREVIOUS CONVERSATION SUMMARY]
${summary}
[END PREVIOUS CONVERSATION SUMMARY]

[RECENT RAW CONVERSATION]
${historyText}
[END RECENT RAW CONVERSATION]`,
  }],
  isNewTopic: false,
};
};

/**
 * maybeCompressQuery - if query is long, summarize it first
 * Reduces input tokens for expensive paid models
 */
const maybeCompressQuery = async (query) => {
  const wordCount = query.split(/\s+/).length;
  if (wordCount < 150) return query; // short enough - skip

  try {
    const model = genAI.getGenerativeModel({ model: SUMMARY_MODEL.model });
    const result = await model.generateContent(
      `Compress this query to its essential meaning in under 100 words while keeping all technical details:\n\n${query}`
    );
    return result.response.text();
  } catch {
    return query; // fallback to original
  }
};

module.exports = { buildContextMessages, maybeCompressQuery, getRecentMessages };
