// ============================================================
// FILE: backend/services/callbacks.service.js
// PURPOSE: Lifecycle hooks for logging, cost tracking, debugging
//          - EventEmitter for all operations
//          - Built-in handlers (logger, cost, metrics)
//          - Custom handler support
//          - Integration with all services
// ============================================================

/**
 * CallbackContext — metadata passed to callbacks
 */
class CallbackContext {
  constructor(operationName, operationType) {
    this.operationName = operationName;
    this.operationType = operationType; // 'llm', 'tool', 'chain', 'agent', 'vector', 'parser'
    this.startTime = Date.now();
    this.endTime = null;
    this.duration = 0;
    this.tokensUsed = 0;
    this.cost = 0;
    this.status = 'pending'; // pending, success, error
    this.error = null;
    this.metadata = {};
    this.input = null;
    this.output = null;
    this.retries = 0;
    this.toolName = null;
    this.modelId = null;
  }

  end(output = null) {
    this.endTime = Date.now();
    this.duration = this.endTime - this.startTime;
    this.output = output;
    this.status = 'success';
  }

  fail(error) {
    this.endTime = Date.now();
    this.duration = this.endTime - this.startTime;
    this.error = error;
    this.status = 'error';
  }

  setCost(tokensUsed, costPerToken = 0) {
    this.tokensUsed = tokensUsed;
    this.cost = tokensUsed * costPerToken;
  }

  setMetadata(key, value) {
    this.metadata[key] = value;
  }

  toJSON() {
    return {
      operationName: this.operationName,
      operationType: this.operationType,
      duration: this.duration,
      tokensUsed: this.tokensUsed,
      cost: this.cost,
      status: this.status,
      error: this.error ? this.error.message : null,
      retries: this.retries,
      metadata: this.metadata,
      timestamp: new Date(this.startTime).toISOString(),
    };
  }
}

/**
 * EventEmitter — pub/sub for callbacks
 */
class EventEmitter {
  constructor() {
    this.listeners = new Map();
  }

  on(event, callback) {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, []);
    }
    this.listeners.get(event).push(callback);
    return this; // for chaining
  }

  off(event, callback) {
    if (this.listeners.has(event)) {
      const callbacks = this.listeners.get(event);
      const idx = callbacks.indexOf(callback);
      if (idx !== -1) callbacks.splice(idx, 1);
    }
    return this;
  }

  async emit(event, data) {
    if (!this.listeners.has(event)) return;

    const callbacks = this.listeners.get(event);
    for (const callback of callbacks) {
      try {
        await callback(data);
      } catch (err) {
        console.error(`[Callbacks] Error in ${event} handler:`, err.message);
      }
    }
  }

  once(event, callback) {
    const wrapper = async (data) => {
      await callback(data);
      this.off(event, wrapper);
    };
    this.on(event, wrapper);
    return this;
  }
}

/**
 * CallbackManager — manages all callbacks and event emission
 */
class CallbackManager {
  constructor(options = {}) {
    this.emitter = new EventEmitter();
    this.handlers = [];
    this.enabledEvents = new Set([
      'operation:start',
      'operation:end',
      'operation:error',
      'operation:retry',
      'cost:tracked',
      'metrics:collected',
      'tool:executed',
      'llm:called',
      'agent:step',
      'approval:requested',
      'approval:granted',
      'approval:rejected',
    ]);
    this.verbose = options.verbose || false;
  }

  /**
   * Register handler for event
   */
  on(event, handler) {
    this.emitter.on(event, handler);
    return this;
  }

  /**
   * Emit event
   */
  async emit(event, data) {
    if (this.enabledEvents.has(event)) {
      await this.emitter.emit(event, data);
    }
  }

  /**
   * Create callback context for operation
   */
  createContext(operationName, operationType) {
    return new CallbackContext(operationName, operationType);
  }

  /**
   * Notify operation start
   */
  async onOperationStart(context) {
    if (this.verbose) {
      console.log(`[Operation] Starting: ${context.operationName}`);
    }
    await this.emit('operation:start', context);
  }

  /**
   * Notify operation end
   */
  async onOperationEnd(context, output) {
    context.end(output);
    if (this.verbose) {
      console.log(
        `[Operation] Completed: ${context.operationName} (${context.duration}ms)`
      );
    }
    await this.emit('operation:end', context);
  }

  /**
   * Notify operation error
   */
  async onOperationError(context, error) {
    context.fail(error);
    if (this.verbose) {
      console.error(`[Operation] Failed: ${context.operationName} - ${error.message}`);
    }
    await this.emit('operation:error', context);
  }

