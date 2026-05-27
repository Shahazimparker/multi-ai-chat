// ============================================================
// FILE: backend/services/flowVisibility.service.js
// PURPOSE: Complex flow visibility and analysis
//          - Interactive flow visualization
//          - Dependency and critical path analysis
//          - State and variable tracking
//          - Step-through debugging
//          - Performance optimization suggestions
//          - Real-time dashboard data
// ============================================================

/**
 * Variable — tracks a variable across execution
 */
class Variable {
  constructor(name, initialValue = null) {
    this.name = name;
    this.values = [];
    this.currentValue = initialValue;
    this.firstMentionedAt = null;
    this.lastModifiedAt = null;
    this.dependentSteps = [];

    if (initialValue !== null) {
      this.setValue(initialValue, 'initial');
    }
  }

  setValue(value, stepId = null) {
    this.values.push({
      value,
      stepId,
      timestamp: Date.now(),
    });
    this.currentValue = value;
    this.lastModifiedAt = stepId;
    return this;
  }

  getHistory() {
    return this.values.map((v) => ({
      value: typeof v.value === 'object' ? '[object]' : String(v.value),
      step: v.stepId,
      timestamp: new Date(v.timestamp).toISOString(),
    }));
  }

  addDependentStep(stepId) {
    if (!this.dependentSteps.includes(stepId)) {
      this.dependentSteps.push(stepId);
    }
    return this;
  }

  toJSON() {
    return {
      name: this.name,
      currentValue: this.currentValue,
      historyLength: this.values.length,
      firstMentionedAt: this.firstMentionedAt,
      lastModifiedAt: this.lastModifiedAt,
      dependentSteps: this.dependentSteps.length,
    };
  }
}

/**
 * StateTracker — tracks variable changes across execution
 */
class StateTracker {
  constructor() {
    this.variables = new Map(); // name → Variable
    this.snapshots = new Map(); // stepId → state snapshot
  }

  /**
   * Track variable value change
   */
  setVariable(name, value, stepId = null) {
    if (!this.variables.has(name)) {
      this.variables.set(name, new Variable(name));
    }

    const variable = this.variables.get(name);
    variable.setValue(value, stepId);

    if (stepId) {
      variable.addDependentStep(stepId);
    }

    return variable;
  }

  /**
   * Get variable history
   */
  getVariableHistory(name) {
    const variable = this.variables.get(name);
    return variable ? variable.getHistory() : [];
  }

  /**
   * Take state snapshot at step
   */
  takeSnapshot(stepId) {
    const snapshot = {};

    for (const [name, variable] of this.variables) {
      snapshot[name] = variable.currentValue;
    }

    this.snapshots.set(stepId, snapshot);
    return snapshot;
  }

  /**
   * Get state diff between two steps
   */
  getStateDiff(stepId1, stepId2) {
    const snap1 = this.snapshots.get(stepId1) || {};
    const snap2 = this.snapshots.get(stepId2) || {};

    const diff = {
      added: {},
      removed: {},
      changed: {},
    };

    // Changed or removed
    for (const [key, value1] of Object.entries(snap1)) {
      if (!(key in snap2)) {
        diff.removed[key] = value1;
      } else if (snap2[key] !== value1) {
        diff.changed[key] = { before: value1, after: snap2[key] };
      }
    }

    // Added
    for (const [key, value2] of Object.entries(snap2)) {
      if (!(key in snap1)) {
        diff.added[key] = value2;
      }
    }

    return diff;
  }

  /**
   * Get all variables
   */
  getAllVariables() {
    return Array.from(this.variables.values());
  }

  toJSON() {
    return {
      variables: this.getAllVariables().map((v) => v.toJSON()),
      snapshots: this.snapshots.size,
    };
  }
}

/**
 * FlowAnalyzer — analyzes flow structure and execution
 */
class FlowAnalyzer {
  /**
   * Analyze flow dependencies
   */
  static analyzeDependencies(trace) {
    const dependencies = new Map(); // stepId → [dependsOn]

    for (const step of trace.steps) {
      dependencies.set(step.id, []);
    }

    // Analyze step nesting - children depend on parents
    for (const step of trace.steps) {
      if (step.parentId) {
        const deps = dependencies.get(step.id) || [];
        deps.push(step.parentId);
        dependencies.set(step.id, deps);
      }
    }

    return dependencies;
  }

