// ============================================================
// FILE: backend/services/memory.service.js
// PURPOSE: Multiple memory strategies for conversation management
//          - BufferMemory: simple message buffer
//          - SummaryMemory: compressed history
//          - EntityMemory: entity tracking
//          - TokenBufferMemory: token-limited buffer
//          - WindowMemory: sliding window + summary
//          - CombinedMemory: merge strategies
//          - embedAndStoreMessage: embed + persist message for cross-chat RAG
//          - searchMemory: semantic search across all user messages
// ============================================================

const { estimateTokens, trimTextByTokens } = require('./tokenBudget.service');
const supabase = require('../config/supabase');
const { embedText } = require('./rag.service');

// Token budget reserved for cross-chat memory block in the AI prompt.
// Carved out separately — does not compete with historyTokens or ragTokens.
const MEMORY_CONTEXT_TOKEN_BUDGET = 600;
const MEMORY_HYBRID_THRESHOLD = 0.56;
const MEMORY_RRF_K = 60;

const tokenizeForRanking = (text) => {
  return String(text || '')
    .toLowerCase()
    .match(/[a-z0-9]+(?:[._-][a-z0-9]+)*/g) || [];
};

const normalizeCosine = (cosine) => {
  const n = Number(cosine || 0);
  return Math.max(0, Math.min(1, (n + 1) / 2));
};

const extractNumericTokens = (text) => {
  return (String(text || '').match(/\b\d+(?:\.\d+)?\b/g) || []).map((n) => n.trim());
};

const jaccardScore = (queryTokens, docTokens) => {
  const qSet = new Set(queryTokens);
  const dSet = new Set(docTokens);
  if (!qSet.size || !dSet.size) return 0;
  let intersection = 0;
  for (const t of qSet) if (dSet.has(t)) intersection++;
  const union = qSet.size + dSet.size - intersection;
  return union > 0 ? intersection / union : 0;
};

const bm25Score = (queryTokens, docTokens, docsTokens, avgDocLen, k1 = 1.2, b = 0.75) => {
  if (!queryTokens.length || !docTokens.length || !docsTokens.length) return 0;
  const tf = new Map();
  for (const t of docTokens) tf.set(t, (tf.get(t) || 0) + 1);
  const N = docsTokens.length;
  const uniqueQ = [...new Set(queryTokens)];
  let score = 0;
  for (const term of uniqueQ) {
    let df = 0;
    for (const dTok of docsTokens) {
      if (dTok.includes(term)) df++;
    }
    if (df === 0) continue;
    const idf = Math.log(1 + (N - df + 0.5) / (df + 0.5));
    const termFreq = tf.get(term) || 0;
    if (!termFreq) continue;
    const denom = termFreq + k1 * (1 - b + b * (docTokens.length / Math.max(1, avgDocLen)));
    score += idf * ((termFreq * (k1 + 1)) / denom);
  }
  return score;
};

const buildRankMapFromScores = (scores) => scores
  .map((score, idx) => ({ idx, score: Number(score) || 0 }))
  .sort((a, b) => b.score - a.score || a.idx - b.idx)
  .reduce((rankMap, item, rank) => {
    rankMap.set(item.idx, rank + 1);
    return rankMap;
  }, new Map());

const reciprocalRankFusionScore = (rankMaps, idx, k = MEMORY_RRF_K) => {
  return rankMaps.reduce((sum, rankMap) => {
    const rank = rankMap.get(idx);
    return sum + (rank ? 1 / (k + rank) : 0);
  }, 0);
};