  /**
   * Notify retry attempt
   */
  async onRetry(context, attemptNum) {
    context.retries = attemptNum;
    if (this.verbose) {
      console.log(
        `[Operation] Retry attempt ${attemptNum} for ${context.operationName}`
      );
    }
    await this.emit('operation:retry', context);
  }

  /**
   * Notify cost tracked
   */
  async onCostTracked(context, tokensUsed, costPerToken = 0) {
    context.setCost(tokensUsed, costPerToken);
    if (this.verbose) {
      console.log(
        `[Cost] ${context.operationName}: ${tokensUsed} tokens (${context.cost.toFixed(4)})`
      );
    }
    await this.emit('cost:tracked', context);
  }

  /**
   * Notify metrics collected
   */
  async onMetricsCollected(context, metrics) {
    context.setMetadata('metrics', metrics);
    if (this.verbose) {
      console.log(`[Metrics] ${context.operationName}:`, metrics);
    }
    await this.emit('metrics:collected', context);
  }

  /**
   * Notify tool execution
   */
  async onToolExecuted(context, toolName, args, result) {
    context.toolName = toolName;
    context.setMetadata('args', args);
    context.setMetadata('result', result);
    if (this.verbose) {
      console.log(`[Tool] Executed: ${toolName}`);
    }
    await this.emit('tool:executed', context);
  }

  /**
   * Notify LLM call
   */
  async onLLMCalled(context, modelId, inputTokens, outputTokens) {
    context.modelId = modelId;
    context.tokensUsed = inputTokens + outputTokens;
    context.setMetadata('inputTokens', inputTokens);
    context.setMetadata('outputTokens', outputTokens);
    if (this.verbose) {
      console.log(
        `[LLM] Called ${modelId}: ${inputTokens} input + ${outputTokens} output tokens`
      );
    }
    await this.emit('llm:called', context);
  }

  /**
   * Notify agent step
   */
  async onAgentStep(context, stepNum, thought, toolName, observation) {
    context.setMetadata('step', stepNum);
    context.setMetadata('thought', thought);
    context.setMetadata('tool', toolName);
    context.setMetadata('observation', observation);
    if (this.verbose) {
      console.log(`[Agent] Step ${stepNum}: ${thought}`);
    }
    await this.emit('agent:step', context);
  }
}

/**
 * Built-in handlers
 */

/**
 * Logger handler — logs all operations
 */
const LoggerHandler = (callbackManager) => {
  const logs = [];

  callbackManager.on('operation:start', (ctx) => {
    logs.push(`[${ctx.operationType}] START ${ctx.operationName}`);
  });

  callbackManager.on('operation:end', (ctx) => {
    logs.push(
      `[${ctx.operationType}] END ${ctx.operationName} in ${ctx.duration}ms`
    );
  });

  callbackManager.on('operation:error', (ctx) => {
    logs.push(`[${ctx.operationType}] ERROR ${ctx.operationName}: ${ctx.error.message}`);
  });

  return {
    getLogs: () => logs,
    clearLogs: () => (logs.length = 0),
    printLogs: () => console.log(logs.join('\n')),
  };
};

/**
 * Cost tracker handler — tracks total costs
 */
const CostTrackerHandler = (callbackManager) => {
  const costs = {
    total: 0,
    byType: {},
    byModel: {},
    transactions: [],
  };

  callbackManager.on('cost:tracked', (ctx) => {
    costs.total += ctx.cost;

    if (!costs.byType[ctx.operationType]) {
      costs.byType[ctx.operationType] = 0;
    }
    costs.byType[ctx.operationType] += ctx.cost;

    if (ctx.modelId) {
      if (!costs.byModel[ctx.modelId]) {
        costs.byModel[ctx.modelId] = 0;
      }
      costs.byModel[ctx.modelId] += ctx.cost;
    }

    costs.transactions.push({
      operation: ctx.operationName,
      type: ctx.operationType,
      model: ctx.modelId,
      tokens: ctx.tokensUsed,
      cost: ctx.cost,
      timestamp: new Date().toISOString(),
    });
  });

  return {
    getCosts: () => costs,
    getTotalCost: () => costs.total,
    getCostByType: () => costs.byType,
    getCostByModel: () => costs.byModel,
    resetCosts: () => {
      costs.total = 0;
      costs.byType = {};
      costs.byModel = {};
      costs.transactions = [];
    },
  };
};

/**
 * Metrics collector handler — collects performance metrics
 */
