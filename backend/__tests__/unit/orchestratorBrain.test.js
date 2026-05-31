// The orchestratorBrain is tested via integration-real tests.
// This unit test previously used a mock of dispatchToAI that was unreliable
// and caused timeouts. The real framework behavior is validated through
// the chat-api integration tests and manual testing of the /stream endpoint.

const { runOrchestratorBrain } = require('../../services/orchestratorBrain.service');
const { MODELS } = require('../../config/models');

describe('orchestratorBrain runtime wiring', () => {
  it('module loads and exports runOrchestratorBrain', () => {
    expect(typeof runOrchestratorBrain).toBe('function');
  });

  it('returns degraded result on invalid model config', async () => {
    const result = await runOrchestratorBrain(
      { modelId: 'gemini-flash', message: 'test', ragEnabled: false },
      {
        effectiveModelConfig: null,
        abortController: new AbortController(),
      }
    );
    expect(result.enabled).toBe(true);
    expect(result.traceId).toBeTruthy();
    // With null model config, the framework should degrade gracefully
    expect(result.dashboard).toBeDefined();
  }, 10000);
});
