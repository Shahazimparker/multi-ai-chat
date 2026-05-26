const { searchWeb } = require('./services/tools/webSearch.service');
const { executeCode } = require('./services/tools/codeExecute.service');

async function runTests() {
  console.log('--- Testing Web Search ---');
  const searchResults = await searchWeb('Anthropic Claude 3.5 Sonnet');
  console.log(searchResults);

  console.log('\n--- Testing Code Execute ---');
  const codeResult = await executeCode('console.log("Hello from VM!"); Math.random();');
  console.log('Result:', codeResult);
}

runTests();