const rerankMemoryRowsHybrid = (rows, queryText, topK, cosineThreshold) => {
  if (!rows?.length) return [];

  const qTokens = tokenizeForRanking(queryText);
  const qNums = extractNumericTokens(queryText);
  const docsTokens = rows.map((r) => tokenizeForRanking(r.content));
  const avgLen = docsTokens.reduce((s, d) => s + d.length, 0) / Math.max(1, docsTokens.length);

  const bm25Raw = rows.map((r, i) => bm25Score(qTokens, docsTokens[i], docsTokens, avgLen));
  const bm25Max = Math.max(1e-9, ...bm25Raw);
  const cosineNorms = rows.map((row) => normalizeCosine(row.similarity));
  const jaccardScores = rows.map((_, idx) => jaccardScore(qTokens, docsTokens[idx]));
  const bm25Norms = bm25Raw.map((score) => score / bm25Max);
  const rankMaps = [
    buildRankMapFromScores(cosineNorms),
    buildRankMapFromScores(bm25Raw),
    buildRankMapFromScores(jaccardScores),
  ];
  const rrfRaw = rows.map((_, idx) => reciprocalRankFusionScore(rankMaps, idx));
  const rrfMax = Math.max(1e-9, ...rrfRaw);

  const scored = rows.map((row, idx) => {
    const cosineNorm = cosineNorms[idx];
    const jaccard = jaccardScores[idx];
    const bm25Norm = bm25Norms[idx];
    const rrfScore = rrfRaw[idx] / rrfMax;

    const contentNums = new Set(extractNumericTokens(row.content));
    const hasAllNums = qNums.every((n) => contentNums.has(n));
    const numericBoost = qNums.length > 0 && hasAllNums ? 0.1 : 0;

    const lexicalOverlap = qTokens.length ? qTokens.filter((t) => docsTokens[idx].includes(t)).length / qTokens.length : 0;
    const hybridScore = (0.5 * cosineNorm) + (0.25 * bm25Norm) + (0.15 * jaccard) + (0.1 * rrfScore) + numericBoost;

    const numericCriticalMiss = qNums.length > 0 && !hasAllNums && cosineNorm < 0.95;
    const minAccepted = Math.max(MEMORY_HYBRID_THRESHOLD, normalizeCosine(cosineThreshold));
    const lexicalGate = qTokens.length === 0 || lexicalOverlap >= 0.1 || cosineNorm >= 0.85;
    const accepted = !numericCriticalMiss && hybridScore >= minAccepted && lexicalGate;

    return { ...row, bm25Score: bm25Norm, jaccardScore: jaccard, rrfScore, lexicalOverlap, hybridScore, accepted };
  });

  return scored
    .filter((r) => r.accepted)
    .sort((a, b) => b.hybridScore - a.hybridScore)
    .slice(0, topK);
};

/**
 * Base Memory class
 */
class Memory {
  constructor(options = {}) {
    this.messages = [];
    this.metadata = {};
    this.createdAt = new Date();
    this.maxSize = options.maxSize || 100;
  }

  /**
   * Add message to memory
   */
  add(message) {
    this.messages.push({
      ...message,
      timestamp: new Date().toISOString(),
    });
    return this;
  }

  /**
   * Get all messages
   */
  getMessages() {
    return this.messages;
  }

  /**
   * Get formatted history for context
   */
  getHistory() {
    return this.messages
      .map((m) => `${m.role === 'user' ? 'User' : 'Assistant'}: ${m.content}`)
      .join('\n');
  }

  /**
   * Clear memory
   */
  clear() {
    this.messages = [];
    this.metadata = {};
    return this;
  }

  /**
   * Get memory stats
   */
  getStats() {
    return {
      messageCount: this.messages.length,
      userMessages: this.messages.filter((m) => m.role === 'user').length,
      assistantMessages: this.messages.filter((m) => m.role === 'assistant').length,
      createdAt: this.createdAt,
      lastUpdated: this.messages[this.messages.length - 1]?.timestamp,
    };
  }
}

/**
 * BufferMemory — Simple message buffer (last N messages)
 */
class BufferMemory extends Memory {
  constructor(options = {}) {
    super(options);
    this.maxMessages = options.maxMessages || 10;
    this.messageType = options.messageType || 'all'; // 'all', 'user', 'assistant'
  }

  add(message) {
    super.add(message);

    // Keep only last N messages
    if (this.messages.length > this.maxMessages) {
      this.messages.shift();
    }

    return this;
  }

  getMessages() {
    if (this.messageType === 'all') {
      return this.messages;
    }
    return this.messages.filter((m) => m.role === this.messageType);
  }

  getRecentMessages(n = 5) {
    return this.messages.slice(-n);
  }
}

/**
 * SummaryMemory — Compressed history with summaries
 */
class SummaryMemory extends Memory {
  constructor(options = {}) {
    super(options);
    this.summarizer = options.summarizer || null; // async function
    this.summaryThreshold = options.summaryThreshold || 20;
    this.summaries = [];
    this.recentMessages = [];
  }

  async add(message) {
    super.add(message);
    this.recentMessages.push({
      ...message,
      timestamp: new Date().toISOString(),
    });

    // Auto-summarize if too many messages
    if (this.recentMessages.length >= this.summaryThreshold && this.summarizer) {
      await this._createSummary();
    }

    return this;
  }

  /**
   * Create summary of recent messages
   */
  async _createSummary() {
    if (this.recentMessages.length === 0) return;

    const history = this.recentMessages
      .map((m) => `${m.role}: ${m.content}`)
      .join('\n');

    try {
      const summary = await this.summarizer(history);

      this.summaries.push({
        summary,
        messageCount: this.recentMessages.length,
        timestamp: new Date().toISOString(),
      });

      this.recentMessages = [];
    } catch (err) {
      console.error('[SummaryMemory] Summarization failed:', err.message);
    }
  }

