// ============================================================
// FILE: backend/services/agentOrchestrator.service.js
// PURPOSE: Intelligent agent orchestration combining:
//          - Dynamic tool selection
//          - Automatic looping and refinement
//          - Multi-agent coordination
//          - Approval integration
//          - State and memory management
// ============================================================

const { buildTemporalSystemBlock } = require('./temporalContext.service');

/**
 * ToolSelectionStrategy — determines which tool to use
 */
class ToolSelectionStrategy {
  async selectTool(availableTools, context = {}) {
    throw new Error('selectTool() not implemented');
  }
}

/**
 * GreedyToolSelection — pick best tool for task
 */
class GreedyToolSelection extends ToolSelectionStrategy {
  constructor(scorer = null) {
    super();
    this.scorer = scorer || this._defaultScorer;
  }

  _defaultScorer(tool, context) {
    // Simple heuristic: score based on tool name relevance
    const taskKeywords = (context.task || '').toLowerCase().split(' ');
    const toolNameLower = tool.name.toLowerCase();
    let score = 0;

    for (const keyword of taskKeywords) {
      if (toolNameLower.includes(keyword)) score += 1.0;
    }

    return score;
  }

  async selectTool(availableTools, context = {}) {
    if (availableTools.length === 0) return null;

    let bestTool = availableTools[0];
    let bestScore = this.scorer(bestTool, context);

    for (let i = 1; i < availableTools.length; i++) {
      const score = this.scorer(availableTools[i], context);
      if (score > bestScore) {
        bestScore = score;
        bestTool = availableTools[i];
      }
    }

    return bestScore > 0 ? bestTool : availableTools[0];
  }
}

/**
 * EnsembleToolSelection — use multiple relevant tools
 */
class EnsembleToolSelection extends ToolSelectionStrategy {
  constructor(threshold = 0.3) {
    super();
    this.threshold = threshold;
  }

  async selectTool(availableTools, context = {}) {
    const taskKeywords = (context.task || '').toLowerCase().split(' ');
    const candidates = [];

    for (const tool of availableTools) {
      const toolNameLower = tool.name.toLowerCase();
      let relevance = 0;

      for (const keyword of taskKeywords) {
        if (toolNameLower.includes(keyword)) relevance += 1.0;
      }

      if (relevance / Math.max(1, taskKeywords.length) >= this.threshold) {
        candidates.push(tool);
      }
    }

    return candidates.length > 0 ? candidates : [availableTools[0]];
  }
}

/**
 * SmartAgent — orchestrates tool selection, looping, refinement
 */
class SmartAgent {
  constructor(modelDispatcher, toolRegistry, options = {}) {
    this.modelDispatcher = modelDispatcher;
    this.toolRegistry = toolRegistry;
    this.modelId = options.modelId || 'claude-3-5-sonnet';
    this.maxIterations = options.maxIterations || 15;
    this.maxRefinements = options.maxRefinements || 3;
    this.verbose = options.verbose || false;
    this.toolSelectionStrategy = options.toolSelectionStrategy || new GreedyToolSelection();
    this.approvalHandler = options.approvalHandler || null;
    this.callbackManager = options.callbackManager || null;
    this.memory = options.memory || null;
    this.tracer = options.tracer || null; // ExecutionTracer instance (optional)
    this.timeZone = options.timeZone || null; // IANA zone; falls back to DEFAULT_TIMEZONE
    this.executionHistory = [];
  }

  _log(message) {
    if (this.verbose) {
      console.log(`[SmartAgent] ${message}`);
    }
  }

  /**
   * Emit callback event
   */
  async _emitCallback(event, data) {
    if (this.callbackManager) {
      try {
        await this.callbackManager.emitter.emit(event, data);
      } catch (err) {
        console.warn(`[SmartAgent] Callback emit failed:`, err.message);
      }
    }
  }

  /**
   * Add message to memory
   */
  _recordMemory(role, content) {
    if (this.memory && this.memory.add) {
      this.memory.add({ role, content });
    }
  }

  /**
   * Decide if answer should be refined
   */
  async _shouldRefine(answer, iterationNum) {
    // Simple heuristic: refine if answer is short or uncertain
    if (answer.length < 100) {
      return { should: true, reason: 'Answer too short' };
    }

    if (answer.includes('uncertain') || answer.includes('unclear')) {
      return { should: true, reason: 'Answer expresses uncertainty' };
    }

    return { should: false, reason: 'Answer appears complete' };
  }

  /**
   * Select which tools to use
   */
  async _selectTools(goal, availableTools) {
    const selected = await this.toolSelectionStrategy.selectTool(availableTools, {
      task: goal,
    });

    return Array.isArray(selected) ? selected : [selected];
  }

