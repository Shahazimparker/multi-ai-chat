<<<<<<< HEAD
// ============================================================
// FILE: backend/services/context.service.js
// PURPOSE: Builds chat memory context using memory modes
// ============================================================

const supabase = require('../config/supabase');
const { summarizeMemory } = require('./summary.service');

const clamp = (value, min, max) => {
  const number = Number(value);
  if (Number.isNaN(number)) return min;
  return Math.max(min, Math.min(max, number));
};

const getRecentMessages = async (topicId, limit = 10) => {
  const { data, error } = await supabase
    .from('messages')
    .select('role, content, created_at')
    .eq('topic_id', topicId)
    .order('created_at', { ascending: false })
    .limit(limit);

  if (error) return [];
  return (data || []).reverse();
};

const formatMessages = (messages) => {
  return messages
    .map(m => `${m.role === 'user' ? 'User' : 'Assistant'}: ${m.content}`)
    .join('\n');
};

const buildContextMessages = async (newQuery, topicId, options = {}) => {
  if (!topicId) return { context: [], isNewTopic: true };

  const memoryMode = options.memoryMode || 'summarized';
  const requestedLimit = clamp(options.historyLimit || 10, 2, 20);

  const rawLimit = memoryMode === 'accurate'
    ? requestedLimit
    : Math.max(4, Math.min(requestedLimit, 8));

  const recent = await getRecentMessages(topicId, rawLimit);
  if (recent.length === 0) return { context: [], isNewTopic: true };

  let memoryText = '';

  if (memoryMode === 'accurate') {
    memoryText = `You are continuing the same chat topic. Use the raw previous conversation below to answer the user's next message. If the user's message is short or vague, infer it from this context.

[RECENT RAW CONVERSATION]
${formatMessages(recent)}
[END RECENT RAW CONVERSATION]`;
  } else {
    const latestRawCount = 4;
    const olderMessages = recent.slice(0, Math.max(0, recent.length - latestRawCount));
    const latestMessages = recent.slice(-latestRawCount);

    let olderSummaryBlock = '';

    if (olderMessages.length > 0) {
      const olderText = formatMessages(olderMessages);
      const { summary, provider, model } = await summarizeMemory(olderText);

      olderSummaryBlock = `[OLDER CONVERSATION SUMMARY]
${summary}
[SUMMARY SOURCE: ${provider}/${model}]
[END OLDER CONVERSATION SUMMARY]

`;
    }

    memoryText = `You are continuing the same chat topic. Use the memory below to answer the user's next message. If the user's message is short or vague, infer it from this context.

${olderSummaryBlock}[LATEST RAW CONVERSATION]
${formatMessages(latestMessages)}
[END LATEST RAW CONVERSATION]`;
  }

  return {
    context: [{
      role: 'user',
      content: memoryText,
    }],
    isNewTopic: false,
  };
};

const maybeCompressQuery = async (query) => {
  const wordCount = query.split(/\s+/).length;
  if (wordCount < 150) return query;

  const { summary } = await summarizeMemory(query);
  return summary || query;
};

=======
// ============================================================
// FILE: backend/services/context.service.js
// PURPOSE: Builds chat memory context using memory modes
// ============================================================

const supabase = require('../config/supabase');
const { summarizeMemory } = require('./summary.service');

const clamp = (value, min, max) => {
  const number = Number(value);
  if (Number.isNaN(number)) return min;
  return Math.max(min, Math.min(max, number));
};

const getRecentMessages = async (topicId, limit = 10) => {
  const { data, error } = await supabase
    .from('messages')
    .select('role, content, created_at')
    .eq('topic_id', topicId)
    .order('created_at', { ascending: false })
    .limit(limit);

  if (error) return [];
  return (data || []).reverse();
};

const formatMessages = (messages) => {
  return messages
    .map(m => `${m.role === 'user' ? 'User' : 'Assistant'}: ${m.content}`)
    .join('\n');
};

const buildContextMessages = async (newQuery, topicId, options = {}) => {
  if (!topicId) return { context: [], isNewTopic: true };

  const memoryMode = options.memoryMode || 'summarized';
  const requestedLimit = clamp(options.historyLimit || 10, 2, 20);

  const rawLimit = memoryMode === 'accurate'
    ? requestedLimit
    : Math.max(4, Math.min(requestedLimit, 8));

  const recent = await getRecentMessages(topicId, rawLimit);
  if (recent.length === 0) return { context: [], isNewTopic: true };

  let memoryText = '';

  if (memoryMode === 'accurate') {
    memoryText = `You are continuing the same chat topic. Use the raw previous conversation below to answer the user's next message. If the user's message is short or vague, infer it from this context.

[RECENT RAW CONVERSATION]
${formatMessages(recent)}
[END RECENT RAW CONVERSATION]`;
  } else {
    const latestRawCount = 4;
    const olderMessages = recent.slice(0, Math.max(0, recent.length - latestRawCount));
    const latestMessages = recent.slice(-latestRawCount);

    let olderSummaryBlock = '';

    if (olderMessages.length > 0) {
      const olderText = formatMessages(olderMessages);
      const { summary, provider, model } = await summarizeMemory(olderText);

      olderSummaryBlock = `[OLDER CONVERSATION SUMMARY]
${summary}
[SUMMARY SOURCE: ${provider}/${model}]
[END OLDER CONVERSATION SUMMARY]

`;
    }

    memoryText = `You are continuing the same chat topic. Use the memory below to answer the user's next message. If the user's message is short or vague, infer it from this context.

${olderSummaryBlock}[LATEST RAW CONVERSATION]
${formatMessages(latestMessages)}
[END LATEST RAW CONVERSATION]`;
  }

  return {
    context: [{
      role: 'user',
      content: memoryText,
    }],
    isNewTopic: false,
  };
};

const maybeCompressQuery = async (query) => {
  const wordCount = query.split(/\s+/).length;
  if (wordCount < 150) return query;

  const { summary } = await summarizeMemory(query);
  return summary || query;
};

>>>>>>> c9ec5b9f4d670d2a03b23ffc88d06e047ea4f7f1
module.exports = { buildContextMessages, maybeCompressQuery, getRecentMessages };