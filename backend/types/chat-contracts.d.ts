export type ChatRole = 'system' | 'user' | 'assistant';

export interface ChatMessage {
  role: ChatRole;
  content: unknown;
}

export interface ToolCallResult {
  handled: boolean;
  newMessages?: ChatMessage[];
  embedTokens?: number;
  generatedMedia?: Array<{ file_id: string; file_name: string; file_type: string }>;
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
  generatedMedia?: Array<{ file_id: string; file_name: string; file_type: string }>;
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

// ── Orchestrator Brain ───────────────────────────────────────

export interface OrchestratorBrainResult {
  enabled: boolean;
  traceId: string;
  error?: string;
  routingDecision?: {
    intent?: string;
    recommendedModelId?: string;
  } | null;
  graph?: any;
  dashboard?: {
    status?: string;
    progress?: number;
    totalSteps?: number;
    completedSteps?: number;
    failedSteps?: number;
    duration?: number;
    totalCost?: string;
    variables?: number;
  };
  suggestions?: any[];
  traceReport?: any;
  metrics?: any;
  costs?: any;
  errors?: any[];
  logs?: string[];
}

// ── Hybrid Reranking ─────────────────────────────────────────

export interface RerankDocInput {
  id: string | number;
  content: string;
  similarity: number;
  [key: string]: unknown;
}

export interface RerankDocOutput extends RerankDocInput {
  hybridScore: number;
  accepted: boolean;
}

// ── Chat pipeline result ─────────────────────────────────────

export interface ChatPipelineResult {
  finalReply: string;
  billableTokens: number;
  totalAITokens: number;
  totalEmbeddingTokens: number;
  orchestratorBrain?: OrchestratorBrainResult | null;
  queryCacheHit?: boolean;
  cacheCreationTokens: number;
  cacheReadTokens: number;
  cacheHit: boolean;
  generatedMediaFiles: Array<{ file_id: string; file_name: string; file_type: string }>;
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
  suggestedModels?: string[] | null;
  recommendedModelId?: string | null;
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

  // runtime controls
  exactCacheEnabled?: boolean;
  embeddingProvider?: string;
  memoryEnabled?: boolean;
  identityCheckEnabled?: boolean;
  perQueryLimitEnabled?: boolean;
  dynamicBudgetEnabled?: boolean;
  historyTokenBudget?: number;
  cacheResponse?: boolean;
  postSaveEmbedding?: boolean;
  enableOrchestratorBrain?: boolean;
  allowArtifactWithCurrentModel?: boolean;

  // callbacks
  onStreamChunk?: OnChunkCallback;
  onToolStatus?: (event: any) => void;
}

// ── Model Config ─────────────────────────────────────────────

// ── PPT Generation ───────────────────────────────────────────

export type PPTTheme =
  | 'modern_corporate'
  | 'startup_bold'
  | 'clean_minimal'
  | 'emerald_glass'
  | 'sunset_warm'
  | 'charcoal_lime'
  | 'sandstone_editorial'
  | 'ruby_noir'
  | 'violet_tech'
  | 'ocean_depth'
  | 'rose_creative'
  | 'mono_editorial';

export type SlideLayout =
  | 'title_bullets'
  | 'two_column'
  | 'cards'
  | 'quote'
  | 'data_story'
  | 'timeline'
  | 'process_steps'
  | 'comparison_split'
  | 'swot_grid'
  | 'kpi_dashboard'
  | 'checklist'
  | 'section_break'
  | 'statistics_strip'
  | 'faq'
  | 'table_like';

export interface SlideInput {
  title: string;
  layout?: SlideLayout;
  subtitle?: string;
  footerNote?: string;
  bullets?: string[];
  /** Plain narrative text rendered when bullets are absent (or as a secondary panel). */
  content?: string;
  /** Left-column header for the comparison_split layout. */
  leftTitle?: string;
  /** Right-column header for the comparison_split layout. */
  rightTitle?: string;
}

export interface PPTGenerationOptions {
  subtitle?: string;
  /** Preferred field — selects one of the 12 built-in themes. */
  theme?: PPTTheme | string;
  /** Legacy alias for theme; theme takes precedence when both are present. */
  style?: PPTTheme | string;
}

export interface PPTGenerationResult {
  file_id: string;
  file_name: string;
  file_type: 'pptx';
  created_at?: string;
}

export interface ModelConfig {
  label: string;
  provider: string;
  apiKey?: string;
  model: string;
  paid: boolean;
  maxTokens: number;
  temperature?: number;
  unified?: boolean;
  reasoning?: {
    thinking: string;
    reasoningEffort: string;
  };
  models?: any[];
}
