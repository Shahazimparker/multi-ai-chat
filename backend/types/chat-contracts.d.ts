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
  finalReply: string;
  dbQueried: boolean;
  lastDbResultBlock: string;
  lastSqlQuery: string;
  consecutiveZeroResults: number;
  dbQueryCount: number;
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
