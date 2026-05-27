// ============================================================
// FILE: backend/services/graphWorkflow.service.js
// PURPOSE: Graph-based workflows with nodes, edges, and state
//          - Directed graph structure
//          - Conditional routing
//          - State management
//          - Cycle support
//          - Execution engine
//          - Visualization
// ============================================================

/**
 * GraphNode — A node in the workflow
 */
class GraphNode {
  constructor(id, fn, options = {}) {
    this.id = id;
    this.fn = fn;
    this.description = options.description || '';
    this.inputSchema = options.inputSchema || null;
    this.outputSchema = options.outputSchema || null;
    this.retries = options.retries || 0;
    this.timeout = options.timeout || null;
    this.metadata = options.metadata || {};
  }

  async execute(input, state = {}) {
    let lastError;

    for (let attempt = 0; attempt <= this.retries; attempt++) {
      try {
        if (this.timeout) {
          return await Promise.race([
            this.fn(input, state),
            new Promise((_, reject) =>
              setTimeout(
                () => reject(new Error(`Node timeout: ${this.timeout}ms`)),
                this.timeout
              )
            ),
          ]);
        }
        return await this.fn(input, state);
      } catch (err) {
        lastError = err;
        if (attempt < this.retries) {
          console.warn(
            `[GraphNode] "${this.id}" retry attempt ${attempt + 1}/${this.retries}`
          );
        }
      }
    }

    throw lastError;
  }
}

/**
 * GraphEdge — Connection between nodes
 */
class GraphEdge {
  constructor(source, target, options = {}) {
    this.source = source;
    this.target = target;
    this.condition = options.condition || null; // (output) => boolean
    this.transform = options.transform || null; // (output) => transformedOutput
    this.metadata = options.metadata || {};
  }

  async shouldRoute(output) {
    if (!this.condition) return true;
    return await this.condition(output);
  }

  async transformOutput(output) {
    if (!this.transform) return output;
    return await this.transform(output);
  }
}

/**
 * ConditionalEdge — Route to different nodes based on condition
 */
class ConditionalEdge {
  constructor(source, routes = {}, options = {}) {
    this.source = source;
    this.routes = routes; // { condition_name: 'target_node', ... }
    this.defaultRoute = options.defaultRoute || null;
    this.metadata = options.metadata || {};
  }

  async getTarget(output) {
    // Iterate through routes
    for (const [key, targetNode] of Object.entries(this.routes)) {
      if (output === key || output.type === key) {
        return targetNode;
      }
    }

    // Use default if no match
    if (this.defaultRoute) {
      return this.defaultRoute;
    }

    throw new Error(`No route found for output: ${JSON.stringify(output)}`);
  }
}

/**
 * GraphState — Manages state flowing through graph
 */
class GraphState {
  constructor(initialState = {}) {
    this.state = { ...initialState };
    this.history = [];
    this.nodeExecutions = new Map();
  }

  update(key, value) {
    this.state[key] = value;
    return this;
  }

  get(key) {
    return this.state[key];
  }

  recordExecution(nodeId, input, output, duration) {
    if (!this.nodeExecutions.has(nodeId)) {
      this.nodeExecutions.set(nodeId, []);
    }

    this.nodeExecutions.get(nodeId).push({
      input,
      output,
      duration,
      timestamp: new Date().toISOString(),
    });

    this.history.push({
      nodeId,
      timestamp: new Date().toISOString(),
      action: 'executed',
    });
  }

  getNodeExecutions(nodeId) {
    return this.nodeExecutions.get(nodeId) || [];
  }

  getHistory() {
    return this.history;
  }

  toJSON() {
    return {
      state: this.state,
      history: this.history,
      executions: Object.fromEntries(this.nodeExecutions),
    };
  }
}

/**
 * Graph — Main workflow graph
 */