  /**
   * Request approval for sensitive operations
   */
  async _requestApproval(action, context) {
    if (!this.approvalHandler) return { approved: true };

    try {
      const request = await this.approvalHandler.requestApproval({
        type: 'approval',
        title: `Approve agent action: ${action}`,
        description: `Execute: ${JSON.stringify(context, null, 2)}`,
        context,
        timeout: 300000,
        requiredBy: 'smart-agent',
      });

      return { approved: request.status === 'approved', requestId: request.id };
    } catch (err) {
      this._log(`Approval request failed: ${err.message}`);
      return { approved: false };
    }
  }

  /**
   * Main orchestration loop
   */
  async orchestrate(goal, context = {}) {
    const startTime = Date.now();
    const result = {
      success: false,
      finalAnswer: null,
      thinking: [],
      toolCalls: [],
      refinements: [],
      totalIterations: 0,
      totalRefinements: 0,
      errors: [],
      executionTime: 0,
    };

    this._log(`Starting orchestration for goal: ${goal}`);
    await this._emitCallback('agent:start', { goal });

    const messages = [{ role: 'user', content: goal }];
    let currentAnswer = null;
    let iterationNum = 0;

    try {
      // Main reasoning loop
      while (iterationNum < this.maxIterations) {
        iterationNum++;
        result.totalIterations = iterationNum;

        this._log(`Iteration ${iterationNum}/${this.maxIterations}`);

        // Get agent response
        const llmStart = Date.now();
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
        const totalTokens = (response?.usage?.input_tokens || 0) + (response?.usage?.output_tokens || 0);
        this.tracer?.recordLLMCall(this.modelId, totalTokens, 0, Date.now() - llmStart);

        const responseText = response.text || response.content;
        result.thinking.push({
          iteration: iterationNum,
          thought: responseText.slice(0, 200),
        });

        this._recordMemory('assistant', responseText);

        // Parse response for action or final answer
        const parsed = this._parseResponse(responseText);

        if (parsed.type === 'final_answer') {
          this._log('Agent has final answer');
          currentAnswer = parsed.value;

          // Attempt refinement if needed
          const refinementNeeded = await this._shouldRefine(currentAnswer, iterationNum);
          if (refinementNeeded.should && result.totalRefinements < this.maxRefinements) {
            this._log(`Refining answer: ${refinementNeeded.reason}`);
            const refined = await this._refineAnswer(currentAnswer, messages, result);
            currentAnswer = refined;
            result.totalRefinements++;
          }

          result.success = true;
          result.finalAnswer = currentAnswer;
          await this._emitCallback('agent:success', { answer: currentAnswer });
          break;
        }

        if (parsed.type === 'action') {
          const { tool: toolName, args } = parsed;
          this._log(`Selected tool: ${toolName}`);

          // Check approval for sensitive tools
          if (context.requireApprovalFor?.includes(toolName)) {
            const approval = await this._requestApproval(`Use tool: ${toolName}`, {
              tool: toolName,
              args,
            });

            if (!approval.approved) {
              messages.push({ role: 'user', content: 'Tool use rejected. Try a different approach.' });
              continue;
            }
          }

          // Execute tool
          try {
            const tool = this.toolRegistry.get(toolName);
            if (!tool) {
              throw new Error(`Tool not found: ${toolName}`);
            }

            const toolStart = Date.now();
            const toolResult = await tool.execute(args);
            const toolDuration = Date.now() - toolStart;
            this.tracer?.recordToolExecution(toolName, args, toolResult, toolDuration);

            const observation = JSON.stringify(toolResult).slice(0, 500);

            result.toolCalls.push({
              iteration: iterationNum,
              tool: toolName,
              args,
              result: observation,
            });

            messages.push({ role: 'assistant', content: responseText });
            messages.push({
              role: 'user',
              content: `Observation from ${toolName}: ${observation}`,
            });

            this._recordMemory('user', `Tool result: ${observation}`);

            await this._emitCallback('tool:executed', {
              tool: toolName,
              success: true,
            });
          } catch (err) {
            this._log(`Tool execution failed: ${err.message}`);
            result.errors.push(`${toolName}: ${err.message}`);
            this.tracer?.recordToolExecution(toolName, args, null, 0);

            messages.push({ role: 'assistant', content: responseText });
            messages.push({
              role: 'user',
              content: `Error: ${err.message}. Try a different tool.`,
            });

            await this._emitCallback('tool:executed', {
              tool: toolName,
              success: false,
              error: err.message,
            });
          }
        } else {
          // Just thought, continue
          messages.push({ role: 'assistant', content: responseText });
        }
      }

      if (!result.success) {
        result.finalAnswer = currentAnswer || 'Could not reach final answer';
      }
    } catch (err) {
      this._log(`Orchestration failed: ${err.message}`);
      result.errors.push(err.message);
      result.success = false;
      await this._emitCallback('agent:error', { error: err.message });
    }

    result.executionTime = Date.now() - startTime;
    return result;
  }