  /**
   * Find critical path
   */
  static findCriticalPath(trace) {
    const dependencies = this.analyzeDependencies(trace);
    const pathDurations = new Map();

    const calculateDuration = (stepId, visited = new Set()) => {
      if (pathDurations.has(stepId)) {
        return pathDurations.get(stepId);
      }

      if (visited.has(stepId)) return 0; // Cycle detection

      const step = trace.getStep(stepId);
      if (!step) return 0;

      visited.add(stepId);

      let maxChildDuration = 0;
      for (const child of step.children) {
        const childDuration = calculateDuration(child.id, new Set(visited));
        maxChildDuration = Math.max(maxChildDuration, childDuration);
      }

      const totalDuration = step.duration + maxChildDuration;
      pathDurations.set(stepId, totalDuration);

      return totalDuration;
    };

    // Calculate for all root steps
    let criticalPath = [];
    let maxDuration = 0;

    for (const step of trace.rootSteps) {
      const duration = calculateDuration(step.id);
      if (duration > maxDuration) {
        maxDuration = duration;
        criticalPath = [step.id];
      }
    }

    return {
      duration: maxDuration,
      path: criticalPath,
      steps: criticalPath.map((id) => trace.getStep(id)?.name || id),
    };
  }

  /**
   * Detect cycles
   */
  static detectCycles(trace) {
    const cycles = [];
    const visited = new Set();
    const recursionStack = new Set();

    const detectCycleDFS = (stepId, path = []) => {
      visited.add(stepId);
      recursionStack.add(stepId);
      path.push(stepId);

      const step = trace.getStep(stepId);
      if (step) {
        for (const child of step.children) {
          if (recursionStack.has(child.id)) {
            // Cycle found
            const cycleStart = path.indexOf(child.id);
            cycles.push(path.slice(cycleStart));
          } else if (!visited.has(child.id)) {
            detectCycleDFS(child.id, [...path]);
          }
        }
      }

      recursionStack.delete(stepId);
    };

    for (const step of trace.rootSteps) {
      if (!visited.has(step.id)) {
        detectCycleDFS(step.id);
      }
    }

    return cycles.map((cycle) => cycle.map((id) => trace.getStep(id)?.name || id));
  }

  /**
   * Analyze parallelization opportunities
   */
  static findParallelizationOpportunities(trace) {
    const opportunities = [];

    for (const parentStep of trace.rootSteps) {
      const children = parentStep.children;

      if (children.length > 1) {
        // Check if children can run in parallel (no dependencies)
        let canParallelize = true;
        const childIds = new Set(children.map((c) => c.id));

        for (const child of children) {
          const deps = this.analyzeDependencies(trace).get(child.id) || [];
          for (const dep of deps) {
            if (childIds.has(dep) && dep !== parentStep.id) {
              canParallelize = false;
              break;
            }
          }
        }

        if (canParallelize) {
          const totalSequentialTime = children.reduce((sum, c) => sum + c.duration, 0);
          const maxParallelTime = Math.max(...children.map((c) => c.duration));
          const timeSaved = totalSequentialTime - maxParallelTime;

          if (timeSaved > 0) {
            opportunities.push({
              parent: parentStep.name,
              children: children.map((c) => c.name),
              sequentialTime: totalSequentialTime,
              parallelTime: maxParallelTime,
              timeSaved,
              percentageImprovement: ((timeSaved / totalSequentialTime) * 100).toFixed(1),
            });
          }
        }
      }
    }

    return opportunities;
  }

  /**
   * Find bottlenecks
   */
  static findBottlenecks(trace, threshold = 0.1) {
    const bottlenecks = [];
    const totalDuration = trace.duration;
    const thresholdTime = totalDuration * threshold;

    for (const step of trace.steps) {
      if (step.duration > thresholdTime) {
        bottlenecks.push({
          name: step.name,
          duration: step.duration,
          percentage: ((step.duration / totalDuration) * 100).toFixed(1),
          type: step.type,
        });
      }
    }

    return bottlenecks.sort((a, b) => b.duration - a.duration);
  }
}

/**
 * FlowVisualizer — creates visualizations of flows
 */
class FlowVisualizer {
  /**
   * Generate Mermaid sequence diagram
   */
  static generateSequenceDiagram(trace) {
    let mermaid = 'sequenceDiagram\n';

    const actors = new Set(['User', 'Agent']);
    const steps = trace.rootSteps.slice(0, 20); // Limit to prevent huge diagrams

    for (const step of steps) {
      if (step.type === 'tool') {
        actors.add('Tool');
      } else if (step.type === 'llm') {
        actors.add('LLM');
      }
    }

    // Add actors
    for (const actor of actors) {
      mermaid += `    participant ${actor}\n`;
    }

    // Add interactions
    let currentActor = 'Agent';
    for (const step of steps) {
      const nextActor = step.type === 'tool' ? 'Tool' : step.type === 'llm' ? 'LLM' : 'Agent';

      if (step.status === 'error') {
        mermaid += `    ${currentActor}-->>X${nextActor}: ${step.name} (ERROR)\n`;
      } else {
        mermaid += `    ${currentActor}->>+${nextActor}: ${step.name}\n`;
        mermaid += `    ${nextActor}-->>-${currentActor}: ${step.duration}ms\n`;
      }

      currentActor = nextActor;
    }

    return mermaid;
  }

