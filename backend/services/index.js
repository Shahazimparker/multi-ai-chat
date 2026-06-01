/**
 * Service Catalog — single file to understand the whole service graph.
 *
 * ┌──────────────────────────────────────────────────────────────────────┐
 * │                        chatPipeline.service                          │
 * │                                                                      │
 * │  compress → cache → rag → memory/context → orchestratorBrain        │
 * │                     └──────────── toolLoop ──────────────┘          │
 * │                                      │                               │
 * │                               tokenAccounting → persist → analytics  │
 * └──────────────────────────────────────┬───────────────────────────────┘
 *                                        │
 *              ┌─────────────────────────▼──────────────────────────┐
 *              │               orchestratorBrain.service             │
 *              │  wires: agent · chain · graphWorkflow · callbacks   │
 *              │          executionTracer · outputParser             │
 *              │          retriever · vectorStore · promptTemplate   │
 *              └─────────────────────────┬──────────────────────────┘
 *                                        │
 *              ┌─────────────────────────▼──────────────────────────┐
 *              │              ai/dispatcher.service                  │
 *              │  claude · openai · gemini · groq · mistral · cohere │
 *              │  deepseek · openrouter · together · anyapi          │
 *              └─────────────────────────────────────────────────────┘
 *
 *
 * ── PIPELINE ──────────────────────────────────────────────────────────
 *  chatPipeline     Main per-request flow (stream + message endpoints share this)
 *  compress         Strip filler words to save input tokens
 *  cache            SHA-256 keyed response cache via pgvector cosine (0.92 threshold)
 *  context          Build history window from DB using selected memory strategy
 *  analytics        Persist per-query metrics (model, tokens, latency, cache hit)
 *
 * ── ORCHESTRATION ─────────────────────────────────────────────────────
 *  orchestratorBrain    Runtime wiring of the AI framework; called by chatPipeline
 *  agentOrchestrator    SmartAgent — dynamic tool selection + multi-turn loop
 *  agent                ReAct-style single agent with tool execution
 *  chain                Primitives: SimpleChain / ConditionalChain / ParallelChain
 *  graphWorkflow        DAG-based workflow engine with cycle support
 *  loopManagement       Cycle counters and exit conditions for iterative workflows
 *  toolLoop             Token-budgeted tool execution loop with streaming
 *  toolProcessor        Dispatches individual tool calls to the right handler
 *
 * ── AI PROVIDERS ──────────────────────────────────────────────────────
 *  ai/dispatcher    Route by modelId to the correct provider client
 *  ai/*             Individual provider clients (see ai/index.js)
 *  modelCatalog     Fetch + cache live model lists for OpenRouter / Together / AnyAPI
 *
 * ── MEMORY & CONTEXT ──────────────────────────────────────────────────
 *  memory           6 strategies: Buffer · Summary · Entity · TokenBuffer · Window · KG
 *  summary          Internal summarisation (OpenRouter → Gemini → Mistral → Cerebras)
 *  similarity       TF-IDF topic-match to decide whether to extend or start new chat
 *
 * ── RAG & RETRIEVAL ───────────────────────────────────────────────────
 *  rag              Hybrid cosine + BM25 + Jaccard over pgvector; injects context
 *  retriever        Retriever interfaces: Vector · BM25 · Hybrid · Metadata · Chained
 *  vectorStore      pgvector / in-memory abstraction (add / search / delete / update)
 *  documentLoader   Parse 40+ file types (pdf, docx, xlsx, pptx, images via OCR…)
 *  textSplitter     4 chunk strategies: Recursive · Semantic · SlidingWindow · LineBased
 *  fileUpload       Upload → extract → chunk → embed → store; also direct LLM pass-through
 *
 * ── TOOLS ─────────────────────────────────────────────────────────────
 *  tools/webSearch    Fallback chain: Exa → Firecrawl → Tavily → SerpAPI → LangSearch
 *  tools/urlReader    URL validation, SSRF guard, GitHub detection, siteReaders dispatch
 *  tools/githubReader GitHub API + raw content reader
 *  tools/siteReaders  Extractors for GitLab · arXiv · docs sites · YouTube · Reddit…
 *  tools/codeExecute  Sandboxed JS execution (worker_thread, 2 s / 5 KB limits)
 *  tools/rerank       BM25 reranking via LangSearch API
 *
 * ── FILE GENERATION ───────────────────────────────────────────────────
 *  imageGeneration   FLUX / Recraft via OpenRouter or DALL-E 3
 *  pdfGeneration     PDFKit — sections + formatting
 *  pptGeneration     pptxgenjs — 12 themes, 15 layout types
 *  excelGeneration   ExcelJS — formatted headers, auto-fit columns
 *  wordGeneration    docx — sections + formatting
 *  csvGeneration     RFC-4180 compliant CSV with proper escaping
 *  chartGeneration   SVG charts (bar, pie, line) with custom colours
 *  htmlGeneration    HTML with configurable title / body / CSS
 *  jsonGeneration    Pretty-printed JSON files
 *  markdownGeneration  Safe-filename Markdown files
 *
 * ── TOKEN MANAGEMENT ──────────────────────────────────────────────────
 *  tokenBudget       Hybrid word/char budget; caps RAG / file / history growth
 *  tokenAccounting   Billable token calculation across all sources for quota enforcement
 *
 * ── OBSERVABILITY ─────────────────────────────────────────────────────
 *  callbacks         EventEmitter lifecycle hooks (logging, cost tracking, metrics)
 *  executionTracer   Hierarchical step tracing with perf timing (LRU, 100-trace cap)
 *  flowVisibility    Interactive flow visualisation + dependency analysis
 *  outputParser      Parse AI output as JSON / Markdown table / CSV / regex
 *  promptTemplate    Variable interpolation, few-shot examples, conditional blocks
 *  chatCleanup       Strip tool tags from responses; classify errors
 *
 * ── HUMAN-IN-THE-LOOP ─────────────────────────────────────────────────
 *  humanApproval     Persistent approval requests in Supabase with audit trail
 *  approvalManager   Shared singleton wrapping humanApproval (used by chatPipeline)
 */

