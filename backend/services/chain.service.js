// ============================================================
// FILE: backend/services/chain.service.js
// PURPOSE: Formal chain primitives for sequential operations
//          - SimpleChain: linear execution
//          - ConditionalChain: branching logic
//          - ParallelChain: concurrent execution
//          - ChainComposer: combine chains
// ============================================================

/**
 * ChainStep — single operation in a chain
 */
class ChainStep {
  constructor(name, fn, options = {}) {
    this.name = name;
    this.fn = fn;
    this.retries = options.retries || 0;
    this.timeout = options.timeout || null;
    this.onError = options.onError || null;
    this.metadata = options.metadata || {};
  }

  async execute(input, context = {}) {
    let lastError;

    for (let attempt = 0; attempt <= this.retries; attempt++) {
      try {
        const fn = this.fn;

        // Execute with optional timeout
        if (this.timeout) {
          return await Promise.race([
            fn(input, context),
            new Promise((_, reject) =>
              setTimeout(() => reject(new Error(`Step timeout: ${this.timeout}ms`)), this.timeout)
            ),
          ]);
        }

        return await fn(input, context);
      } catch (err) {
        lastError = err;

        if (attempt < this.retries) {
          console.warn(`[Chain] Step "${this.name}" failed, retrying (${attempt + 1}/${this.retries})...`);
        }
      }
    }

    throw lastError;
  }
}

/**
 * ChainResult — output of chain execution
 */
class ChainResult {
  constructor() {
    this.success = false;
    this.data = null;
    this.steps = [];
    this.errors = [];
    this.totalTime = 0;
  }

  addStep(name, result, duration) {
    this.steps.push({
      name,
      result,
      duration,
      timestamp: new Date().toISOString(),
    });
  }

  addError(stepName, error) {
    this.errors.push({
      step: stepName,
      error: error.message,
      timestamp: new Date().toISOString(),
    });
  }

  setSuccess(data) {
    this.success = true;
    this.data = data;
  }

  setFailure() {
    this.success = false;
  }
}

/**
 * Base Chain interface
 */
class Chain {
  constructor(options = {}) {
    this.name = options.name || 'chain';
    this.verbose = options.verbose || false;
    this.steps = [];
    this.approvalHandler = options.approvalHandler || null;
    this.requireApprovalFor = options.requireApprovalFor || []; // step names
  }

  add(name, fn, options = {}) {
    const step = new ChainStep(name, fn, options);
    this.steps.push(step);
    return this; // for chaining
  }

  setApprovalHandler(handler) {
    this.approvalHandler = handler;
    return this;
  }

  addApprovalRequirement(stepName) {
    this.requireApprovalFor.push(stepName);
    return this;
  }

  async run(input, context = {}) {
    throw new Error('run() not implemented');
  }

  _log(message) {
    if (this.verbose) {
      console.log(`[Chain] ${this.name}: ${message}`);
    }
  }
}

/**
 * SimpleChain — linear sequential execution
 * input → step1 → step2 → step3 → output
 */
class SimpleChain extends Chain {
  async run(input, context = {}) {
    const result = new ChainResult();
    const startTime = Date.now();
    let currentInput = input;

    this._log('Starting chain execution');

    for (const step of this.steps) {
      const stepStart = Date.now();

      try {
        this._log(`Executing step: ${step.name}`);

        // Check if approval required
        if (
          this.requireApprovalFor.includes(step.name) &&
          this.approvalHandler
        ) {
          const request = await this.approvalHandler.requestApproval({
            type: 'approval',
            title: `Approve chain step: ${step.name}`,
            description: `Execute step "${step.name}" with input:\n${JSON.stringify(currentInput, null, 2)}`,
            context: { step: step.name, input: currentInput },
            timeout: 300000,
            requiredBy: `chain-step-${step.name}`,
          });

          if (request.status === 'rejected') {
            result.addError(step.name, new Error(`Step rejected by user: ${request.reason}`));
            result.setFailure();
            result.totalTime = Date.now() - startTime;
            return result;
          }
        }

        const output = await step.execute(currentInput, context);

        const duration = Date.now() - stepStart;
        result.addStep(step.name, output, duration);
        this._log(`Step "${step.name}" completed in ${duration}ms`);

        // Output becomes input for next step
        currentInput = output;
      } catch (err) {
        this._log(`Step "${step.name}" failed: ${err.message}`);
        result.addError(step.name, err);
        result.setFailure();

        // Handle error if handler provided
        if (step.onError) {
          try {
            currentInput = await step.onError(err, currentInput, context);
            this._log(`Step "${step.name}" error handler executed`);
          } catch (handlerErr) {
            this._log(`Error handler failed: ${handlerErr.message}`);
            result.totalTime = Date.now() - startTime;
            return result;
          }
        } else {
          // Stop chain on error
          result.totalTime = Date.now() - startTime;
          return result;
        }
      }
    }

    result.setSuccess(currentInput);
    result.totalTime = Date.now() - startTime;
    this._log(`Chain completed successfully in ${result.totalTime}ms`);

    return result;
  }
}

