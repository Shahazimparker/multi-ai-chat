// ============================================================
// FILE: backend/services/orchestratorBrain.service.js
// PURPOSE: Runtime wiring layer for the custom AI framework.
//          Used by /stream via chatPipeline.service.js.
// ============================================================

const { AgentOrchestrator, GreedyToolSelection, SmartAgent } = require('./agentOrchestrator.service');
const { createTool, ToolRegistry } = require('./agent.service');
const { createCallbackManager, handlers } = require('./callbacks.service');
const { createChain } = require('./chain.service');
const { ExecutionTracer, TraceAnalyzer } = require('./executionTracer.service');
const { FlowDashboard, FlowOptimizer, StateTracker } = require('./flowVisibility.service');
const { GraphBuilder } = require('./graphWorkflow.service');
const { createParser } = require('./outputParser.service');
const { getGlobalRegistry } = require('./promptTemplate.service');
const { createRetriever } = require('./retriever.service');
const { createVectorStore } = require('./vectorStore.service');
const { dispatchToAI } = require('./ai/dispatcher.service');
const { MODELS } = require('../config/models');

const hashTextToVector = (text, dims = 32) => {
  const vector = new Array(dims).fill(0);
  const input = String(text || '').toLowerCase();
  for (let i = 0; i < input.length; i++) {
    vector[i % dims] += input.charCodeAt(i) / 255;
  }
  return vector;
};

const makeDispatcher = (effectiveModelConfig, abortController) => ({
  async dispatch({ messages }) {
    if (abortController?.signal?.aborted) throw { name: 'AbortError' };
    const dispatchResult = await dispatchToAI(effectiveModelConfig, messages || [], abortController?.signal || null);
    return {
      text: dispatchResult?.text || '',
      content: dispatchResult?.text || '',
      usage: {
        input_tokens: 0,
        output_tokens: dispatchResult?.tokensUsed || 0,
      },
      model: effectiveModelConfig?.model,
    };
  },
});

const parseFirstJsonObject = (text) => {
  const raw = String(text || '');
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start < 0 || end < start) return null;
  try {
    return JSON.parse(raw.slice(start, end + 1));
  } catch {
    return null;
  }
};

const runRoutingDecision = async (input, abortController) => {
  const flash = MODELS['deepseek-v4-flash'];
  const pro = MODELS['deepseek-v4-pro'];
  if (!flash?.apiKey || !pro?.apiKey) return null;

  const buildMessages = (query, previousDecision = null) => ([
    {
      role: 'system',
      content: [
        'You are a routing orchestrator for a multi-tool chatbot.',
        'Return ONLY valid JSON with fields:',
        '{"intent":"chat|artifact_ppt|artifact_other|rag_data|code_or_db","confidence":0-1,"needsRag":boolean,"needsTools":boolean,"recommendedModelId":"string","reason":"string"}',
        'Rules:',
        '- If query asks for ppt/powerpoint/slides => intent artifact_ppt and needsTools=true',
        '- Prefer deepseek-v4-pro for complex multi-step or low confidence cases',
        '- Prefer deepseek-v4-flash for simple chat and high confidence',
        previousDecision ? `Previous decision: ${JSON.stringify(previousDecision)}` : '',
      ].filter(Boolean).join('\n'),
    },
    { role: 'user', content: String(query || '') },
  ]);

  const call = async (modelCfg, messages) => {
    const result = await dispatchToAI(modelCfg, messages, abortController?.signal || null);
    return parseFirstJsonObject(result?.text || '');
  };

  const flashDecision = await call(flash, buildMessages(input?.message));
  if (!flashDecision) return null;

  const lowConfidence = Number(flashDecision.confidence || 0) < 0.72;
  if (!lowConfidence) {
    return {
      ...flashDecision,
      stage: 'flash',
      recommendedModelId: flashDecision.recommendedModelId || 'deepseek-v4-flash',
    };
  }

  const proDecision = await call(pro, buildMessages(input?.message, flashDecision));
  if (!proDecision) {
    return {
      ...flashDecision,
      stage: 'flash_fallback',
      recommendedModelId: flashDecision.recommendedModelId || 'deepseek-v4-flash',
    };
  }
  return {
    ...proDecision,
    stage: 'pro_refined',
    recommendedModelId: proDecision.recommendedModelId || 'deepseek-v4-pro',
  };
};