const lazy = (path) => {
  let cache;
  return new Proxy({}, {
    get(_, key) { return (cache ??= require(path))[key]; }
  });
};

// ── PIPELINE ───────────────────────────────────────────────────────────
exports.chatPipeline   = lazy('./chatPipeline.service');
exports.compress       = lazy('./compress.service');
exports.cache          = lazy('./cache.service');
exports.context        = lazy('./context.service');
exports.analytics      = lazy('./analytics.service');

// ── ORCHESTRATION ──────────────────────────────────────────────────────
exports.orchestratorBrain  = lazy('./orchestratorBrain.service');
exports.agentOrchestrator  = lazy('./agentOrchestrator.service');
exports.agent              = lazy('./agent.service');
exports.chain              = lazy('./chain.service');
exports.graphWorkflow      = lazy('./graphWorkflow.service');
exports.loopManagement     = lazy('./loopManagement.service');
exports.toolLoop           = lazy('./toolLoop.service');
exports.toolProcessor      = lazy('./toolProcessor.service');

// ── AI PROVIDERS ───────────────────────────────────────────────────────
exports.ai           = lazy('./ai/index');        // full provider namespace
exports.dispatcher   = lazy('./ai/dispatcher.service'); // shorthand: most common import
exports.modelCatalog = lazy('./modelCatalog.service');

// ── MEMORY & CONTEXT ───────────────────────────────────────────────────
exports.memory     = lazy('./memory.service');
exports.summary    = lazy('./summary.service');
exports.similarity = lazy('./similarity.service');

// ── RAG & RETRIEVAL ────────────────────────────────────────────────────
exports.rag            = lazy('./rag.service');
exports.retriever      = lazy('./retriever.service');
exports.vectorStore    = lazy('./vectorStore.service');
exports.documentLoader = lazy('./documentLoader.service');
exports.textSplitter   = lazy('./textSplitter.service');
exports.fileUpload     = lazy('./fileUpload.service');

// ── TOOLS ──────────────────────────────────────────────────────────────
exports.tools = lazy('./tools/index'); // full tool namespace

// ── FILE GENERATION ────────────────────────────────────────────────────
exports.imageGeneration    = lazy('./imageGeneration.service');
exports.pdfGeneration      = lazy('./pdfGeneration.service');
exports.pptGeneration      = lazy('./pptGeneration.service');
exports.excelGeneration    = lazy('./excelGeneration.service');
exports.wordGeneration     = lazy('./wordGeneration.service');
exports.csvGeneration      = lazy('./csvGeneration.service');
exports.chartGeneration    = lazy('./chartGeneration.service');
exports.htmlGeneration     = lazy('./htmlGeneration.service');
exports.jsonGeneration     = lazy('./jsonGeneration.service');
exports.markdownGeneration = lazy('./markdownGeneration.service');

// ── TOKEN MANAGEMENT ───────────────────────────────────────────────────
exports.tokenBudget     = lazy('./tokenBudget.service');
exports.tokenAccounting = lazy('./tokenAccounting.service');

// ── OBSERVABILITY ──────────────────────────────────────────────────────
exports.callbacks       = lazy('./callbacks.service');
exports.executionTracer = lazy('./executionTracer.service');
exports.flowVisibility  = lazy('./flowVisibility.service');
exports.outputParser    = lazy('./outputParser.service');
exports.promptTemplate  = lazy('./promptTemplate.service');
exports.chatCleanup     = lazy('./chatCleanup.service');

// ── HUMAN-IN-THE-LOOP ──────────────────────────────────────────────────
exports.humanApproval   = lazy('./humanApproval.service');
exports.approvalManager = lazy('./approvalManager.shared');
