// ============================================================
// FILE: backend/services/agent.service.js
// PURPOSE: Agentic workflow with dynamic tool selection
//          - ReAct pattern (Reasoning + Acting)
//          - Tool registry and execution
//          - Agent memory and thought tracking
//          - Multi-turn reasoning loops
//          - Error recovery and self-correction
// ============================================================

const { createParser, JSONParser } = require('./outputParser.service');
const { buildTemporalSystemBlock } = require('./temporalContext.service');

/**
 * Tool definition — describes a tool the agent can use
 */
class Tool {
  constructor(name, description, fn, schema = {}) {
    this.name = name;
    this.description = description;
    this.fn = fn;
    this.schema = schema; // { param1: 'string', param2: 'number', ... }
  }

  async execute(args = {}) {
    return await this.fn(args);
  }
}

/**
 * ToolRegistry — manages available tools
 */
class ToolRegistry {
  constructor() {
    this.tools = new Map();
  }

  register(tool) {
    if (!tool.name) throw new Error('Tool must have a name');
    this.tools.set(tool.name, tool);
    return this;
  }

  get(name) {
    return this.tools.get(name);
  }

  list() {
    return Array.from(this.tools.values());
  }

  getToolDescription() {
    return this.list()
      .map(
        (tool) =>
          `- ${tool.name}: ${tool.description}` +
          (Object.keys(tool.schema).length > 0
            ? `\n  Parameters: ${JSON.stringify(tool.schema)}`
            : '')
      )
      .join('\n');
  }
}

/**
 * AgentThought — single reasoning step
 */
class AgentThought {
  constructor(stepNum, thought, action = null, observation = null) {
    this.stepNum = stepNum;
    this.thought = thought;
    this.action = action;
    this.observation = observation;
    this.timestamp = new Date().toISOString();
  }

  toString() {
    let result = `\nStep ${this.stepNum}:\nThought: ${this.thought}`;
    if (this.action) {
      result += `\nAction: ${this.action.tool}(${JSON.stringify(this.action.args)})`;
    }
    if (this.observation) {
      result += `\nObservation: ${this.observation}`;
    }
    return result;
  }
}

/**
 * AgentMemory — tracks reasoning and decisions
 */
class AgentMemory {
  constructor(maxThoughts = 20) {
    this.thoughts = [];
    this.maxThoughts = maxThoughts;
    this.toolResults = new Map();
  }

  addThought(stepNum, thought, action = null, observation = null) {
    const thought_obj = new AgentThought(stepNum, thought, action, observation);
    this.thoughts.push(thought_obj);

    // Keep only recent thoughts
    if (this.thoughts.length > this.maxThoughts) {
      this.thoughts.shift();
    }

    return thought_obj;
  }

  addToolResult(toolName, args, result) {
    const key = `${toolName}:${JSON.stringify(args)}`;
    this.toolResults.set(key, result);
  }

  getToolResult(toolName, args) {
    const key = `${toolName}:${JSON.stringify(args)}`;
    return this.toolResults.get(key);
  }

  getHistory() {
    return this.thoughts.map((t) => t.toString()).join('\n');
  }
}

/**
 * AgentResult — output of agent execution
 */
class AgentResult {
  constructor() {
    this.success = false;
    this.finalAnswer = null;
    this.thoughts = [];
    this.toolCalls = [];
    this.errors = [];
    this.iterations = 0;
    this.totalTime = 0;
  }
}

/**
 * Base Agent class
 */
class Agent {
  constructor(modelDispatcher, toolRegistry, options = {}) {
    this.modelDispatcher = modelDispatcher;
    this.tools = toolRegistry;
    this.maxIterations = options.maxIterations || 10;
    this.verbose = options.verbose || false;
    this.modelId = options.modelId || 'claude-3-5-sonnet';
    this.memory = new AgentMemory(options.maxMemorySize || 20);
    this.parser = new JSONParser();
    this.approvalHandler = options.approvalHandler || null;
    this.requireApprovalFor = options.requireApprovalFor || [];
    this.tracer = options.tracer || null; // ExecutionTracer instance (optional)
    this.timeZone = options.timeZone || null; // IANA zone; falls back to DEFAULT_TIMEZONE
  }