  getHistory() {
    let history = '';

    // Add summaries
    if (this.summaries.length > 0) {
      history += '[Previous Conversation Summary]\n';
      history += this.summaries.map((s) => s.summary).join('\n\n');
      history += '\n\n[Recent Messages]\n';
    }

    // Add recent messages
    history += this.recentMessages
      .map((m) => `${m.role === 'user' ? 'User' : 'Assistant'}: ${m.content}`)
      .join('\n');

    return history;
  }

  getSummaries() {
    return this.summaries;
  }
}

/**
 * EntityMemory — Track entities mentioned in conversation
 */
class EntityMemory extends Memory {
  constructor(options = {}) {
    super(options);
    this.entities = new Map(); // name → { type, mentions, lastMentioned }
    this.entityExtractor = options.entityExtractor || this._defaultExtractor;
  }

  /**
   * Default entity extractor (simple pattern-based)
   */
  _defaultExtractor(text) {
    const entities = {
      person: [],
      place: [],
      organization: [],
      date: [],
      number: [],
    };

    // Simple patterns
    const patterns = {
      person: /\b[A-Z][a-z]+ (?:[A-Z][a-z]+)*\b/g,
      date: /\b(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]* \d{1,2}|\d{4}\b/g,
      number: /\b\d+(?:,\d{3})*(?:\.\d+)?\b/g,
    };

    for (const [type, pattern] of Object.entries(patterns)) {
      const matches = text.match(pattern) || [];
      entities[type] = [...new Set(matches)];
    }

    return entities;
  }

  async add(message) {
    super.add(message);

    // Extract entities from message
    const extracted = await this.entityExtractor(message.content);

    for (const [type, items] of Object.entries(extracted)) {
      for (const item of items) {
        if (!this.entities.has(item)) {
          this.entities.set(item, {
            type,
            mentions: 1,
            lastMentioned: new Date().toISOString(),
            firstMentioned: new Date().toISOString(),
          });
        } else {
          const entity = this.entities.get(item);
          entity.mentions++;
          entity.lastMentioned = new Date().toISOString();
        }
      }
    }

    return this;
  }

  getEntities() {
    const grouped = {
      person: [],
      place: [],
      organization: [],
      date: [],
      number: [],
    };

    for (const [name, data] of this.entities) {
      const type = data.type || 'unknown';
      if (grouped[type]) {
        grouped[type].push({
          name,
          mentions: data.mentions,
          lastMentioned: data.lastMentioned,
        });
      }
    }

    return grouped;
  }

  getEntity(name) {
    return this.entities.get(name);
  }
}

/**
 * TokenBufferMemory — Buffer limited by token count
 */
class TokenBufferMemory extends Memory {
  constructor(options = {}) {
    super(options);
    this.maxTokens = options.maxTokens || 2000;
    this.currentTokens = 0;
  }

  add(message) {
    const tokens = estimateTokens(message.content);

    // Add message
    this.messages.push({
      ...message,
      tokens,
      timestamp: new Date().toISOString(),
    });

    this.currentTokens += tokens;

    // Remove oldest messages if exceeds token limit
    while (this.currentTokens > this.maxTokens && this.messages.length > 1) {
      const removed = this.messages.shift();
      this.currentTokens -= removed.tokens;
    }

    return this;
  }

  getStats() {
    return {
      ...super.getStats(),
      totalTokens: this.currentTokens,
      maxTokens: this.maxTokens,
      utilizationPercent: ((this.currentTokens / this.maxTokens) * 100).toFixed(1),
    };
  }
}

/**
 * WindowMemory — Sliding window of recent + summary of older
 */
class WindowMemory extends Memory {
  constructor(options = {}) {
    super(options);
    this.windowSize = options.windowSize || 5;
    this.summarizer = options.summarizer || null;
    this.summaries = [];
    this.recentWindow = [];
  }

  async add(message) {
    super.add(message);
    this.recentWindow.push(message);

    // If window exceeds size, summarize overflow and keep only last windowSize
    if (this.recentWindow.length > this.windowSize && this.summarizer) {
      // Everything except the last windowSize messages gets summarized
      const toSummarize = this.recentWindow.slice(0, this.recentWindow.length - this.windowSize);

      if (toSummarize.length > 0) {
        const history = toSummarize
          .map((m) => `${m.role}: ${m.content}`)
          .join('\n');

        try {
          const summary = await this.summarizer(history);
          this.summaries.push({
            summary,
            messageCount: toSummarize.length,
            timestamp: new Date().toISOString(),
          });
        } catch (err) {
          console.error('[WindowMemory] Summarization failed:', err.message);
        }
      }

      this.recentWindow = this.recentWindow.slice(-this.windowSize);
    }

    return this;
  }

