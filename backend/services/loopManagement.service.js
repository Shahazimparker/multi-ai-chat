// ============================================================
// FILE: backend/services/loopManagement.service.js
// PURPOSE: Cycle/loop management for workflows
//          - Loop definitions and execution
//          - Cycle counters and exit conditions
//          - Refinement patterns (agent loops)
//          - Query/validation loops
//          - State preservation across cycles
// ============================================================

/**
 * CycleCounter — tracks iterations through a loop
 */
class CycleCounter {
  constructor(maxCycles = 10) {
    this.current = 0;
    this.max = maxCycles;
    this.history = [];
  }

  increment() {
    this.current++;
    this.history.push({
      cycle: this.current,
      timestamp: new Date().toISOString(),
    });
    return this.current;
  }

  isBelowMax() {
    return this.current < this.max;
  }

  isAtMax() {
    return this.current >= this.max;
  }

  reset() {
    this.current = 0;
    this.history = [];
  }

  getHistory() {
    return this.history;
  }

  toJSON() {
    return {
      current: this.current,
      max: this.max,
      history: this.history,
    };
  }
}

/**
 * LoopBreaker — condition for exiting a loop
 */
class LoopBreaker {
  constructor(condition, reason = '') {
    this.condition = condition; // async (output, cycleNum) => boolean
    this.reason = reason;
  }

  async shouldBreak(output, cycleNum) {
    try {
      return await this.condition(output, cycleNum);
    } catch (err) {
      console.error('[LoopBreaker] Error evaluating condition:', err.message);
      return false;
    }
  }
}

/**
 * LoopConfig — defines a loop structure
 */
class LoopConfig {
  constructor(options = {}) {
    this.name = options.name || 'unnamed_loop';
    this.type = options.type || 'while'; // while, do-while, repeat-until
    this.maxCycles = options.maxCycles || 10;
    this.body = options.body || null; // async function to execute in loop
    this.condition = options.condition || null; // async () => boolean, determines if loop continues
    this.breakers = options.breakers || []; // LoopBreaker instances
    this.onCycleStart = options.onCycleStart || null;
    this.onCycleEnd = options.onCycleEnd || null;
    this.metadata = options.metadata || {};
  }

  addBreaker(breaker) {
    if (typeof breaker === 'function') {
      this.breakers.push(new LoopBreaker(breaker));
    } else {
      this.breakers.push(breaker);
    }
    return this;
  }

  toJSON() {
    return {
      name: this.name,
      type: this.type,
      maxCycles: this.maxCycles,
      breakers: this.breakers.length,
      metadata: this.metadata,
    };
  }
}

/**
 * LoopResult — output of loop execution
 */
class LoopResult {
  constructor(loopName) {
    this.loopName = loopName;
    this.success = false;
    this.finalOutput = null;
    this.cycles = [];
    this.totalCycles = 0;
    this.breakReason = null;
    this.error = null;
    this.startTime = new Date().toISOString();
    this.endTime = null;
    this.duration = 0;
  }

  addCycle(cycleNum, input, output, duration) {
    this.cycles.push({
      cycleNum,
      input,
      output,
      duration,
      timestamp: new Date().toISOString(),
    });
    this.totalCycles = cycleNum;
  }

  complete(output, breakReason = null) {
    this.success = true;
    this.finalOutput = output;
    this.breakReason = breakReason;
    this.endTime = new Date().toISOString();
    this.duration = new Date(this.endTime) - new Date(this.startTime);
  }

  fail(error) {
    this.success = false;
    this.error = error.message;
    this.endTime = new Date().toISOString();
    this.duration = new Date(this.endTime) - new Date(this.startTime);
  }

  getCycleHistory() {
    return this.cycles.map((c) => ({
      cycle: c.cycleNum,
      output: typeof c.output === 'object' ? '[object]' : String(c.output),
      duration: c.duration,
    }));
  }