class Graph {
  constructor(options = {}) {
    this.id = options.id || 'workflow';
    this.nodes = new Map();
    this.edges = [];
    this.conditionalEdges = [];
    this.startNode = options.startNode || null;
    this.endNodes = options.endNodes || [];
    this.metadata = options.metadata || {};
    this.interruptPoints = []; // InterruptPoint instances
    this.approvalHandler = options.approvalHandler || null;
  }

  /**
   * Add node to graph
   */
  addNode(id, fn, options = {}) {
    const node = new GraphNode(id, fn, options);
    this.nodes.set(id, node);

    // First node added is start node by default
    if (!this.startNode) {
      this.startNode = id;
    }

    return this;
  }

  /**
   * Add edge between nodes
   */
  addEdge(source, target, options = {}) {
    if (!this.nodes.has(source) || !this.nodes.has(target)) {
      throw new Error(`Node not found: ${source} or ${target}`);
    }

    this.edges.push(new GraphEdge(source, target, options));
    return this;
  }

  /**
   * Add conditional edge (one source, multiple targets)
   */
  addConditionalEdge(source, routes = {}, options = {}) {
    if (!this.nodes.has(source)) {
      throw new Error(`Node not found: ${source}`);
    }

    // Validate all target nodes exist
    for (const target of Object.values(routes)) {
      if (!this.nodes.has(target)) {
        throw new Error(`Target node not found: ${target}`);
      }
    }

    this.conditionalEdges.push(
      new ConditionalEdge(source, routes, options)
    );
    return this;
  }

  /**
   * Set start node
   */
  setStartNode(nodeId) {
    if (!this.nodes.has(nodeId)) {
      throw new Error(`Node not found: ${nodeId}`);
    }
    this.startNode = nodeId;
    return this;
  }

  /**
   * Add end node
   */
  addEndNode(nodeId) {
    if (!this.nodes.has(nodeId)) {
      throw new Error(`Node not found: ${nodeId}`);
    }
    this.endNodes.push(nodeId);
    return this;
  }

  /**
   * Add interrupt point for human approval
   */
  addInterruptPoint(interruptPoint) {
    this.interruptPoints.push(interruptPoint);
    return this;
  }

  /**
   * Set approval handler
   */
  setApprovalHandler(handler) {
    this.approvalHandler = handler;
    return this;
  }

  /**
   * Get interrupt points for a node
   */
  getInterruptPoints(nodeId, type = 'before') {
    return this.interruptPoints.filter(
      (ip) => ip.nodeId === nodeId && ip.type === type
    );
  }

  /**
   * Create a loop node that executes a loop
   * Returns a node that can be added to the graph
   */
  createLoopNode(loopId, loopConfig, loopExecutor) {
    const loopFn = async (input, state) => {
      const result = await loopExecutor.execute(loopConfig, input, {
        state,
      });
      return result.finalOutput;
    };

    return (nodeId, description = '') => {
      this.addNode(loopId, loopFn, {
        description: description || `Loop: ${loopConfig.name}`,
        metadata: {
          type: 'loop',
          loopConfig: loopConfig.toJSON(),
        },
      });
      return this;
    };
  }

  /**
   * Get next nodes from current node
   */
  getNextNodes(nodeId) {
    const next = [];

    // Regular edges
    for (const edge of this.edges) {
      if (edge.source === nodeId) {
        next.push({ type: 'edge', target: edge.target, edge });
      }
    }

    // Conditional edges
    for (const condEdge of this.conditionalEdges) {
      if (condEdge.source === nodeId) {
        next.push({ type: 'conditional', condEdge });
      }
    }

    return next;
  }

