const { searchWeb } = require('./services/tools/webSearch.service');

async function runTests() {
  console.log('--- Testing Web Search ---');
  const searchResults = await searchWeb('Anthropic Claude 3.5 Sonnet');
  console.log(searchResults);
}

runTests();