  _log(message) {
    if (this.verbose) {
      console.log(`[Agent] ${message}`);
    }
  }

  /**
   * Build system prompt for agent
   */
  _buildSystemPrompt() {
    return `You are a helpful AI agent that solves problems step by step using available tools.

Follow the ReAct pattern:
1. Thought: What do I need to do?
2. Action: Which tool should I use? Format: {"tool": "tool_name", "args": {...}}
3. Observation: What did the tool return?
4. Repeat until you have the answer

Available tools:
${this.tools.getToolDescription()}

When you have the final answer, respond with:
{"final_answer": "Your answer here"}

Think carefully and use tools when needed.

${buildTemporalSystemBlock({ requestTimeZone: this.timeZone })}`;
  }

  /**
   * Parse agent response to extract action or final answer
   */
  _parseResponse(response) {
    // Try to extract JSON
    const jsonMatch = response.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      return { type: 'thought', value: response };
    }

    try {
      const parsed = JSON.parse(jsonMatch[0]);

      if (parsed.final_answer) {
        return { type: 'final_answer', value: parsed.final_answer };
      }

      if (parsed.tool && parsed.args) {
        return { type: 'action', tool: parsed.tool, args: parsed.args };
      }

      return { type: 'thought', value: response };
    } catch (err) {
      return { type: 'thought', value: response };
    }
  }

  /**
   * Execute a tool
   */
  async _executeTool(toolName, args) {
    const tool = this.tools.get(toolName);

    if (!tool) {
      throw new Error(`Unknown tool: ${toolName}`);
    }

    this._log(`Executing tool: ${toolName} with args: ${JSON.stringify(args)}`);

    // Check if approval required
    if (
      this.requireApprovalFor.includes(toolName) &&
      this.approvalHandler
    ) {
      const request = await this.approvalHandler.requestApproval({
        type: 'approval',
        title: `Approve tool execution: ${toolName}`,
        description: `Execute tool "${toolName}" with arguments:\n${JSON.stringify(args, null, 2)}`,
        context: { toolName, args },
        timeout: 300000, // 5 min
        requiredBy: `agent-tool-${toolName}`,
      });

      if (request.status === 'rejected') {
        throw new Error(`Tool ${toolName} rejected by user: ${request.reason}`);
      }
    }

    const startTime = Date.now();
    try {
      const result = await tool.execute(args);
      const duration = Date.now() - startTime;
      this.memory.addToolResult(toolName, args, result);
      // Record in tracer if available
      this.tracer?.recordToolExecution(toolName, args, result, duration);
      return result;
    } catch (err) {
      const duration = Date.now() - startTime;
      this.tracer?.recordToolExecution(toolName, args, null, duration);
      throw new Error(`Tool ${toolName} failed: ${err.message}`);
    }
  }

  /**
   * Main agent loop
   */
  async run(input, context = {}) {
    const result = new AgentResult();
    const startTime = Date.now();

    this._log(`Starting agent with goal: ${input}`);

    const messages = [
      {
        role: 'user',
        content: `Goal: ${input}\n\nMemory:\n${this.memory.getHistory()}`,
      },
    ];

    for (let iteration = 0; iteration < this.maxIterations; iteration++) {
      result.iterations = iteration + 1;

      this._log(`Iteration ${iteration + 1}/${this.maxIterations}`);

      try {
        // Get agent response
        const response = await this.modelDispatcher.dispatch({
          modelId: this.modelId,
          messages: [
            {
              role: 'system',
              content: this._buildSystemPrompt(),
            },
            ...messages,
          ],
          temperature: 0.7,
        });

        const responseText = response.text || response.content;
        this._log(`Agent response: ${responseText.slice(0, 100)}...`);

        // Parse response
        const parsed = this._parseResponse(responseText);

        if (parsed.type === 'final_answer') {
          this._log('Agent reached final answer');
          result.success = true;
          result.finalAnswer = parsed.value;
          this.memory.addThought(iteration + 1, 'Goal achieved', null, parsed.value);
          break;
        }

        if (parsed.type === 'action') {
          // Execute tool
          const { tool: toolName, args } = parsed;
          const thought = `I should use ${toolName} to get more information`;
          this.memory.addThought(iteration + 1, thought, { tool: toolName, args });

          try {
            const toolResult = await this._executeTool(toolName, args);
            const observation = JSON.stringify(toolResult).slice(0, 500);
            this.memory.thoughts[this.memory.thoughts.length - 1].observation = observation;

            result.toolCalls.push({ tool: toolName, args, result: toolResult });

            // Add to messages for next iteration
            messages.push({
              role: 'assistant',
              content: responseText,
            });

            messages.push({
              role: 'user',
              content: `Observation from ${toolName}: ${observation}`,
            });
          } catch (err) {
            this._log(`Tool execution failed: ${err.message}`);
            result.errors.push(err.message);

            messages.push({
              role: 'assistant',
              content: responseText,
            });

            messages.push({
              role: 'user',
              content: `Error: ${err.message}. Try a different approach.`,
            });
          }
        } else {
          // Just thought, continue
          this.memory.addThought(iteration + 1, parsed.value);

          messages.push({
            role: 'assistant',
            content: responseText,
          });
        }
      } catch (err) {
        this._log(`Agent iteration failed: ${err.message}`);
        result.errors.push(err.message);

        if (iteration === this.maxIterations - 1) {
          result.success = false;
          break;
        }

        // Continue to next iteration
        messages.push({
          role: 'user',
          content: `Error: ${err.message}. Please try again.`,
        });
      }
    }

    if (!result.success && result.errors.length === 0) {
      result.success = false;
      result.finalAnswer = `Could not solve in ${this.maxIterations} iterations`;
    }

    result.thoughts = this.memory.thoughts;
    result.totalTime = Date.now() - startTime;

    this._log(`Agent completed in ${result.totalTime}ms with ${result.iterations} iterations`);

    return result;
  }

  /**
   * Refine an answer through iterative cycles
   */
  async refineAnswer(initialAnswer, options = {}) {
    const maxRefinements = options.maxRefinements || 3;
    const validators = options.validators || [];
    const refinementPrompt = options.refinementPrompt || 'Improve the previous response based on the following feedback or criteria:';

    const refinements = [];
    let currentAnswer = initialAnswer;

    this._log(`Starting refinement loop with ${maxRefinements} max refinements`);

    for (let i = 0; i < maxRefinements; i++) {
      this._log(`Refinement iteration ${i + 1}/${maxRefinements}`);

      let shouldStop = false;

      // Run validators
      for (const validator of validators) {
        try {
          const validation = await validator(currentAnswer);
          if (validation.valid) {
            this._log(`Answer passed validation: ${validation.reason || ''}`);
            shouldStop = true;
            break;
          } else if (validation.feedback) {
            // Get refined answer
            const messages = [
              {
                role: 'system',
                content: this._buildSystemPrompt(),
              },
              {
                role: 'user',
                content: `${refinementPrompt}\n\n${validation.feedback}\n\nCurrent answer:\n${currentAnswer}`,
              },
            ];

            try {
              const response = await this.modelDispatcher.dispatch({
                modelId: this.modelId,
                messages,
                temperature: 0.7,
              });

              currentAnswer = response.text || response.content;
              refinements.push({
                iteration: i + 1,
                feedback: validation.feedback,
                refined: currentAnswer,
              });

              this._log(`Answer refined based on feedback`);
            } catch (err) {
              this._log(`Refinement failed: ${err.message}`);
            }
          }
        } catch (err) {
          this._log(`Validator failed: ${err.message}`);
        }
      }

      if (shouldStop) {
        break;
      }
    }

    return {
      finalAnswer: currentAnswer,
      refinements: refinements.length,
      refinementHistory: refinements,
    };
  }
}

/**
 * Factory function — create agent
 */
const createAgent = (modelDispatcher, tools, options = {}) => {
  const registry = new ToolRegistry();

  // Register tools
  if (Array.isArray(tools)) {
    tools.forEach((tool) => registry.register(tool));
  } else {
    Object.values(tools).forEach((tool) => registry.register(tool));
  }

  return new Agent(modelDispatcher, registry, options);
};

/**
 * Helper — create tool from function
 */
const createTool = (name, description, fn, schema = {}) => {
  return new Tool(name, description, fn, schema);
};

module.exports = {
  Agent,
  Tool,
  ToolRegistry,
  AgentMemory,
  AgentThought,
  AgentResult,
  createAgent,
  createTool,
};