  /**
   * Validate graph structure
   */
  validate() {
    const errors = [];

    if (!this.startNode) {
      errors.push('No start node defined');
    }

    // Check all nodes are reachable
    const visited = new Set();
    const queue = [this.startNode];

    while (queue.length > 0) {
      const current = queue.shift();
      if (visited.has(current)) continue;
      visited.add(current);

      const nextNodes = this.getNextNodes(current);
      for (const next of nextNodes) {
        if (next.type === 'edge') {
          queue.push(next.target);
        } else if (next.type === 'conditional') {
          for (const target of Object.values(next.condEdge.routes)) {
            queue.push(target);
          }
        }
      }
    }

    const unreachable = [];
    for (const nodeId of this.nodes.keys()) {
      if (!visited.has(nodeId)) {
        unreachable.push(nodeId);
      }
    }

    if (unreachable.length > 0) {
      errors.push(`Unreachable nodes: ${unreachable.join(', ')}`);
    }

    return { valid: errors.length === 0, errors };
  }

  /**
   * Execute graph
   */
  async run(input, options = {}) {
    const validation = this.validate();
    if (!validation.valid) {
      throw new Error(`Invalid graph: ${validation.errors.join(', ')}`);
    }

    const state = new GraphState(options.initialState || {});
    const maxIterations = options.maxIterations || 100;
    let iterations = 0;
    let currentNode = this.startNode;
    let currentInput = input;

    const executionPath = [];

    while (iterations < maxIterations) {
      iterations++;

      if (!currentNode) {
        throw new Error('No current node');
      }

      // Check if end node
      if (this.endNodes.includes(currentNode)) {
        return {
          success: true,
          finalOutput: currentInput,
          state: state.state,
          executionPath,
          iterations,
          stateHistory: state.toJSON(),
        };
      }

      try {
        // Check for before-interrupt
        const beforeInterrupts = this.getInterruptPoints(currentNode, 'before');
        if (beforeInterrupts.length > 0 && this.approvalHandler) {
          for (const interrupt of beforeInterrupts) {
            if (await interrupt.shouldInterrupt(currentInput)) {
              const snapshot = {
                nodeId: currentNode,
                type: 'before',
                input: currentInput,
                state: { ...state.state },
                executionPath: [...executionPath],
              };

              const request = await this.approvalHandler.requestApproval({
                type: interrupt.approvalType,
                title: interrupt.title,
                description: interrupt.description,
                context: { snapshot, node: currentNode },
                options: interrupt.options,
                timeout: interrupt.timeout,
                requiredBy: currentNode,
              });

              if (request.status === 'rejected') {
                return {
                  success: false,
                  error: `Approval rejected: ${request.reason}`,
                  failedNode: currentNode,
                  iterations,
                  stateHistory: state.toJSON(),
                  executionPath,
                  approvalId: request.id,
                };
              }
            }
          }
        }

        // Execute node
        const startTime = Date.now();
        const node = this.nodes.get(currentNode);
        const output = await node.execute(currentInput, state.state);
        const duration = Date.now() - startTime;

        // Record execution
        state.recordExecution(currentNode, currentInput, output, duration);
        executionPath.push({
          node: currentNode,
          duration,
          output: typeof output === 'object' ? '[object]' : String(output),
        });

        // Check for after-interrupt
        const afterInterrupts = this.getInterruptPoints(currentNode, 'after');
        if (afterInterrupts.length > 0 && this.approvalHandler) {
          for (const interrupt of afterInterrupts) {
            if (await interrupt.shouldInterrupt(output)) {
              const snapshot = {
                nodeId: currentNode,
                type: 'after',
                input: currentInput,
                output,
                state: { ...state.state },
                executionPath: [...executionPath],
              };

              const request = await this.approvalHandler.requestApproval({
                type: interrupt.approvalType,
                title: interrupt.title,
                description: interrupt.description,
                context: { snapshot, node: currentNode },
                options: interrupt.options,
                timeout: interrupt.timeout,
                requiredBy: currentNode,
              });

              if (request.status === 'rejected') {
                return {
                  success: false,
                  error: `Approval rejected: ${request.reason}`,
                  failedNode: currentNode,
                  iterations,
                  stateHistory: state.toJSON(),
                  executionPath,
                  approvalId: request.id,
                };
              }
            }
          }
        }

        // Get next node
        const nextNodes = this.getNextNodes(currentNode);

        if (nextNodes.length === 0) {
          throw new Error(`No outgoing edges from node: ${currentNode}`);
        }

        // Handle conditional edge
        const condEdge = nextNodes.find((n) => n.type === 'conditional');
        if (condEdge) {
          currentNode = await condEdge.condEdge.getTarget(output);
          currentInput = output;
        } else {
          // Handle regular edge
          const edge = nextNodes[0].edge;
          currentNode = edge.target;
          currentInput = await edge.transformOutput(output);
        }
      } catch (err) {
        return {
          success: false,
          error: err.message,
          failedNode: currentNode,
          iterations,
          stateHistory: state.toJSON(),
          executionPath,
        };
      }
    }

    return {
      success: false,
      error: `Max iterations (${maxIterations}) reached`,
      iterations,
      stateHistory: state.toJSON(),
      executionPath,
    };
  }