const MetricsCollectorHandler = (callbackManager) => {
  const metrics = {
    operationCount: 0,
    successCount: 0,
    errorCount: 0,
    totalDuration: 0,
    avgDuration: 0,
    byType: {},
    errors: [],
  };

  callbackManager.on('operation:start', () => {
    metrics.operationCount++;
  });

  callbackManager.on('operation:end', (ctx) => {
    metrics.successCount++;
    metrics.totalDuration += ctx.duration;
    metrics.avgDuration = metrics.totalDuration / metrics.operationCount;

    if (!metrics.byType[ctx.operationType]) {
      metrics.byType[ctx.operationType] = {
        count: 0,
        duration: 0,
        avgDuration: 0,
      };
    }

    const typeMetrics = metrics.byType[ctx.operationType];
    typeMetrics.count++;
    typeMetrics.duration += ctx.duration;
    typeMetrics.avgDuration = typeMetrics.duration / typeMetrics.count;
  });

  callbackManager.on('operation:error', (ctx) => {
    metrics.errorCount++;
    metrics.errors.push({
      operation: ctx.operationName,
      error: ctx.error.message,
      timestamp: new Date().toISOString(),
    });
  });

  return {
    getMetrics: () => metrics,
    getStats: () => ({
      totalOperations: metrics.operationCount,
      successRate: metrics.operationCount > 0
        ? (metrics.successCount / metrics.operationCount * 100).toFixed(2) + '%'
        : '0.00%',
      avgDuration: metrics.operationCount > 0
        ? metrics.avgDuration.toFixed(2) + 'ms'
        : '0.00ms',
      totalDuration: metrics.totalDuration + 'ms',
      errors: metrics.errorCount,
    }),
    resetMetrics: () => {
      metrics.operationCount = 0;
      metrics.successCount = 0;
      metrics.errorCount = 0;
      metrics.totalDuration = 0;
      metrics.avgDuration = 0;
      metrics.byType = {};
      metrics.errors = [];
    },
  };
};

/**
 * Error tracker handler — tracks detailed errors
 */
const ErrorTrackerHandler = (callbackManager) => {
  const errors = [];

  callbackManager.on('operation:error', (ctx) => {
    errors.push({
      operation: ctx.operationName,
      type: ctx.operationType,
      error: ctx.error.message,
      stack: ctx.error.stack,
      retries: ctx.retries,
      timestamp: new Date().toISOString(),
    });
  });

  return {
    getErrors: () => errors,
    getErrorCount: () => errors.length,
    clearErrors: () => (errors.length = 0),
    getErrorSummary: () => {
      const summary = {};
      errors.forEach((err) => {
        if (!summary[err.error]) {
          summary[err.error] = 0;
        }
        summary[err.error]++;
      });
      return summary;
    },
  };
};

/**
 * ApprovalHandler — logs approval lifecycle events via the callback system
 */
const ApprovalHandler = (callbackManager) => {
  const log = (event, data) => {
    if (callbackManager?.verbose) {
      console.log(`[ApprovalHandler] ${event}`, JSON.stringify(data));
    }
  };

  callbackManager.on('approval:requested', (data) => {
    log('approval:requested', { id: data?.id, title: data?.title });
  });

  callbackManager.on('approval:granted', (data) => {
    log('approval:granted', { id: data?.id, approver: data?.approver });
  });

  callbackManager.on('approval:rejected', (data) => {
    log('approval:rejected', { id: data?.id, reason: data?.reason });
  });

  return { name: 'ApprovalHandler' };
};

/**
 * Factory function
 */
const createCallbackManager = (options = {}) => {
  return new CallbackManager(options);
};

/**
 * Global callback manager (singleton) — Logger and CostTracker registered by default
 */
let globalCallbackManager = null;

const getGlobalCallbackManager = () => {
  if (!globalCallbackManager) {
    globalCallbackManager = createCallbackManager({ verbose: false });
    // Register default handlers so events are useful out-of-the-box
    LoggerHandler(globalCallbackManager);
    CostTrackerHandler(globalCallbackManager);
    MetricsCollectorHandler(globalCallbackManager);
  }
  return globalCallbackManager;
};

module.exports = {
  CallbackContext,
  EventEmitter,
  CallbackManager,
  createCallbackManager,
  getGlobalCallbackManager,
  handlers: {
    LoggerHandler,
    CostTrackerHandler,
    MetricsCollectorHandler,
    ErrorTrackerHandler,
    ApprovalHandler,
  },
};