  toJSON() {
    return {
      loopName: this.loopName,
      success: this.success,
      totalCycles: this.totalCycles,
      breakReason: this.breakReason,
      error: this.error,
      duration: this.duration,
      cycleHistory: this.getCycleHistory(),
    };
  }
}

/**
 * LoopExecutor — executes loops with state management
 */
class LoopExecutor {
  constructor(options = {}) {
    this.verbose = options.verbose || false;
  }

  _log(message) {
    if (this.verbose) {
      console.log(`[LoopExecutor] ${message}`);
    }
  }

  /**
   * Execute a loop
   */
  async execute(loopConfig, initialInput, context = {}) {
    if (!(loopConfig instanceof LoopConfig)) {
      throw new Error('loopConfig must be a LoopConfig instance');
    }

    const result = new LoopResult(loopConfig.name);
    const counter = new CycleCounter(loopConfig.maxCycles);
    let currentOutput = initialInput;

    this._log(`Starting loop: ${loopConfig.name} (max ${loopConfig.maxCycles} cycles)`);

    try {
      while (counter.isBelowMax()) {
        const cycleNum = counter.increment();
        const cycleStart = Date.now();

        this._log(`Cycle ${cycleNum}/${loopConfig.maxCycles}`);

        try {
          // Call cycle start hook
          if (loopConfig.onCycleStart) {
            await loopConfig.onCycleStart(cycleNum, currentOutput, context);
          }

          // Execute loop body
          if (!loopConfig.body) {
            throw new Error('Loop body not defined');
          }

          const cycleOutput = await loopConfig.body(currentOutput, cycleNum, context);
          const cycleDuration = Date.now() - cycleStart;

          result.addCycle(cycleNum, currentOutput, cycleOutput, cycleDuration);
          currentOutput = cycleOutput;

          // Call cycle end hook
          if (loopConfig.onCycleEnd) {
            await loopConfig.onCycleEnd(cycleNum, cycleOutput, context);
          }

          // Check breakers
          let shouldBreak = false;
          let breakReason = null;

          for (const breaker of loopConfig.breakers) {
            if (await breaker.shouldBreak(cycleOutput, cycleNum)) {
              shouldBreak = true;
              breakReason = breaker.reason || `Breaker triggered at cycle ${cycleNum}`;
              this._log(`Loop broken: ${breakReason}`);
              break;
            }
          }

          if (shouldBreak) {
            result.complete(cycleOutput, breakReason);
            return result;
          }

          // Check continue condition
          if (loopConfig.condition) {
            const shouldContinue = await loopConfig.condition(cycleOutput, cycleNum, context);
            if (!shouldContinue) {
              result.complete(cycleOutput, 'Condition returned false');
              return result;
            }
          }
        } catch (err) {
          this._log(`Cycle ${cycleNum} failed: ${err.message}`);
          result.fail(err);
          return result;
        }
      }

      // Max cycles reached
      result.complete(currentOutput, `Max cycles (${loopConfig.maxCycles}) reached`);
      return result;
    } catch (err) {
      this._log(`Loop execution failed: ${err.message}`);
      result.fail(err);
      return result;
    }
  }
}

/**
 * RefinementLoop — agent refines answer in cycles
 */
class RefinementLoop {
  constructor(options = {}) {
    this.maxRefinements = options.maxRefinements || 3;
    this.refiner = options.refiner || null; // async (current, feedback) => refined
    this.validator = options.validator || null; // async (output) => { valid, feedback }
    this.verbose = options.verbose || false;
  }

  _log(message) {
    if (this.verbose) {
      console.log(`[RefinementLoop] ${message}`);
    }
  }