  /**
   * Export to Mermaid diagram
   */
  toMermaid() {
    let mermaid = 'graph TD\n';

    // Add nodes
    for (const [id, node] of this.nodes) {
      const label = `${id}<br/>${node.description || ''}`;
      mermaid += `  ${id}["${label}"]\n`;
    }

    // Add regular edges
    for (const edge of this.edges) {
      mermaid += `  ${edge.source} --> ${edge.target}\n`;
    }

    // Add conditional edges
    for (const condEdge of this.conditionalEdges) {
      for (const [condition, target] of Object.entries(condEdge.routes)) {
        mermaid += `  ${condEdge.source} -->|${condition}| ${target}\n`;
      }
    }

    return mermaid;
  }

  /**
   * Export to JSON
   */
  toJSON() {
    return {
      id: this.id,
      startNode: this.startNode,
      endNodes: this.endNodes,
      nodes: Array.from(this.nodes.entries()).map(([id, node]) => ({
        id,
        description: node.description,
        metadata: node.metadata,
      })),
      edges: this.edges.map((e) => ({
        source: e.source,
        target: e.target,
        metadata: e.metadata,
      })),
      conditionalEdges: this.conditionalEdges.map((ce) => ({
        source: ce.source,
        routes: ce.routes,
        defaultRoute: ce.defaultRoute,
      })),
    };
  }
}

/**
 * SubGraph — Compose graphs within graphs
 */
class SubGraph extends Graph {
  constructor(innerGraph, id, options = {}) {
    super(options);
    this.id = id;
    this.innerGraph = innerGraph;
    this.inputTransform = options.inputTransform || null;
    this.outputTransform = options.outputTransform || null;
  }

  async run(input, state = {}) {
    let transformedInput = input;

    if (this.inputTransform) {
      transformedInput = await this.inputTransform(input, state);
    }

    const result = await this.innerGraph.run(transformedInput, {
      initialState: state,
    });

    if (this.outputTransform && result.success) {
      result.finalOutput = await this.outputTransform(
        result.finalOutput,
        state
      );
    }

    return result;
  }
}

/**
 * GraphBuilder — Fluent API for building graphs
 */
class GraphBuilder {
  constructor() {
    this.graph = new Graph();
  }

  node(id, fn, description = '') {
    this.graph.addNode(id, fn, { description });
    return this;
  }

  edge(source, target) {
    this.graph.addEdge(source, target);
    return this;
  }

  conditionalEdge(source, routes, defaultRoute = null) {
    this.graph.addConditionalEdge(source, routes, { defaultRoute });
    return this;
  }

  startNode(id) {
    this.graph.setStartNode(id);
    return this;
  }

  endNode(id) {
    this.graph.addEndNode(id);
    return this;
  }

  build() {
    return this.graph;
  }
}

module.exports = {
  GraphNode,
  GraphEdge,
  ConditionalEdge,
  GraphState,
  Graph,
  SubGraph,
  GraphBuilder,
};
