const { Worker } = require('worker_threads');

const MAX_EXEC_MS = 2000;
const MAX_CODE_LENGTH = 5000;

const executeCode = async (code) => {
  if (typeof code !== 'string') return 'Execution Error: Code must be a string.';
  if (code.length > MAX_CODE_LENGTH) return `Execution Error: Code too long (max ${MAX_CODE_LENGTH} chars).`;

  return new Promise((resolve) => {
    const workerScript = `
      const { parentPort, workerData } = require('worker_threads');
      let output = '';
      const safeConsole = {
        log: (...args) => { output += args.join(' ') + '\\n'; },
        error: (...args) => { output += 'ERROR: ' + args.join(' ') + '\\n'; },
        warn: (...args) => { output += 'WARN: ' + args.join(' ') + '\\n'; },
      };
      const runner = new Function(
        'console', 'Math', 'Date', 'JSON', 'parseInt', 'parseFloat',
        'String', 'Number', 'Boolean', 'Array', 'Object',
        'process', 'require', 'global', 'globalThis', 'Function', 'eval',
        '"use strict";\\n' + workerData.code
      );
      try {
        const result = runner(
          safeConsole, Math, Date, JSON, parseInt, parseFloat, String, Number, Boolean, Array, Object,
          undefined, undefined, undefined, undefined, undefined, undefined
        );
        if (output.trim()) parentPort.postMessage({ ok: true, output: output.trim() });
        else if (result !== undefined) parentPort.postMessage({ ok: true, output: String(result) });
        else parentPort.postMessage({ ok: true, output: 'Code executed successfully with no output.' });
      } catch (err) {
        parentPort.postMessage({ ok: false, output: 'Execution Error: ' + err.message });
      }
    `;

    const worker = new Worker(workerScript, {
      eval: true,
      workerData: { code },
      resourceLimits: { maxOldGenerationSizeMb: 32, maxYoungGenerationSizeMb: 16 },
    });

    const timeout = setTimeout(() => {
      worker.terminate().finally(() => resolve('Execution Error: Execution timed out.'));
    }, MAX_EXEC_MS);

    worker.on('message', (message) => {
      clearTimeout(timeout);
      resolve(message?.output || 'Execution Error: Unknown worker response.');
      worker.terminate().catch(() => {});
    });
    worker.on('error', () => {
      clearTimeout(timeout);
      resolve('Execution Error: Worker failed.');
    });
    worker.on('exit', (codeExit) => {
      if (codeExit !== 0) {
        clearTimeout(timeout);
      }
    });
  });
};

module.exports = { executeCode };
