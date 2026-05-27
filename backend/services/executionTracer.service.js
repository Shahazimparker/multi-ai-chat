// ============================================================
// FILE: backend/services/executionTracer.service.js
// PURPOSE: Execution tracing and visibility
//          - Step-by-step trace recording
//          - Hierarchical nested operations
//          - Performance and cost tracking
//          - Full context capture
//          - Multiple export formats
//          - Trace analysis and visualization
// ============================================================

/**
 * ExecutionStep — single operation in a trace
 */
class ExecutionStep {
  constructor(name, options = {}) {
    this.id = options.id || `step-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
    this.name = name;
    this.type = options.type || 'operation'; // operation, tool, chain, agent, llm, approval
    this.status = 'pending'; // pending, running, success, error, skipped
    this.startTime = null;
    this.endTime = null;
    this.duration = 0;
    this.parentId = options.parentId || null;
    this.children = [];
    this.input = options.input || null;
    this.output = options.output || null;
    this.error = null;
    this.metadata = options.metadata || {};
    this.context = options.context || {};
    this.tokensUsed = 0;
    this.cost = 0;
  }

  start() {
    this.status = 'running';
    this.startTime = Date.now();
    return this;
  }

  succeed(output, metadata = {}) {
    this.status = 'success';
    this.output = output;
    this.endTime = Date.now();
    this.duration = this.endTime - this.startTime;
    this.metadata = { ...this.metadata, ...metadata };
    return this;
  }

  fail(error, metadata = {}) {
    this.status = 'error';
    this.error = {
      message: error.message || String(error),
      stack: error.stack || '',
      type: error.constructor.name,
    };
    this.endTime = Date.now();
    this.duration = this.endTime - this.startTime;
    this.metadata = { ...this.metadata, ...metadata };
    return this;
  }

  skip(reason = '') {
    this.status = 'skipped';
    this.metadata.skipReason = reason;
    this.endTime = Date.now();
    this.duration = 0;
    return this;
  }

  setCost(tokensUsed, costPerToken = 0) {
    this.tokensUsed = tokensUsed;
    this.cost = tokensUsed * costPerToken;
    return this;
  }

  addChild(step) {
    step.parentId = this.id;
    this.children.push(step);
    return this;
  }

  toJSON() {
    return {
      id: this.id,
      name: this.name,
      type: this.type,
      status: this.status,
      duration: this.duration,
      startTime: new Date(this.startTime).toISOString(),
      endTime: this.endTime ? new Date(this.endTime).toISOString() : null,
      input: this._sanitize(this.input),
      output: this._sanitize(this.output),
      error: this.error,
      tokensUsed: this.tokensUsed,
      cost: this.cost,
      metadata: this.metadata,
      children: this.children.length,
    };
  }

  _sanitize(data) {
    if (typeof data === 'string') {
      return data.slice(0, 200);
    }
    if (typeof data === 'object') {
      return JSON.stringify(data).slice(0, 200);
    }
    return data;
  }
}

/**
 * ExecutionTrace — complete trace of an execution
 */
class ExecutionTrace {
  constructor(name, options = {}) {
    this.id = options.id || `trace-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
    this.name = name;
    this.type = options.type || 'execution'; // execution, agent, chain, workflow
    this.startTime = Date.now();
    this.endTime = null;
    this.duration = 0;
    this.status = 'running'; // running, success, error, partial
    this.steps = [];
    this.stepMap = new Map(); // id → step for quick lookup
    this.rootSteps = []; // top-level steps
    this.currentStep = null;
    this.metadata = options.metadata || {};
    this.totalTokens = 0;
    this.totalCost = 0;
    this.errorCount = 0;
    this.successCount = 0;
  }

  /**
   * Create and push a new step
   */
  createStep(name, options = {}) {
    const step = new ExecutionStep(name, {
      ...options,
      parentId: this.currentStep?.id || null,
    });

    this.steps.push(step);
    this.stepMap.set(step.id, step);

    if (this.currentStep) {
      this.currentStep.addChild(step);
    } else {
      this.rootSteps.push(step);
    }

    return step;
  }

  /**
   * Push existing step
   */
  pushStep(step) {
    if (this.currentStep) {
      step.parentId = this.currentStep.id;
      this.currentStep.addChild(step);
    } else {
      this.rootSteps.push(step);
    }

    this.steps.push(step);
    this.stepMap.set(step.id, step);
    return step;
  }

  /**
   * Enter a step (make it current)
   */
  enterStep(step) {
    this.currentStep = step;
    step.start();
    return step;
  }