  /**
   * Generate dependency graph
   */
  static generateDependencyGraph(trace) {
    let mermaid = 'flowchart LR\n';

    const dependencies = FlowAnalyzer.analyzeDependencies(trace);
    const addedSteps = new Set();

    const addStep = (stepId, parentId = null) => {
      const step = trace.getStep(stepId);
      if (!step || addedSteps.has(stepId)) return;

      addedSteps.add(stepId);

      const nodeId = `step_${stepId.substring(0, 8)}`;
      const color = step.status === 'error' ? '#ff6b6b' : step.status === 'success' ? '#51cf66' : '#d3d3d3';

      mermaid += `    ${nodeId}["${step.name}<br/>(${step.duration}ms)"]:::${step.status}\n`;

      if (parentId) {
        const parentNodeId = `step_${parentId.substring(0, 8)}`;
        mermaid += `    ${parentNodeId} --> ${nodeId}\n`;
      }

      for (const child of step.children) {
        addStep(child.id, stepId);
      }
    };

    for (const rootStep of trace.rootSteps) {
      addStep(rootStep.id);
    }

    mermaid += `    classDef success fill:#51cf66\n`;
    mermaid += `    classDef error fill:#ff6b6b\n`;
    mermaid += `    classDef pending fill:#ffd93d\n`;

    return mermaid;
  }

  /**
   * Generate state diagram
   */
  static generateStateDiagram(stateTracker) {
    let diagram = 'State Transitions:\n';

    for (const variable of stateTracker.getAllVariables()) {
      const history = stateTracker.getVariableHistory(variable.name);

      diagram += `\n${variable.name}:\n`;
      for (let i = 0; i < Math.min(5, history.length); i++) {
        const entry = history[i];
        diagram += `  [${i}] @ ${entry.step}: ${entry.value}\n`;
      }

      if (history.length > 5) {
        diagram += `  ... (${history.length - 5} more changes)\n`;
      }
    }

    return diagram;
  }

  /**
   * Generate heat map (performance visualization)
   */
  static generateHeatmap(trace) {
    const heatmap = [];
    const totalDuration = trace.duration;

    for (const step of trace.steps.sort((a, b) => b.duration - a.duration)) {
      const percentage = (step.duration / totalDuration) * 100;
      const intensity = Math.min(100, Math.max(0, percentage));

      heatmap.push({
        name: step.name,
        duration: step.duration,
        percentage: percentage.toFixed(1),
        intensity,
        type: step.type,
      });
    }

    return heatmap;
  }
}

/**
 * FlowDebugger — step-through debugging of flows
 */
class FlowDebugger {
  constructor(trace, stateTracker) {
    this.trace = trace;
    this.stateTracker = stateTracker;
    this.currentStepIndex = 0;
    this.breakpoints = new Set();
    this.watches = new Map();
  }

  /**
   * Set breakpoint at step
   */
  setBreakpoint(stepId) {
    this.breakpoints.add(stepId);
    return this;
  }

  /**
   * Watch variable
   */
  watchVariable(name) {
    this.watches.set(name, true);
    return this;
  }

  /**
   * Get next step
   */
  getNextStep() {
    if (this.currentStepIndex >= this.trace.steps.length) {
      return null;
    }

    const step = this.trace.steps[this.currentStepIndex];
    this.currentStepIndex++;

    return {
      step,
      variables: this.getWatchedVariables(),
      state: this.stateTracker.snapshots.get(step.id),
    };
  }

  /**
   * Get watched variables
   */
  getWatchedVariables() {
    const watched = {};

    for (const name of this.watches.keys()) {
      const variable = this.stateTracker.variables.get(name);
      if (variable) {
        watched[name] = variable.currentValue;
      }
    }

    return watched;
  }

  /**
   * Get context around current step
   */
  getContext(steps = 2) {
    const startIdx = Math.max(0, this.currentStepIndex - steps);
    const endIdx = Math.min(this.trace.steps.length, this.currentStepIndex + steps);

    return {
      previous: this.trace.steps.slice(startIdx, this.currentStepIndex),
      current: this.trace.steps[this.currentStepIndex],
      next: this.trace.steps.slice(this.currentStepIndex + 1, endIdx),
    };
  }

