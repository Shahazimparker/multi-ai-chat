export type ChatRole = 'system' | 'user' | 'assistant';

export interface ChatMessage {
  role: ChatRole;
  content: unknown;
}

export interface ToolCallResult {
  handled: boolean;
  newMessages?: ChatMessage[];
  embedTokens?: number;
  dbQueried?: boolean;
  lastSqlQuery?: string;
  lastDbResultBlock?: string;
  consecutiveZeroResults?: number;
  dbQueryCount?: number;
  resultCount?: number;
}

export interface ToolLoopResult {
  aborted: boolean;
  reply?: string;
  tokensUsed?: number;
  totalAITokens?: number;
  totalEmbeddingTokens?: number;
  cacheCreationTokens?: number;
  cacheReadTokens?: number;
  finalReply: string;
  dbQueried: boolean;
  lastDbResultBlock: string;
  lastSqlQuery: string;
  consecutiveZeroResults: number;
  dbQueryCount: number;
  generatedMedia?: Array<{ type: string; url: string; name: string }>;
}

export interface BillableTokenInput {
  totalAITokens?: number;
  promptTokens?: number;
  finalReply?: string;
  totalEmbeddingTokens?: number;
  estimatedInputTokens?: number;
  compressTokens?: number;
  historySummaryTokens?: number;
}

// ── Streaming types ──────────────────────────────────────────

export interface AiProviderStreamResult {
  text: string;
  tokensUsed: number;
  cacheCreationTokens?: number;
  cacheReadTokens?: number;
}

export type OnChunkCallback = (text: string) => void;

// ── Chat pipeline result ─────────────────────────────────────

export interface ChatPipelineResult {
  finalReply: string;
  billableTokens: number;
  totalAITokens: number;
  totalEmbeddingTokens: number;
  cacheCreationTokens: number;
  cacheReadTokens: number;
  cacheHit: boolean;
  dbQueried: boolean;
  lastDbResultBlock: string;
  consecutiveZeroResults: number;
  dbQueryCount: number;
  generatedMediaFiles: Array<{ type: string; url: string; name: string }>;
  resolvedTopicId: string | null;
  persistError: Error | null;
  estimatedInputTokens: number;
  compressTokens: number;
  historySummaryTokens: number;
  modelConfig: any | null;
  effectiveModelConfig: any | null;
  isIdentityQuestion: boolean;
  savedUserMessageId: string | null;
  savedAssistantMessageId: string | null;
  promptTokens: number;
  err: Error | null;
  errorType: string | null;
  userMessage: string | null;
}

export interface ChatPipelineOptions {
  modelId: string;
  providerModelId?: string;
  message: string;
  image?: string;
  topicId?: string;
  user?: any;
  isAnonymous: boolean;
  memoryMode?: string;
  historyLimit?: number;
  ragEnabled?: boolean;
  history?: any[];
  abortController: AbortController;

  // divergence controls
  exactCacheEnabled?: boolean;
  embeddingProvider?: string;
  memoryEnabled?: boolean;
  identityCheckEnabled?: boolean;
  perQueryLimitEnabled?: boolean;
  dynamicBudgetEnabled?: boolean;
  historyTokenBudget?: number;
  cacheResponse?: boolean;
  postSaveEmbedding?: boolean;

  // callbacks
  onStreamChunk?: OnChunkCallback;
  onToolStatus?: (event: any) => void;
}