/**
 * ConditionalChain — branching logic (if/else)
 * condition(input) → true? branch1 : branch2
 */
class ConditionalChain extends Chain {
  constructor(options = {}) {
    super(options);
    this.condition = options.condition || null;
    this.trueBranch = null;
    this.falseBranch = null;
  }

  setCondition(fn) {
    this.condition = fn;
    return this;
  }

  setTrueBranch(chain) {
    this.trueBranch = chain;
    return this;
  }

  setFalseBranch(chain) {
    this.falseBranch = chain;
    return this;
  }

  async run(input, context = {}) {
    const result = new ChainResult();
    const startTime = Date.now();

    this._log('Evaluating condition');

    try {
      const conditionResult = await this.condition(input, context);

      this._log(`Condition evaluated to: ${conditionResult}`);

      const selectedBranch = conditionResult ? this.trueBranch : this.falseBranch;

      if (!selectedBranch) {
        throw new Error(`No branch defined for condition result: ${conditionResult}`);
      }

      const branchResult = await selectedBranch.run(input, context);

      result.success = branchResult.success;
      result.data = branchResult.data;
      result.steps = branchResult.steps;
      result.errors = branchResult.errors;
    } catch (err) {
      this._log(`Condition evaluation failed: ${err.message}`);
      result.addError('condition', err);
      result.setFailure();
    }

    result.totalTime = Date.now() - startTime;
    return result;
  }
}

/**
 * ParallelChain — concurrent execution
 * Runs multiple chains in parallel, waits for all
 */
class ParallelChain extends Chain {
  constructor(options = {}) {
    super(options);
    this.chains = [];
  }

  addChain(name, chain) {
    this.chains.push({ name, chain });
    return this;
  }

  async run(input, context = {}) {
    const result = new ChainResult();
    const startTime = Date.now();

    this._log(`Starting ${this.chains.length} parallel chains`);

    try {
      // Execute all chains in parallel
      const promises = this.chains.map(async ({ name, chain }) => {
        const chainResult = await chain.run(input, context);
        return {
          name,
          ...chainResult,
        };
      });

      const allResults = await Promise.all(promises);

      // Aggregate results
      const aggregated = {};
      let allSuccess = true;

      for (const chainResult of allResults) {
        const { name, success, data, errors } = chainResult;
        aggregated[name] = { success, data };

        if (!success) {
          allSuccess = false;
          result.addError(name, new Error(`Chain "${name}" failed`));
        }

        // Combine steps from all chains
        result.steps.push(...(chainResult.steps || []));
      }

      if (allSuccess) {
        result.setSuccess(aggregated);
      } else {
        result.setFailure();
      }

      this._log(`All ${this.chains.length} chains completed`);
    } catch (err) {
      this._log(`Parallel execution failed: ${err.message}`);
      result.addError('parallel', err);
      result.setFailure();
    }

    result.totalTime = Date.now() - startTime;
    return result;
  }
}

/**
 * ChainComposer — compose multiple chains into one
 * chain1 → chain2 → chain3
 */
class ChainComposer extends Chain {
  constructor(options = {}) {
    super(options);
    this.composedChains = [];
  }

  pipe(chain) {
    this.composedChains.push(chain);
    return this;
  }

  async run(input, context = {}) {
    const result = new ChainResult();
    const startTime = Date.now();

    this._log(`Composing ${this.composedChains.length} chains`);

    let currentInput = input;

    for (let i = 0; i < this.composedChains.length; i++) {
      const chain = this.composedChains[i];

      try {
        this._log(`Running composed chain ${i + 1}/${this.composedChains.length}`);

        const chainResult = await chain.run(currentInput, context);

        result.steps.push(...chainResult.steps);

        if (!chainResult.success) {
          result.addError(`chain_${i + 1}`, new Error(`Composed chain ${i + 1} failed`));
          result.errors.push(...chainResult.errors);
          result.setFailure();
          break;
        }

        currentInput = chainResult.data;
      } catch (err) {
        this._log(`Composed chain ${i + 1} failed: ${err.message}`);
        result.addError(`chain_${i + 1}`, err);
        result.setFailure();
        break;
      }
    }

    if (result.success) {
      result.setSuccess(currentInput);
    }

    result.totalTime = Date.now() - startTime;
    return result;
  }
}

