const vm = require('vm');

/**
 * Executes arbitrary javascript code in a restricted VM environment.
 * @param {string} code 
 * @returns {Promise<string>} Console output or error
 */
const executeCode = async (code) => {
  return new Promise((resolve) => {
    let output = '';
    const sandbox = {
      console: {
        log: (...args) => { output += args.join(' ') + '\n'; },
        error: (...args) => { output += 'ERROR: ' + args.join(' ') + '\n'; },
        warn: (...args) => { output += 'WARN: ' + args.join(' ') + '\n'; },
      },
      Math,
      Date,
      JSON,
      parseInt,
      parseFloat,
      String,
      Number,
      Boolean,
      Array,
      Object
    };

    const context = vm.createContext(sandbox);
    
    try {
      const script = new vm.Script(code);
      // Run with a 2-second timeout to prevent infinite loops
      const result = script.runInContext(context, { timeout: 2000 });
      
      if (output.trim().length > 0) {
        resolve(output.trim());
      } else if (result !== undefined) {
        resolve(String(result));
      } else {
        resolve('Code executed successfully with no output.');
      }
    } catch (err) {
      resolve(`Execution Error: ${err.message}`);
    }
  });
};

module.exports = { executeCode };