  /**
   * Exit current step
   */
  exitStep(success = true, output = null, error = null) {
    if (!this.currentStep) return;

    if (success) {
      this.currentStep.succeed(output);
      this.successCount++;
    } else {
      this.currentStep.fail(error);
      this.errorCount++;
    }

    // Update totals
    this.totalTokens += this.currentStep.tokensUsed;
    this.totalCost += this.currentStep.cost;

    // Move to parent
    this.currentStep = this.currentStep.parentId
      ? this.stepMap.get(this.currentStep.parentId)
      : null;

    return this.currentStep;
  }

  /**
   * Complete the trace
   */
  complete(success = true, error = null) {
    this.endTime = Date.now();
    this.duration = this.endTime - this.startTime;

    if (success) {
      this.status = this.errorCount === 0 ? 'success' : 'partial';
    } else {
      this.status = 'error';
    }

    return this;
  }

  /**
   * Get step by ID
   */
  getStep(stepId) {
    return this.stepMap.get(stepId);
  }

  /**
   * Get all steps of a type
   */
  getStepsByType(type) {
    return this.steps.filter((s) => s.type === type);
  }

  /**
   * Get failed steps
   */
  getFailedSteps() {
    return this.steps.filter((s) => s.status === 'error');
  }

  /**
   * Get total duration
   */
  getTotalDuration() {
    return this.duration;
  }

  /**
   * Get critical path duration
   */
  getCriticalPathDuration() {
    if (this.rootSteps.length === 0) return this.duration;

    let maxDuration = 0;
    const walkStep = (step) => {
      maxDuration = Math.max(maxDuration, step.duration);
      for (const child of step.children) {
        walkStep(child);
      }
    };

    for (const step of this.rootSteps) {
      walkStep(step);
    }

    return maxDuration;
  }

  /**
   * Export to JSON
   */
  toJSON() {
    return {
      id: this.id,
      name: this.name,
      type: this.type,
      status: this.status,
      duration: this.duration,
      startTime: new Date(this.startTime).toISOString(),
      endTime: this.endTime ? new Date(this.endTime).toISOString() : null,
      totalSteps: this.steps.length,
      successCount: this.successCount,
      errorCount: this.errorCount,
      totalTokens: this.totalTokens,
      totalCost: this.totalCost,
      steps: this.steps.map((s) => s.toJSON()),
    };
  }
}

/**
 * ExecutionTracer — records execution traces
 */
class ExecutionTracer {
  constructor(options = {}) {
    this.traces = new Map(); // id → trace
    this.currentTrace = null;
    this.verbose = options.verbose || false;
    this.captureState = options.captureState !== false;
    this.captureContext = options.captureContext !== false;
    this.maxStepsPerTrace = options.maxStepsPerTrace || 1000;
    this.maxTraces = options.maxTraces || 100;         // LRU cap
    this.traceTtlMs = options.traceTtlMs || 3600000;  // 1 hour TTL
  }

  _log(message) {
    if (this.verbose) {
      console.log(`[ExecutionTracer] ${message}`);
    }
  }

  /**
   * Evict oldest completed traces when cap is reached or TTL expired
   */
  _evictStaleTraces() {
    const now = Date.now();
    for (const [id, trace] of this.traces) {
      // Remove traces past TTL that are no longer running
      if (trace.status !== 'running' && trace.endTime && (now - trace.endTime) > this.traceTtlMs) {
        this.traces.delete(id);
      }
    }

    // If still over cap, remove oldest completed traces (FIFO)
    if (this.traces.size >= this.maxTraces) {
      const sorted = [...this.traces.entries()]
        .filter(([, t]) => t.status !== 'running')
        .sort(([, a], [, b]) => (a.startTime || 0) - (b.startTime || 0));

      const toRemove = sorted.slice(0, this.traces.size - this.maxTraces + 1);
      for (const [id] of toRemove) {
        this.traces.delete(id);
      }
    }
  }

  /**
   * Start a new trace
   */
  startTrace(name, options = {}) {
    this._evictStaleTraces();

    const trace = new ExecutionTrace(name, options);
    this.traces.set(trace.id, trace);
    this.currentTrace = trace;

    this._log(`Started trace: ${name} (total stored: ${this.traces.size})`);

    return trace;
  }

  /**
   * Get current trace
   */
  getCurrentTrace() {
    return this.currentTrace;
  }

  /**
   * Get trace by ID
   */
  getTrace(traceId) {
    return this.traces.get(traceId);
  }

  /**
   * Complete current trace
   */
  completeTrace(success = true, error = null) {
    if (!this.currentTrace) return null;

    const trace = this.currentTrace;
    trace.complete(success, error);

    this._log(`Completed trace: ${trace.name} (${trace.status})`);

    this.currentTrace = null;
    return trace;
  }

