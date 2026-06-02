export type ChatRole = 'system' | 'user' | 'assistant';
export type ApprovalStatus = 'pending' | 'approved' | 'rejected' | 'expired' | 'cancelled';

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

// ── Approval / Human-in-the-Loop types ───────────────────────

export interface ApprovalRequest {
  id: string;
  type: 'approval' | 'input' | 'selection' | 'feedback';
  title: string;
  description: string;
  context: Record<string, unknown>;
  options: string[];
  timeout: number | null;
  requiredBy: string | null;
  createdAt: string;
  expiresAt: string | null;
  status: ApprovalStatus;
  response: unknown;
  reason: string;
  approver: string | null;
  approvedAt: string | null;
}

export interface ApprovalSSEEvent {
  type: 'approval_request';
  approvalId: string;
  toolType: string;
  toolLabel: string;
  message: string;
  /** Human-readable plan summary (newline-delimited). Present for all 10 GENERATE_* tools. */
  summary?: string;
  /** Three-option approval: yes = proceed, other = provide instructions, no = cancel. */
  options: ('yes' | 'other' | 'no')[];
}

/**
 * Result returned by waitForUserApproval when the user picks "Yes" with optional instructions.
 * `instructions` is non-empty only when the user chose the "Other" path (response === true but
 * reason differs from the default 'Approved from chat').
 */
export interface ToolApprovalResultWithInstructions {
  approved: boolean;
  reason: string;
  instructions: string; // non-empty = user wants modifications before generation
}

/**
 * Context object passed to buildSummary() — all fields are optional because different
 * GENERATE_* tools populate different subsets.
 */
export interface BuildSummaryContext {
  title?: string;
  prompt?: string;
  theme?: string;
  slides?: Array<{ title?: string; [key: string]: unknown }>;
  sections?: Array<{ heading?: string; title?: string; name?: string; [key: string]: unknown }>;
  sheets?: Array<{ name?: string; title?: string; [key: string]: unknown }>;
  headers?: string[];
  rowCount?: number;
  labels?: string[];
  type?: string;
}

export interface ApprovalResponse {
  success: boolean;
  status: ApprovalStatus;
  approval: ApprovalRequest;
}

export interface ApprovalStatusResponse {
  status: ApprovalStatus;
  approval: ApprovalRequest;
}

export interface ApprovalManagerConfig {
  store: unknown;
  waitForApproval: boolean;
}

export interface ToolApprovalResult {
  approved: boolean;
  reason: string;
  /** Non-empty when the user chose the "Other" path and typed modification instructions. */
  instructions?: string;
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

// ── SSE Event Types ──────────────────────────────────────────

export type SSEEvent =
  | { type: 'connected'; status: string }
  | { type: 'chunk'; text: string }
  | { type: 'done'; tokensUsed: number; cacheHit?: boolean; model?: string; topicId?: string; generatedFiles?: Array<{ file_id: string; file_name: string; file_type: string }> }
  | { type: 'error'; error: string; errorType?: string }
  | { type: 'cached'; reply: string }
  | { type: 'status'; tool: string; message: string }
  | ApprovalSSEEvent;

// ── Model Config placeholder ─────────────────────────────────

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

// ── Tool Processor types ─────────────────────────────────────

export interface ProcessToolCallArgs {
  reply: string;
  aiResponse?: unknown;
  aiMessages?: Array<{ role: ChatRole; content: unknown }>;
  user?: { id?: string } | null;
  topicId?: string | null;
  abortController: AbortController;
  onStatus?: (event: unknown) => void;
}

export type ToolName =
  | 'GENERATE_PPT'
  | 'GENERATE_IMAGE'
  | 'GENERATE_HTML'
  | 'GENERATE_PDF'
  | 'GENERATE_EXCEL'
  | 'GENERATE_DOCX'
  | 'GENERATE_CHART'
  | 'GENERATE_CSV'
  | 'GENERATE_JSON'
  | 'GENERATE_MD';

// ── Model Config ─────────────────────────────────────────────

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