  /**
   * Refine answer through iterative improvement
   */
  async _refineAnswer(currentAnswer, messages, result) {
    this._log('Starting answer refinement');

    for (let i = 0; i < this.maxRefinements; i++) {
      const refinementPrompt = `The current answer is:\n\n${currentAnswer}\n\nPlease improve this answer by providing more detail, clarity, or completeness.`;

      messages.push({ role: 'user', content: refinementPrompt });

      try {
        const response = await this.modelDispatcher.dispatch({
          modelId: this.modelId,
          messages: [
            {
              role: 'system',
              content: 'You are an expert at refining and improving answers. Make the answer more comprehensive and clear.',
            },
            ...messages,
          ],
          temperature: 0.7,
        });

        const refinedAnswer = response.text || response.content;
        result.refinements.push({
          iteration: i + 1,
          before: currentAnswer.slice(0, 100),
          after: refinedAnswer.slice(0, 100),
        });

        messages.push({ role: 'assistant', content: refinedAnswer });
        currentAnswer = refinedAnswer;

        this._log(`Refinement ${i + 1} completed`);
      } catch (err) {
        this._log(`Refinement failed: ${err.message}`);
        break;
      }
    }

    return currentAnswer;
  }

  /**
   * Build system prompt
   */
  _buildSystemPrompt() {
    const tools = this.toolRegistry.list();
    const toolDescriptions = tools
      .map((tool) => `- ${tool.name}: ${tool.description}`)
      .join('\n');

    return `You are an intelligent agent that solves problems by thinking step-by-step and using available tools when needed.

Available tools:
${toolDescriptions}

When you need to use a tool, respond with JSON: {"tool": "tool_name", "args": {...}}
When you have the final answer, respond with: {"final_answer": "Your answer here"}

Think carefully. Use tools strategically. Provide the best possible answer.

${buildTemporalSystemBlock({ requestTimeZone: this.timeZone })}`;
  }

  /**
   * Parse response to extract action or final answer
   */
  _parseResponse(response) {
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
}

/**
 * ReActLoop — Structured ReAct pattern with refinement
 */
class ReActLoop {
  constructor(modelDispatcher, toolRegistry, options = {}) {
    this.modelDispatcher = modelDispatcher;
    this.toolRegistry = toolRegistry;
    this.maxSteps = options.maxSteps || 10;
    this.refineOnCompletion = options.refineOnCompletion !== false;
    this.maxRefinements = options.maxRefinements || 2;
    this.verbose = options.verbose || false;
    this.callbackManager = options.callbackManager || null;
  }

  _log(message) {
    if (this.verbose) {
      console.log(`[ReActLoop] ${message}`);
    }
  }

