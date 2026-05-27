// ============================================================
// FILE: backend/services/chat.service.js
// PURPOSE: Backward-compatible export surface for chat modules.
// ============================================================

const bizDbState = require('./bizDbState.service');
const { extractReferencedTables, buildFileContext, formatDbResults, buildFallbackDbReply, processToolCall } = require('./toolProcessor.service');
const { runToolLoop } = require('./toolLoop.service');
const { stripToolTags, isPlaceholderOnly, classifyError } = require('./chatCleanup.service');

const { loadDocument, getLoaderType } = require('./documentLoader.service');
const { createVectorStore, PgVectorStore, InMemoryStore, HybridVectorStore } = require('./vectorStore.service');
const { createParser, JSONParser, MarkdownParser, CSVParser, RegexParser } = require('./outputParser.service');
const { createChain, SimpleChain, ConditionalChain, ParallelChain, ChainComposer, MapChain, LoopChain } = require('./chain.service');
const { createAgent, createTool, Agent, Tool, ToolRegistry } = require('./agent.service');
const { createCallbackManager, getGlobalCallbackManager, handlers } = require('./callbacks.service');
const { createRetriever, VectorRetriever, BM25Retriever, HybridRetriever, MetadataRetriever, RerankerRetriever, ChainedRetriever } = require('./retriever.service');
const { PromptTemplate, FewShotTemplate, ChatTemplate, ConditionalTemplate, FormattedOutputTemplate, RoleTemplate, LoopTemplate, PromptComposer, TemplateRegistry, getGlobalRegistry } = require('./promptTemplate.service');
const { BufferMemory, SummaryMemory, EntityMemory, TokenBufferMemory, WindowMemory, CombinedMemory, MemoryManager } = require('./memory.service');
const { Graph, GraphNode, GraphEdge, ConditionalEdge, GraphState, SubGraph, GraphBuilder } = require('./graphWorkflow.service');
const { ApprovalRequest, InterruptPoint, ExecutionSnapshot, HumanApprovalHandler, ApprovalManager } = require('./humanApproval.service');
const { CycleCounter, LoopBreaker, LoopConfig, LoopResult, LoopExecutor, RefinementLoop, QueryLoop, ValidationLoop, PipelineLoop } = require('./loopManagement.service');
const { ToolSelectionStrategy, GreedyToolSelection, EnsembleToolSelection, SmartAgent, ReActLoop, AgentOrchestrator } = require('./agentOrchestrator.service');
const { ExecutionStep, ExecutionTrace, ExecutionTracer, TraceFormatter, TraceAnalyzer } = require('./executionTracer.service');
const { Variable, StateTracker, FlowAnalyzer, FlowVisualizer, FlowDebugger, FlowDashboard, FlowOptimizer } = require('./flowVisibility.service');

module.exports = {
  // Query safety limits
  MAX_DB_QUERIES: bizDbState.MAX_DB_QUERIES,
  MAX_CONSECUTIVE_ZERO_RESULTS: bizDbState.MAX_CONSECUTIVE_ZERO_RESULTS,

  // State
  ensureBizDbInit: bizDbState.ensureBizDbInit,
  get bizDbConnected() { return bizDbState.bizDbConnected; },
  get bizDbSchemaText() { return bizDbState.bizDbSchemaText; },
  get bizDbMinimalSchemaText() { return bizDbState.bizDbMinimalSchemaText; },

  // Pure utilities
  reserveToolLoopBudget: bizDbState.reserveToolLoopBudget,
  extractReferencedTables,

  // Builders
  buildBizDbDirective: bizDbState.buildBizDbDirective,
  buildFileContext,

  // Tool processing
  processToolCall,
  runToolLoop,

  // Cleanup & formatting
  stripToolTags,
  formatDbResults,
  buildFallbackDbReply,
  isPlaceholderOnly,

  // Error handling
  classifyError,

  // Document Loading
  loadDocument,
  getLoaderType,

  // Vector Store
  createVectorStore,
  PgVectorStore,
  InMemoryStore,
  HybridVectorStore,

  // Output Parsers
  createParser,
  JSONParser,
  MarkdownParser,
  CSVParser,
  RegexParser,

  // Chains
  createChain,
  SimpleChain,
  ConditionalChain,
  ParallelChain,
  ChainComposer,
  MapChain,
  LoopChain,

  // Agents
  createAgent,
  createTool,
  Agent,
  Tool,
  ToolRegistry,

  // Callbacks
  createCallbackManager,
  getGlobalCallbackManager,
  callbacks: handlers,

  // Retrievers
  createRetriever,
  VectorRetriever,
  BM25Retriever,
  HybridRetriever,
  MetadataRetriever,
  RerankerRetriever,
  ChainedRetriever,

  // Prompt Templates
  PromptTemplate,
  FewShotTemplate,
  ChatTemplate,
  ConditionalTemplate,
  FormattedOutputTemplate,
  RoleTemplate,
  LoopTemplate,
  PromptComposer,
  TemplateRegistry,
  getGlobalRegistry,

  // Memory Types
  BufferMemory,
  SummaryMemory,
  EntityMemory,
  TokenBufferMemory,
  WindowMemory,
  CombinedMemory,
  MemoryManager,

  // Graph Workflows
  Graph,
  GraphNode,
  GraphEdge,
  ConditionalEdge,
  GraphState,
  SubGraph,
  GraphBuilder,

  // Human-in-the-Loop approvals
  ApprovalRequest,
  InterruptPoint,
  ExecutionSnapshot,
  HumanApprovalHandler,
  ApprovalManager,

  // Loop management
  CycleCounter,
  LoopBreaker,
  LoopConfig,
  LoopResult,
  LoopExecutor,
  RefinementLoop,
  QueryLoop,
  ValidationLoop,
  PipelineLoop,

  // Agent orchestration
  ToolSelectionStrategy,
  GreedyToolSelection,
  EnsembleToolSelection,
  SmartAgent,
  ReActLoop,
  AgentOrchestrator,

  // Execution tracing
  ExecutionStep,
  ExecutionTrace,
  ExecutionTracer,
  TraceFormatter,
  TraceAnalyzer,

  // Flow visibility
  Variable,
  StateTracker,
  FlowAnalyzer,
  FlowVisualizer,
  FlowDebugger,
  FlowDashboard,
  FlowOptimizer,
};