  getHistory() {
    let history = '';

    if (this.summaries.length > 0) {
      history += '[Summary of Earlier Conversation]\n';
      history += this.summaries[this.summaries.length - 1].summary;
      history += '\n\n[Recent Context]\n';
    }

    history += this.recentWindow
      .map((m) => `${m.role === 'user' ? 'User' : 'Assistant'}: ${m.content}`)
      .join('\n');

    return history;
  }

  getRecentWindow() {
    return this.recentWindow;
  }

  getSummaries() {
    return this.summaries;
  }
}

/**
 * CombinedMemory — Use multiple memory strategies together
 */
class CombinedMemory extends Memory {
  constructor(options = {}) {
    super(options);
    this.memories = options.memories || [];
    // memories: [new BufferMemory(), new EntityMemory(), new SummaryMemory()]
  }

  async add(message) {
    for (const memory of this.memories) {
      await memory.add(message);
    }
    this.messages.push(message);
    return this;
  }

  getMemoryByType(type) {
    return this.memories.find((m) => m.constructor.name === type);
  }

  getRecentMessages(n = 5) {
    const buffer = this.getMemoryByType('BufferMemory');
    return buffer ? buffer.getRecentMessages(n) : this.messages.slice(-n);
  }

  getEntities() {
    const entityMemory = this.getMemoryByType('EntityMemory');
    return entityMemory ? entityMemory.getEntities() : {};
  }

  getSummaries() {
    const summaryMemory = this.getMemoryByType('SummaryMemory');
    return summaryMemory ? summaryMemory.getSummaries() : [];
  }

  getHistory() {
    let history = '';

    // Add summaries first
    const summaryMemory = this.getMemoryByType('SummaryMemory');
    if (summaryMemory && summaryMemory.summaries.length > 0) {
      history += '[Conversation Summary]\n';
      history += summaryMemory.summaries.map((s) => s.summary).join('\n\n');
      history += '\n\n';
    }

    // Add recent buffer
    const bufferMemory = this.getMemoryByType('BufferMemory');
    if (bufferMemory) {
      history += '[Recent Messages]\n';
      history += bufferMemory.getHistory();
    }

    return history;
  }

  getComprehensiveContext() {
    return {
      recentMessages: this.getRecentMessages(),
      entities: this.getEntities(),
      summaries: this.getSummaries(),
      fullHistory: this.getHistory(),
      stats: this.getStats(),
    };
  }
}

/**
 * MemoryManager — Manage multiple memory types
 */
class MemoryManager {
  constructor(options = {}) {
    this.memories = new Map(); // conversationId → memory
    this.defaultType = options.defaultType || 'BufferMemory';
    this.summarizer = options.summarizer || null;
    this.tokenLimit = options.tokenLimit || 2000;
  }

  /**
   * Create new memory for conversation
   */
  createMemory(conversationId, type = null, options = {}) {
    const memoryType = type || this.defaultType;

    let memory;

    if (memoryType === 'BufferMemory') {
      memory = new BufferMemory(options);
    } else if (memoryType === 'SummaryMemory') {
      memory = new SummaryMemory({
        summarizer: this.summarizer,
        ...options,
      });
    } else if (memoryType === 'EntityMemory') {
      memory = new EntityMemory(options);
    } else if (memoryType === 'TokenBufferMemory') {
      memory = new TokenBufferMemory({
        maxTokens: this.tokenLimit,
        ...options,
      });
    } else if (memoryType === 'WindowMemory') {
      memory = new WindowMemory({
        summarizer: this.summarizer,
        ...options,
      });
    } else if (memoryType === 'CombinedMemory') {
      const defaultMemories = [
        new BufferMemory(options),
        new EntityMemory(options),
        new SummaryMemory({ summarizer: this.summarizer, ...options }),
      ];
      memory = new CombinedMemory({ memories: defaultMemories, ...options });
    } else {
      throw new Error(`Unknown memory type: ${memoryType}`);
    }

    this.memories.set(conversationId, memory);
    return memory;
  }

  /**
   * Get memory for conversation
   */
  getMemory(conversationId) {
    if (!this.memories.has(conversationId)) {
      this.createMemory(conversationId);
    }
    return this.memories.get(conversationId);
  }

  /**
   * Add message to conversation memory
   */
  addMessage(conversationId, message) {
    const memory = this.getMemory(conversationId);
    memory.add(message);
    return this;
  }