  /**
   * Execute refinement loop
   */
  async refine(initialAnswer, context = {}) {
    const result = new LoopResult('refinement');
    let currentAnswer = initialAnswer;
    let refinementNum = 0;

    this._log('Starting refinement loop');

    for (let i = 0; i < this.maxRefinements; i++) {
      refinementNum++;
      const cycleStart = Date.now();

      try {
        // Validate current answer
        if (this.validator) {
          const validation = await this.validator(currentAnswer, context);

          result.addCycle(refinementNum, currentAnswer, currentAnswer, Date.now() - cycleStart);

          if (validation.valid) {
            this._log(`Answer validated at refinement ${refinementNum}`);
            result.complete(currentAnswer, 'Validation passed');
            return result;
          }

          // Use feedback for next refinement
          if (this.refiner && validation.feedback) {
            this._log(`Refining based on feedback: ${validation.feedback.slice(0, 100)}`);
            currentAnswer = await this.refiner(currentAnswer, validation.feedback, context);
          }
        } else if (this.refiner) {
          // No validator, just refine
          currentAnswer = await this.refiner(currentAnswer, null, context);
          result.addCycle(refinementNum, currentAnswer, currentAnswer, Date.now() - cycleStart);
        }
      } catch (err) {
        this._log(`Refinement cycle ${refinementNum} failed: ${err.message}`);
        result.fail(err);
        return result;
      }
    }

    result.complete(currentAnswer, `Max refinements (${this.maxRefinements}) reached`);
    return result;
  }
}

/**
 * QueryLoop — retry query with refinement
 */
class QueryLoop {
  constructor(options = {}) {
    this.maxRetries = options.maxRetries || 3;
    this.queryFn = options.queryFn || null; // async (params) => result
    this.shouldRetry = options.shouldRetry || null; // async (result) => boolean
    this.refineQuery = options.refineQuery || null; // async (query, lastResult) => refinedQuery
    this.verbose = options.verbose || false;
  }

  _log(message) {
    if (this.verbose) {
      console.log(`[QueryLoop] ${message}`);
    }
  }

  /**
   * Execute query with retries
   */
  async execute(initialQuery, context = {}) {
    const result = new LoopResult('query');
    let currentQuery = initialQuery;
    let attempt = 0;
    let lastResult = null;

    this._log('Starting query loop');

    for (attempt = 0; attempt < this.maxRetries; attempt++) {
      const cycleStart = Date.now();

      try {
        this._log(`Query attempt ${attempt + 1}/${this.maxRetries}`);

        const queryResult = await this.queryFn(currentQuery, context);
        lastResult = queryResult;

        result.addCycle(attempt + 1, currentQuery, queryResult, Date.now() - cycleStart);

        // Check if should retry
        if (this.shouldRetry) {
          const needsRetry = await this.shouldRetry(queryResult, attempt + 1, context);

          if (!needsRetry) {
            this._log(`Query succeeded at attempt ${attempt + 1}`);
            result.complete(queryResult, 'Query returned valid result');
            return result;
          }

          // Refine query for next attempt
          if (this.refineQuery) {
            this._log(`Refining query for next attempt`);
            currentQuery = await this.refineQuery(currentQuery, queryResult, context);
          }
        } else {
          // No retry check, assume success
          result.complete(queryResult, 'Query completed');
          return result;
        }
      } catch (err) {
        this._log(`Query attempt ${attempt + 1} failed: ${err.message}`);

        // Refine query for retry
        if (this.refineQuery && attempt < this.maxRetries - 1) {
          this._log(`Refining query after error`);
          currentQuery = await this.refineQuery(currentQuery, err, context);
        } else if (attempt === this.maxRetries - 1) {
          result.fail(err);
          return result;
        }
      }
    }

    result.complete(lastResult, `Max retries (${this.maxRetries}) reached`);
    return result;
  }
}

/**
 * ValidationLoop — validate output, retry on failure
 */
class ValidationLoop {
  constructor(options = {}) {
    this.maxAttempts = options.maxAttempts || 3;
    this.validator = options.validator || null; // async (output) => { valid, errors, suggestions }
    this.fixer = options.fixer || null; // async (output, errors) => fixed
    this.verbose = options.verbose || false;
  }