const createFrameworkRuntime = (options = {}) => {
  const { effectiveModelConfig, abortController, onToolStatus } = options;
  const callbackManager = createCallbackManager({ verbose: false });
  const logger = handlers.LoggerHandler(callbackManager);
  const costTracker = handlers.CostTrackerHandler(callbackManager);
  const metricsCollector = handlers.MetricsCollectorHandler(callbackManager);
  const errorTracker = handlers.ErrorTrackerHandler(callbackManager);

  const tracer = new ExecutionTracer({ maxTraces: 25, maxStepsPerTrace: 200 });
  const stateTracker = new StateTracker();
  const templateRegistry = getGlobalRegistry();
  const parser = createParser('regex', {
    patterns: {
      toolTags: /\[(WEB_SEARCH|EXECUTE_CODE|GENERATE_IMAGE|GENERATE_PPT|QUERY_DB)\b/gi,
      codeBlocks: /```[\s\S]*?```/g,
    },
  });

  const vectorStore = createVectorStore('memory', { maxSize: 100 });
  const vectorRetriever = createRetriever('vector', {
    vectorStore,
    embeddingFn: async (text) => hashTextToVector(text),
  });
  const bm25Retriever = createRetriever('bm25', { documents: [] });
  const hybridRetriever = createRetriever('hybrid', {
    vectorRetriever,
    bm25Retriever,
    vectorWeight: 0.6,
    bm25Weight: 0.4,
  });

  const toolRegistry = new ToolRegistry();
  toolRegistry
    .register(createTool('classify_intent', 'Classify chat intent for routing', async ({ message }) => ({
      intent: /\b(file|document|upload|pdf|ppt|image|chart)\b/i.test(message || '') ? 'artifact_or_rag' : 'chat',
      needsTools: /\[(WEB_SEARCH|EXECUTE_CODE|GENERATE_IMAGE|GENERATE_PPT|QUERY_DB)\b/i.test(message || ''),
    }), { message: 'string' }))
    .register(createTool('select_runtime_path', 'Select runtime path for chat pipeline', async ({ intent, ragEnabled }) => ({
      path: ragEnabled || intent === 'artifact_or_rag' ? 'retrieval_augmented_stream' : 'direct_stream',
    }), { intent: 'string', ragEnabled: 'boolean' }));

  const smartAgent = new SmartAgent(makeDispatcher(effectiveModelConfig, abortController), toolRegistry, {
    modelId: effectiveModelConfig?.model,
    maxIterations: 1,
    maxRefinements: 0,
    toolSelectionStrategy: new GreedyToolSelection(),
    callbackManager,
    tracer,
  });
  const orchestrator = new AgentOrchestrator({ sharedState: {} });
  orchestrator.registerAgent('stream-planner', smartAgent);

  const setupChain = createChain('simple', { name: 'stream-runtime-setup' });
  setupChain
    .add('track-input', async (input) => {
      stateTracker.setVariable('modelId', input.modelId, 'track-input');
      stateTracker.setVariable('ragEnabled', input.ragEnabled, 'track-input');
      return input;
    })
    .add('parse-message-shape', async (input) => {
      const parsed = await parser.parse(input.message || '');
      return { ...input, parsedShape: parsed.success ? parsed.data : {} };
    })
    .add('index-runtime-doc', async (input) => {
      const content = `${input.message || ''}\nmodel=${input.modelId}\nrag=${input.ragEnabled}`;
      await vectorStore.add([{
        id: `runtime-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        content,
        embedding: hashTextToVector(content),
        metadata: { modelId: input.modelId, topicId: input.topicId || null },
      }]);
      return input;
    });

  const graph = new GraphBuilder()
    .node('prepare', async (input) => {
      const result = await setupChain.run(input, { tracer, stateTracker });
      return result.success ? result.data : input;
    }, 'Prepare framework runtime state')
    .node('plan', async (input) => {
      const agentResult = await orchestrator.executeAgent('stream-planner', input.message, {
        ragEnabled: input.ragEnabled,
      });
      stateTracker.setVariable('agentIterations', agentResult.totalIterations || 0, 'plan');
      return { ...input, agentPlan: agentResult };
    }, 'Plan chat execution with SmartAgent')
    .node('retrieve', async (input) => {
      const retrieval = await hybridRetriever.retrieve(input.message || '', { topK: 3 });
      stateTracker.setVariable('runtimeRetrievalHits', retrieval.length, 'retrieve');
      return { ...input, runtimeRetrieval: retrieval };
    }, 'Retrieve runtime context')
    .node('finish', async (input) => input, 'Return to chat pipeline')
    .edge('prepare', 'plan')
    .edge('plan', 'retrieve')
    .edge('retrieve', 'finish')
    .startNode('prepare')
    .endNode('finish')
    .build();

  return {
    callbackManager,
    logger,
    costTracker,
    metricsCollector,
    errorTracker,
    tracer,
    stateTracker,
    templateRegistry,
    parser,
    vectorStore,
    hybridRetriever,
    toolRegistry,
    orchestrator,
    graph,
    onToolStatus,
  };
};

const runOrchestratorBrain = async (input, options = {}) => {
  const runtime = createFrameworkRuntime(options);
  const trace = runtime.tracer.startTrace('chat-stream-orchestrator-brain', {
    type: 'workflow',
    metadata: {
      modelId: input.modelId,
      provider: options.effectiveModelConfig?.provider,
      topicId: input.topicId || null,
      route: '/stream',
    },
  });

  try {
    const routingDecision = await runRoutingDecision(input, options?.abortController).catch(() => null);

    await runtime.callbackManager.onOperationStart(
      runtime.callbackManager.createContext('orchestrator-brain', 'workflow')
    );

    runtime.onToolStatus?.({
      type: 'framework_status',
      framework: 'orchestrator_brain',
      status: 'started',
      message: 'OrchestratorBrain planning stream runtime',
    });

    const template = runtime.templateRegistry.get('agent_reason');
    const formattedTemplate = template ? await template.format({
      goal: input.message || '',
      tools: runtime.toolRegistry.getToolDescription(),
      memory: `topic=${input.topicId || 'new'} model=${input.modelId}`,
    }) : [];

    const graphResult = await runtime.tracer.traceAsync('Framework graph workflow', () => runtime.graph.run({
      ...input,
      formattedTemplate,
    }, { maxIterations: 10 }), { type: 'workflow' });

    const completedTrace = runtime.tracer.completeTrace(graphResult.success);
    const dashboard = FlowDashboard.getSummary(completedTrace, runtime.stateTracker);
    const suggestions = FlowOptimizer.generateSuggestions(completedTrace, runtime.stateTracker);
    const traceReport = TraceAnalyzer.generateReport(completedTrace);

    runtime.onToolStatus?.({
      type: 'framework_status',
      framework: 'orchestrator_brain',
      status: 'ready',
      message: 'OrchestratorBrain runtime ready',
      traceId: trace.id,
      steps: completedTrace.steps.length,
    });

    return {
      enabled: true,
      traceId: trace.id,
      routingDecision,
      graph: graphResult,
      dashboard,
      suggestions,
      traceReport,
      metrics: runtime.metricsCollector.getStats(),
      costs: runtime.costTracker.getCosts(),
      errors: runtime.errorTracker.getErrors(),
      logs: runtime.logger.getLogs(),
    };
  } catch (err) {
    const completedTrace = runtime.tracer.completeTrace(false, err) || trace;
    runtime.onToolStatus?.({
      type: 'framework_status',
      framework: 'orchestrator_brain',
      status: 'degraded',
      message: err.message,
      traceId: completedTrace.id,
    });
    return {
      enabled: true,
      traceId: completedTrace.id,
      error: err.message,
      routingDecision: null,
      dashboard: FlowDashboard.getSummary(completedTrace, runtime.stateTracker),
    };
  }
};

module.exports = { createFrameworkRuntime, runOrchestratorBrain };