/**
 * MapChain — apply same operation to array of items
 * [item1, item2, item3] → [result1, result2, result3]
 */
class MapChain extends Chain {
  constructor(options = {}) {
    super(options);
    this.mapFn = options.mapFn || null;
    this.parallel = options.parallel !== false;
  }

  async run(input, context = {}) {
    const result = new ChainResult();
    const startTime = Date.now();

    if (!Array.isArray(input)) {
      result.addError('map', new Error('Input must be an array'));
      result.totalTime = Date.now() - startTime;
      return result;
    }

    this._log(`Mapping over ${input.length} items (${this.parallel ? 'parallel' : 'sequential'})`);

    try {
      let results;

      if (this.parallel) {
        results = await Promise.all(
          input.map((item, idx) => this.mapFn(item, { ...context, index: idx }))
        );
      } else {
        results = [];
        for (let i = 0; i < input.length; i++) {
          const mapResult = await this.mapFn(input[i], { ...context, index: i });
          results.push(mapResult);
        }
      }

      result.setSuccess(results);
      this._log(`Mapping completed: ${results.length} items processed`);
    } catch (err) {
      this._log(`Mapping failed: ${err.message}`);
      result.addError('map', err);
      result.setFailure();
    }

    result.totalTime = Date.now() - startTime;
    return result;
  }
}

/**
 * LoopChain — execute steps in a cycle with exit conditions
 */
class LoopChain extends Chain {
  constructor(options = {}) {
    super(options);
    this.maxCycles = options.maxCycles || 5;
    this.loopCondition = options.loopCondition || null; // (output, cycleNum) => boolean
    this.exitConditions = []; // functions that return true to break loop
  }

  addExitCondition(condition) {
    this.exitConditions.push(condition);
    return this;
  }

  async run(input, context = {}) {
    const result = new ChainResult();
    const startTime = Date.now();
    let currentInput = input;
    let cycleNum = 0;

    this._log(`Starting loop chain (max ${this.maxCycles} cycles)`);

    while (cycleNum < this.maxCycles) {
      cycleNum++;
      const cycleStart = Date.now();

      this._log(`Cycle ${cycleNum}/${this.maxCycles}`);

      try {
        // Execute all steps in cycle
        for (const step of this.steps) {
          this._log(`  Step: ${step.name}`);

          try {
            const output = await step.execute(currentInput, context);
            const duration = Date.now() - cycleStart;
            result.addStep(`${step.name} (cycle ${cycleNum})`, output, duration);

            currentInput = output;
          } catch (err) {
            this._log(`  Step "${step.name}" failed: ${err.message}`);
            result.addError(step.name, err);
            result.setFailure();
            result.totalTime = Date.now() - startTime;
            return result;
          }
        }

        // Check exit conditions
        for (const exitCondition of this.exitConditions) {
          try {
            const shouldExit = await exitCondition(currentInput, cycleNum, context);
            if (shouldExit) {
              this._log(`Exit condition met at cycle ${cycleNum}`);
              result.setSuccess(currentInput);
              result.totalTime = Date.now() - startTime;
              return result;
            }
          } catch (err) {
            this._log(`Exit condition check failed: ${err.message}`);
          }
        }

        // Check loop condition
        if (this.loopCondition) {
          const shouldContinue = await this.loopCondition(currentInput, cycleNum, context);
          if (!shouldContinue) {
            this._log(`Loop condition returned false at cycle ${cycleNum}`);
            result.setSuccess(currentInput);
            result.totalTime = Date.now() - startTime;
            return result;
          }
        }
      } catch (err) {
        this._log(`Cycle ${cycleNum} failed: ${err.message}`);
        result.addError(`cycle-${cycleNum}`, err);
        result.setFailure();
        result.totalTime = Date.now() - startTime;
        return result;
      }
    }

    this._log(`Max cycles reached`);
    result.setSuccess(currentInput);
    result.totalTime = Date.now() - startTime;
    return result;
  }
}

/**
 * Factory function — create chain by type
 */
const createChain = (type = 'simple', options = {}) => {
  if (type === 'simple') {
    return new SimpleChain(options);
  }

  if (type === 'conditional') {
    return new ConditionalChain(options);
  }

  if (type === 'parallel') {
    return new ParallelChain(options);
  }

  if (type === 'composer') {
    return new ChainComposer(options);
  }

  if (type === 'map') {
    return new MapChain(options);
  }

  if (type === 'loop') {
    return new LoopChain(options);
  }

  throw new Error(`Unknown chain type: ${type}`);
};

module.exports = {
  Chain,
  ChainStep,
  ChainResult,
  SimpleChain,
  ConditionalChain,
  ParallelChain,
  ChainComposer,
  MapChain,
  LoopChain,
  createChain,
};