  /**
   * Manually purge all completed traces older than ttlMs
   */
  purge(ttlMs = this.traceTtlMs) {
    const before = this.traces.size;
    const now = Date.now();
    for (const [id, trace] of this.traces) {
      if (trace.status !== 'running' && trace.endTime && (now - trace.endTime) > ttlMs) {
        this.traces.delete(id);
      }
    }
    this._log(`Purged ${before - this.traces.size} stale traces`);
  }

  /**
   * Return stored trace count
   */
  getTraceCount() {
    return this.traces.size;
  }

  /**
   * Create a step in current trace
   */
  createStep(name, options = {}) {
    if (!this.currentTrace) {
      this._log(`No active trace for step: ${name}`);
      return null;
    }

    if (this.currentTrace.steps.length >= this.maxStepsPerTrace) {
      this._log(`Max steps reached for trace`);
      return null;
    }

    return this.currentTrace.createStep(name, options);
  }

  /**
   * Wrap a function with tracing
   */
  async traceAsync(name, fn, options = {}) {
    const step = this.createStep(name, options);
    if (!step) return await fn();

    this.currentTrace.enterStep(step);

    try {
      const result = await fn();
      step.succeed(result);
      this.currentTrace.exitStep(true, result);
      return result;
    } catch (err) {
      step.fail(err);
      this.currentTrace.exitStep(false, null, err);
      throw err;
    }
  }

  /**
   * Wrap a synchronous function with tracing
   */
  traceSync(name, fn, options = {}) {
    const step = this.createStep(name, options);
    if (!step) return fn();

    this.currentTrace.enterStep(step);

    try {
      const result = fn();
      step.succeed(result);
      this.currentTrace.exitStep(true, result);
      return result;
    } catch (err) {
      step.fail(err);
      this.currentTrace.exitStep(false, null, err);
      throw err;
    }
  }

  /**
   * Record a tool execution
   */
  recordToolExecution(toolName, args, result, duration, cost = 0) {
    const step = this.createStep(`Tool: ${toolName}`, {
      type: 'tool',
      input: args,
      context: { toolName },
    });

    if (!step) return;

    step.start();
    step.succeed(result);
    step.duration = duration;
    step.cost = cost;

    this.currentTrace?.pushStep(step);
  }

  /**
   * Record an LLM call
   */
  recordLLMCall(modelId, tokens, cost, latency) {
    const step = this.createStep(`LLM: ${modelId}`, {
      type: 'llm',
      context: { modelId },
    });

    if (!step) return;

    step.start();
    step.succeed(null);
    step.duration = latency;
    step.tokensUsed = tokens;
    step.cost = cost;

    this.currentTrace?.pushStep(step);
  }

  /**
   * Record an approval
   */
  recordApproval(title, approved, duration) {
    const step = this.createStep(`Approval: ${title}`, {
      type: 'approval',
      context: { approved },
    });

    if (!step) return;

    step.start();
    step.succeed({ approved });
    step.duration = duration;

    this.currentTrace?.pushStep(step);
  }
}

/**
 * TraceFormatter — formats traces for different outputs
 */
class TraceFormatter {
  /**
   * Format trace as timeline
   */
  static formatTimeline(trace) {
    const timeline = [];
    const baseTime = trace.startTime;

    const walkStep = (step, indent = 0) => {
      const relativeTime = step.startTime - baseTime;
      timeline.push({
        time: relativeTime,
        name: step.name,
        type: step.type,
        status: step.status,
        duration: step.duration,
        indent,
      });

      for (const child of step.children) {
        walkStep(child, indent + 1);
      }
    };

    for (const step of trace.rootSteps) {
      walkStep(step);
    }

    return timeline;
  }

  /**
   * Format trace as Mermaid timeline
   */
  static formatMermaidTimeline(trace) {
    let mermaid = 'timeline\n';
    mermaid += `    title ${trace.name}\n`;

    const timeline = this.formatTimeline(trace);
    for (const entry of timeline) {
      const indent = '    '.repeat(entry.indent + 1);
      const durationMs = Math.round(entry.duration);
      mermaid += `${indent}${entry.time}ms : ${entry.name} (${durationMs}ms, ${entry.status})\n`;
    }

    return mermaid;
  }