  /**
   * Get stack trace
   */
  getStackTrace() {
    const stack = [];

    const buildStack = (stepId, depth = 0) => {
      const step = this.trace.getStep(stepId);
      if (step) {
        stack.push({
          depth,
          name: step.name,
          status: step.status,
          duration: step.duration,
        });

        if (step.parentId) {
          buildStack(step.parentId, depth + 1);
        }
      }
    };

    if (this.currentStepIndex > 0) {
      buildStack(this.trace.steps[this.currentStepIndex - 1].id);
    }

    return stack;
  }
}

/**
 * FlowDashboard — prepares data for UI dashboards
 */
class FlowDashboard {
  /**
   * Get dashboard summary
   */
  static getSummary(trace, stateTracker) {
    const failed = trace.getFailedSteps();
    const dependencies = FlowAnalyzer.analyzeDependencies(trace);
    const bottlenecks = FlowAnalyzer.findBottlenecks(trace);

    return {
      status: trace.status,
      progress: Math.min(100, Math.round((trace.successCount / trace.steps.length) * 100)),
      totalSteps: trace.steps.length,
      completedSteps: trace.successCount,
      failedSteps: failed.length,
      duration: trace.duration,
      totalCost: trace.totalCost.toFixed(4),
      bottlenecks: bottlenecks.slice(0, 5),
      variables: stateTracker.getAllVariables().length,
    };
  }

  /**
   * Get step timeline for UI
   */
  static getTimeline(trace) {
    const baseTime = trace.startTime;

    return trace.steps.map((step) => ({
      id: step.id,
      name: step.name,
      type: step.type,
      status: step.status,
      startOffset: step.startTime - baseTime,
      duration: step.duration,
      cost: step.cost,
    }));
  }

  /**
   * Get execution metrics
   */
  static getMetrics(trace) {
    return {
      totalDuration: trace.duration,
      averageStepDuration: Math.round(trace.duration / trace.steps.length),
      successRate: ((trace.successCount / trace.steps.length) * 100).toFixed(1),
      costPerStep: (trace.totalCost / trace.steps.length).toFixed(4),
      tokensPerStep: Math.round(trace.totalTokens / trace.steps.length),
    };
  }

  /**
   * Get flow graph data for visualization
   */
  static getFlowGraph(trace) {
    const nodes = [];
    const edges = [];
    const addedIds = new Set();

    const addNode = (step) => {
      if (addedIds.has(step.id)) return;

      addedIds.add(step.id);
      nodes.push({
        id: step.id,
        label: step.name,
        type: step.type,
        status: step.status,
        duration: step.duration,
      });

      for (const child of step.children) {
        edges.push({
          source: step.id,
          target: child.id,
        });
        addNode(child);
      }
    };

    for (const rootStep of trace.rootSteps) {
      addNode(rootStep);
    }

    return { nodes, edges };
  }
}

/**
 * FlowOptimizer — suggests optimizations
 */
class FlowOptimizer {
  /**
   * Generate optimization suggestions
   */
  static generateSuggestions(trace, stateTracker) {
    const suggestions = [];

    // Check for parallelization
    const parallelOppurtunities = FlowAnalyzer.findParallelizationOpportunities(trace);
    if (parallelOppurtunities.length > 0) {
      suggestions.push({
        type: 'parallelization',
        priority: 'high',
        details: parallelOppurtunities.slice(0, 3),
        message: `Found ${parallelOppurtunities.length} opportunities to parallelize steps`,
      });
    }

    // Check for long steps
    const bottlenecks = FlowAnalyzer.findBottlenecks(trace, 0.15);
    if (bottlenecks.length > 0) {
      suggestions.push({
        type: 'bottleneck',
        priority: 'medium',
        details: bottlenecks.slice(0, 3),
        message: `${bottlenecks.length} steps are taking >15% of total time`,
      });
    }

    // Check for errors
    const errors = trace.getFailedSteps();
    if (errors.length > 0) {
      suggestions.push({
        type: 'errors',
        priority: 'high',
        count: errors.length,
        message: `${errors.length} steps failed`,
      });
    }

    // Check for cycles
    const cycles = FlowAnalyzer.detectCycles(trace);
    if (cycles.length > 0) {
      suggestions.push({
        type: 'cycles',
        priority: 'medium',
        count: cycles.length,
        message: `Detected ${cycles.length} potential cycles`,
      });
    }

    return suggestions;
  }
}

module.exports = {
  Variable,
  StateTracker,
  FlowAnalyzer,
  FlowVisualizer,
  FlowDebugger,
  FlowDashboard,
  FlowOptimizer,
};