  /**
   * Execute ReAct loop
   */
  async execute(goal, context = {}) {
    const result = {
      success: false,
      finalAnswer: null,
      steps: [],
      totalSteps: 0,
      refinements: [],
      errors: [],
    };

    this._log(`Starting ReAct loop for: ${goal}`);

    const toolDescriptions = this.toolRegistry.list()
      .map((t) => `- ${t.name}: ${t.description}`)
      .join('\n');

    let thought = '';
    let stepNum = 0;

    for (stepNum = 0; stepNum < this.maxSteps; stepNum++) {
      result.totalSteps = stepNum + 1;

      this._log(`Step ${stepNum + 1}/${this.maxSteps}`);

      // 1. THOUGHT
      if (stepNum === 0) {
        thought = `I need to ${goal}`;
      } else {
        const response = await this.modelDispatcher.dispatch({
          modelId: 'claude-3-5-sonnet',
          messages: [
            {
              role: 'user',
              content: `Goal: ${goal}\n\nPrevious steps:\n${result.steps.map((s) => `Step ${s.stepNum}: ${s.thought}`).join('\n')}\n\nWhat should I think about next?`,
            },
          ],
          temperature: 0.7,
        });

        thought = response.text || response.content;
      }

      result.steps.push({ stepNum: stepNum + 1, type: 'thought', thought });
      this._log(`Thought: ${thought.slice(0, 100)}`);

      // 2. ACTION
      const actionResponse = await this.modelDispatcher.dispatch({
        modelId: 'claude-3-5-sonnet',
        messages: [
          {
            role: 'user',
            content: `Based on this thought: "${thought}"\n\nWhich tool should I use? Choose from:\n${toolDescriptions}\n\nRespond with JSON: {"tool": "name", "args": {...}} or {"final_answer": "answer"}`,
          },
        ],
        temperature: 0.5,
      });

      const actionText = actionResponse.text || actionResponse.content;
      const jsonMatch = actionText.match(/\{[\s\S]*\}/);

      if (!jsonMatch) {
        continue;
      }

      try {
        const action = JSON.parse(jsonMatch[0]);

        if (action.final_answer) {
          result.finalAnswer = action.final_answer;
          result.steps.push({
            stepNum: stepNum + 1,
            type: 'final_answer',
            answer: action.final_answer,
          });
          this._log(`Final answer: ${action.final_answer.slice(0, 100)}`);
          result.success = true;
          break;
        }

        if (action.tool && action.args) {
          result.steps.push({
            stepNum: stepNum + 1,
            type: 'action',
            tool: action.tool,
            args: action.args,
          });

          // 3. OBSERVATION
          try {
            const tool = this.toolRegistry.get(action.tool);
            if (!tool) throw new Error(`Tool not found: ${action.tool}`);

            const observation = await tool.execute(action.args);
            const obsText = JSON.stringify(observation).slice(0, 300);

            result.steps.push({
              stepNum: stepNum + 1,
              type: 'observation',
              observation: obsText,
            });

            this._log(`Observation: ${obsText}`);
          } catch (err) {
            result.errors.push(`${action.tool}: ${err.message}`);
            result.steps.push({
              stepNum: stepNum + 1,
              type: 'observation',
              observation: `Error: ${err.message}`,
            });

            this._log(`Tool error: ${err.message}`);
          }
        }
      } catch (err) {
        this._log(`Action parsing failed: ${err.message}`);
        result.errors.push(err.message);
      }
    }

    // Refinement phase
    if (result.success && this.refineOnCompletion) {
      this._log('Starting refinement phase');

      for (let i = 0; i < this.maxRefinements; i++) {
        try {
          const refineResponse = await this.modelDispatcher.dispatch({
            modelId: 'claude-3-5-sonnet',
            messages: [
              {
                role: 'user',
                content: `Improve this answer: ${result.finalAnswer}`,
              },
            ],
            temperature: 0.7,
          });

          const refined = refineResponse.text || refineResponse.content;
          result.refinements.push({ iteration: i + 1, before: result.finalAnswer, after: refined });
          result.finalAnswer = refined;

          this._log(`Refinement ${i + 1} completed`);
        } catch (err) {
          this._log(`Refinement failed: ${err.message}`);
          break;
        }
      }
    }

    return result;
  }
}

/**
 * AgentOrchestrator — coordinates multiple agents
 */
class AgentOrchestrator {
  constructor(options = {}) {
    this.agents = new Map(); // name → agent
    this.workflows = new Map(); // name → workflow
    this.sharedState = options.sharedState || {};
    this.verbose = options.verbose || false;
  }

  _log(message) {
    if (this.verbose) {
      console.log(`[AgentOrchestrator] ${message}`);
    }
  }

  /**
   * Register agent
   */
  registerAgent(name, agent) {
    this.agents.set(name, agent);
    return this;
  }

  /**
   * Get agent
   */
  getAgent(name) {
    return this.agents.get(name);
  }

  /**
   * Execute agent
   */
  async executeAgent(agentName, input, context = {}) {
    const agent = this.getAgent(agentName);
    if (!agent) throw new Error(`Agent not found: ${agentName}`);

    this._log(`Executing agent: ${agentName}`);

    try {
      const result = await agent.orchestrate(input, {
        ...context,
        sharedState: this.sharedState,
      });

      // Update shared state
      if (result.state) {
        this.sharedState = { ...this.sharedState, ...result.state };
      }

      return result;
    } catch (err) {
      this._log(`Agent execution failed: ${err.message}`);
      throw err;
    }
  }

  /**
   * Chain agents (output of one becomes input to next)
   */
  async executeChain(agentNames, initialInput, context = {}) {
    this._log(`Executing agent chain: ${agentNames.join(' → ')}`);

    let currentInput = initialInput;
    const results = [];

    for (const agentName of agentNames) {
      try {
        const result = await this.executeAgent(agentName, currentInput, context);
        results.push(result);
        currentInput = result.finalAnswer;
      } catch (err) {
        this._log(`Chain broken at ${agentName}: ${err.message}`);
        return {
          success: false,
          error: err.message,
          completedAgents: results.length,
          results,
        };
      }
    }

    return {
      success: true,
      finalAnswer: currentInput,
      results,
    };
  }
}

module.exports = {
  ToolSelectionStrategy,
  GreedyToolSelection,
  EnsembleToolSelection,
  SmartAgent,
  ReActLoop,
  AgentOrchestrator,
};