  /**
   * Get conversation history
   */
  getHistory(conversationId) {
    const memory = this.getMemory(conversationId);
    return memory.getHistory();
  }

  /**
   * Switch memory type for conversation
   */
  switchMemoryType(conversationId, newType, options = {}) {
    const oldMemory = this.getMemory(conversationId);
    const oldMessages = oldMemory.getMessages();

    // Create new memory and restore messages
    const newMemory = this.createMemory(conversationId, newType, options);
    for (const message of oldMessages) {
      newMemory.add(message);
    }

    return newMemory;
  }

  /**
   * Get memory stats
   */
  getStats(conversationId) {
    const memory = this.getMemory(conversationId);
    return memory.getStats();
  }

  /**
   * Clear conversation memory
   */
  clearMemory(conversationId) {
    if (this.memories.has(conversationId)) {
      this.memories.get(conversationId).clear();
    }
    return this;
  }

  /**
   * Delete conversation memory
   */
  deleteMemory(conversationId) {
    this.memories.delete(conversationId);
    return this;
  }

  /**
   * List all conversations
   */
  listConversations() {
    return Array.from(this.memories.keys());
  }
}

/**
 * embedAndStoreMessage — embed a single message and persist to message_embeddings.
 * Called after every AI reply in accurate mode (fire-and-forget friendly).
 * Returns tokensUsed so caller can add to billing total.
 *
 * @param {{ userId, topicId, messageId, role, content, provider }} opts
 * @returns {Promise<number>} tokensUsed (0 on cache hit or failure)
 */
const embedAndStoreMessage = async ({ userId, topicId, messageId, role, content, provider = 'openrouter' }) => {
  if (!userId || !topicId || !messageId || !content) return 0;

  try {
    const embedResult = await embedText(content, provider, 3, null, userId);
    if (!embedResult) return 0;

    const { vector, tokensUsed } = embedResult;

    // Insert the embedding; if message_id already exists (duplicate), silently skip
    const { error } = await supabase
      .from('message_embeddings')
      .insert(
        { user_id: userId, topic_id: topicId, message_id: messageId, role, content, embedding: vector }
      );

    if (error && !error.message?.includes('duplicate key')) {
      console.warn('[Memory] embedAndStoreMessage insert failed:', error.message);
      return 0;
    }

    return tokensUsed;
  } catch (err) {
    console.warn('[Memory] embedAndStoreMessage error:', err.message);
    return 0;
  }
};

/**
 * searchMemory — semantic search across all past messages for a user,
 * excluding the current topic (already in context via conversation history).
 * Returns a formatted prompt block injected as a system message, or '' if no results.
 *
 * @param {number[]} queryVector  pre-computed query embedding
 * @param {string}   userId
 * @param {{ excludeTopicId?, topK?, threshold? }} options
 * @returns {Promise<string>}
 */
const searchMemory = async (queryVector, userId, options = {}) => {
  if (!queryVector || !userId) return '';

  const {
    queryText = '',
    excludeTopicId = null,
    topK = 5,
    threshold = 0.5,
    tokenBudget = MEMORY_CONTEXT_TOKEN_BUDGET
  } = options;

  try {
    const { data, error } = await supabase.rpc('search_memory', {
      query_embedding: queryVector,
      p_user_id: userId,
      p_exclude_topic: excludeTopicId || null,
      match_threshold: Math.max(0.2, threshold - 0.2),
      match_count: Math.max(topK * 4, topK),
    });

    if (error) {
      console.warn('[Memory] searchMemory RPC failed:', error.message);
      return '';
    }

    if (!data || data.length === 0) return '';
    const rankedRows = rerankMemoryRowsHybrid(data, queryText, topK, threshold);
    if (!rankedRows.length) return '';

    // Split budget evenly across results, minimum 40 tokens per result
    const perResultBudget = Math.max(40, Math.floor(tokenBudget / rankedRows.length));

    const lines = rankedRows.map((row) => {
      const speaker = row.role === 'user' ? 'User' : 'Assistant';
      const trimmed = trimTextByTokens(row.content, perResultBudget);
      return `- [${speaker}]: ${trimmed}`;
    });

    return `## Relevant context from your past conversations\n${lines.join('\n')}\n`;
  } catch (err) {
    console.warn('[Memory] searchMemory error:', err.message);
    return '';
  }
};

module.exports = {
  Memory,
  BufferMemory,
  SummaryMemory,
  EntityMemory,
  TokenBufferMemory,
  WindowMemory,
  CombinedMemory,
  MemoryManager,
  embedAndStoreMessage,
  searchMemory,
  rerankMemoryRowsHybrid,
};