  /**
   * Format trace as Mermaid flowchart
   */
  static formatMermaidFlowchart(trace) {
    let mermaid = 'flowchart TD\n';

    const walkStep = (step, parentId = null) => {
      const nodeId = `step_${step.id.split('-')[1]}`;
      const label = `${step.name}<br/>(${step.duration}ms)`;
      const color = step.status === 'error' ? 'ff6b6b' : step.status === 'success' ? '51cf66' : 'd3d3d3';

      mermaid += `    ${nodeId}["${label}"]:::${step.status}\n`;

      if (parentId) {
        mermaid += `    ${parentId} --> ${nodeId}\n`;
      }

      for (const child of step.children) {
        walkStep(child, nodeId);
      }
    };

    for (const step of trace.rootSteps) {
      walkStep(step);
    }

    mermaid += `    classDef success fill:#51cf66\n`;
    mermaid += `    classDef error fill:#ff6b6b\n`;
    mermaid += `    classDef skipped fill:#d3d3d3\n`;
    mermaid += `    classDef running fill:#ffd93d\n`;

    return mermaid;
  }

  /**
   * Format trace as table
   */
  static formatTable(trace) {
    const table = [];
    table.push(['Step', 'Type', 'Status', 'Duration (ms)', 'Tokens', 'Cost']);

    const walkStep = (step, indent = '') => {
      table.push([
        indent + step.name,
        step.type,
        step.status,
        step.duration.toString(),
        step.tokensUsed.toString(),
        step.cost.toFixed(4),
      ]);

      for (const child of step.children) {
        walkStep(child, indent + '  ');
      }
    };

    for (const step of trace.rootSteps) {
      walkStep(step);
    }

    return table;
  }

  /**
   * Format as markdown table
   */
  static formatMarkdownTable(trace) {
    const table = this.formatTable(trace);
    const headers = table[0];
    const rows = table.slice(1);

    let md = `| ${headers.join(' | ')} |\n`;
    md += `| ${headers.map(() => '---').join(' | ')} |\n`;

    for (const row of rows) {
      md += `| ${row.join(' | ')} |\n`;
    }

    return md;
  }
}

/**
 * TraceAnalyzer — analyzes execution traces
 */
class TraceAnalyzer {
  /**
   * Get slowest steps
   */
  static getSlowestSteps(trace, limit = 10) {
    const sorted = [...trace.steps]
      .sort((a, b) => b.duration - a.duration)
      .slice(0, limit);

    return sorted.map((s) => ({
      name: s.name,
      duration: s.duration,
      type: s.type,
    }));
  }

  /**
   * Get most expensive steps (by cost)
   */
  static getMostExpensiveSteps(trace, limit = 10) {
    const sorted = [...trace.steps]
      .filter((s) => s.cost > 0)
      .sort((a, b) => b.cost - a.cost)
      .slice(0, limit);

    return sorted.map((s) => ({
      name: s.name,
      cost: s.cost,
      tokens: s.tokensUsed,
    }));
  }

  /**
   * Get error analysis
   */
  static analyzeErrors(trace) {
    const failed = trace.getFailedSteps();

    return {
      totalErrors: failed.length,
      errorRate: (failed.length / trace.steps.length * 100).toFixed(2) + '%',
      errors: failed.map((s) => ({
        step: s.name,
        error: s.error?.message,
        type: s.error?.type,
      })),
    };
  }

  /**
   * Get performance bottlenecks
   */
  static findBottlenecks(trace) {
    const slowestSteps = this.getSlowestSteps(trace, 5);
    const totalDuration = trace.duration;

    return {
      totalDuration: totalDuration,
      bottlenecks: slowestSteps.map((s) => ({
        ...s,
        percentOfTotal: ((s.duration / totalDuration) * 100).toFixed(1) + '%',
      })),
    };
  }

  /**
   * Get cost breakdown
   */
  static getCostBreakdown(trace) {
    const byType = {};

    for (const step of trace.steps) {
      if (!byType[step.type]) {
        byType[step.type] = { count: 0, totalCost: 0, totalTokens: 0 };
      }
      byType[step.type].count++;
      byType[step.type].totalCost += step.cost;
      byType[step.type].totalTokens += step.tokensUsed;
    }

    return {
      total: trace.totalCost.toFixed(4),
      byType,
    };
  }

  /**
   * Generate summary report
   */
  static generateReport(trace) {
    return {
      name: trace.name,
      status: trace.status,
      totalDuration: trace.duration + 'ms',
      totalSteps: trace.steps.length,
      successRate: ((trace.successCount / trace.steps.length) * 100).toFixed(1) + '%',
      errorCount: trace.errorCount,
      totalTokens: trace.totalTokens,
      totalCost: trace.totalCost.toFixed(4),
      bottlenecks: this.findBottlenecks(trace),
      errors: this.analyzeErrors(trace),
      costBreakdown: this.getCostBreakdown(trace),
    };
  }
}

module.exports = {
  ExecutionStep,
  ExecutionTrace,
  ExecutionTracer,
  TraceFormatter,
  TraceAnalyzer,
};
