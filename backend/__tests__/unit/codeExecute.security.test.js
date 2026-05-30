const { executeCode } = require('../../services/tools/codeExecute.service');

describe('executeCode security constraints', () => {
  it('blocks access to process/require globals', async () => {
    const resultProcess = await executeCode('console.log(typeof process)');
    const resultRequire = await executeCode('console.log(typeof require)');
    expect(resultProcess.toLowerCase()).toContain('error');
    expect(resultRequire.toLowerCase()).toContain('error');
  });

  it('times out infinite loop', async () => {
    const result = await executeCode('while(true) {}');
    expect(result.toLowerCase()).toMatch(/timed out|worker failed/);
  }, 5000);

  it('enforces max code length', async () => {
    const longCode = 'a'.repeat(6001);
    const result = await executeCode(longCode);
    expect(result.toLowerCase()).toContain('too long');
  });
});