  _log(message) {
    if (this.verbose) {
      console.log(`[ValidationLoop] ${message}`);
    }
  }

  /**
   * Execute validation loop
   */
  async validate(initialOutput, context = {}) {
    const result = new LoopResult('validation');
    let currentOutput = initialOutput;
    let attempt = 0;

    this._log('Starting validation loop');

    for (attempt = 0; attempt < this.maxAttempts; attempt++) {
      const cycleStart = Date.now();

      try {
        this._log(`Validation attempt ${attempt + 1}/${this.maxAttempts}`);

        const validation = await this.validator(currentOutput, context);

        result.addCycle(attempt + 1, currentOutput, currentOutput, Date.now() - cycleStart);

        if (validation.valid) {
          this._log(`Output validated at attempt ${attempt + 1}`);
          result.complete(currentOutput, 'Validation passed');
          return result;
        }

        // Try to fix
        if (this.fixer && validation.errors) {
          this._log(`Fixing output: ${validation.errors.join(', ')}`);
          currentOutput = await this.fixer(currentOutput, validation.errors, context);
        } else {
          // Can't fix, return failure
          result.complete(currentOutput, `Validation failed: ${validation.errors.join(', ')}`);
          return result;
        }
      } catch (err) {
        this._log(`Validation attempt ${attempt + 1} failed: ${err.message}`);
        result.fail(err);
        return result;
      }
    }

    result.complete(currentOutput, `Max attempts (${this.maxAttempts}) reached`);
    return result;
  }
}

/**
 * PipelineLoop — chain operations in cycles
 */
class PipelineLoop {
  constructor(options = {}) {
    this.steps = options.steps || []; // [{ name, fn, validator }]
    this.maxCycles = options.maxCycles || 5;
    this.exitOnStepFailure = options.exitOnStepFailure !== false;
    this.verbose = options.verbose || false;
  }

  _log(message) {
    if (this.verbose) {
      console.log(`[PipelineLoop] ${message}`);
    }
  }

  addStep(name, fn, validator = null) {
    this.steps.push({ name, fn, validator });
    return this;
  }

  /**
   * Execute pipeline in cycles
   */
  async execute(initialInput, context = {}) {
    const result = new LoopResult('pipeline');
    let currentOutput = initialInput;
    let cycleNum = 0;

    this._log('Starting pipeline loop');

    for (let cycle = 0; cycle < this.maxCycles; cycle++) {
      cycleNum++;
      const cycleStart = Date.now();
      let cycleOutput = currentOutput;

      try {
        this._log(`Cycle ${cycleNum}/${this.maxCycles}`);

        // Execute each step
        for (const step of this.steps) {
          try {
            this._log(`  Step: ${step.name}`);
            cycleOutput = await step.fn(cycleOutput, context);

            // Validate step output
            if (step.validator) {
              const validation = await step.validator(cycleOutput, context);
              if (!validation.valid && this.exitOnStepFailure) {
                result.addCycle(cycleNum, currentOutput, cycleOutput, Date.now() - cycleStart);
                result.complete(cycleOutput, `Step "${step.name}" validation failed`);
                return result;
              }
            }
          } catch (err) {
            this._log(`  Step "${step.name}" failed: ${err.message}`);
            if (this.exitOnStepFailure) {
              result.fail(err);
              return result;
            }
          }
        }

        result.addCycle(cycleNum, currentOutput, cycleOutput, Date.now() - cycleStart);
        currentOutput = cycleOutput;
      } catch (err) {
        this._log(`Cycle ${cycleNum} failed: ${err.message}`);
        result.fail(err);
        return result;
      }
    }

    result.complete(currentOutput, `Completed ${cycleNum} cycles`);
    return result;
  }
}

module.exports = {
  CycleCounter,
  LoopBreaker,
  LoopConfig,
  LoopResult,
  LoopExecutor,
  RefinementLoop,
  QueryLoop,
  ValidationLoop,
  PipelineLoop,
};
