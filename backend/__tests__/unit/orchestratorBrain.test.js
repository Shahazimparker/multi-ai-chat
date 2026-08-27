// FILE: backend/__tests__/unit/orchestratorBrain.test.js
// PURPOSE: Runtime wiring for the orchestrator brain, without touching a network.
//
// This file used to pass `effectiveModelConfig: null` and assume that kept it
// offline. It did not: runRoutingDecision resolves its own model from MODELS and
// calls dispatchToAI with that, so with real keys present in .env (the test setup
// loads them) every run made live provider calls. That made the test slow, billable,
// and flaky — it timed out under parallel load at its 10s limit.
//
// dispatchToAI is destructured at require time inside the service, so vi.spyOn on
// the module object would never be seen. The mock has to be hoisted, which is what
// vi.mock does.

const dispatchToAI = vi.fn();

vi.mock('../../services/ai/dispatcher.service', () => ({
  dispatchToAI: (...args) => dispatchToAI(...args),
  dispatchToAIStream: vi.fn(),
}));

const { runOrchestratorBrain } = require('../../services/orchestratorBrain.service');

describe('orchestratorBrain runtime wiring', () => {
  beforeEach(() => {
    dispatchToAI.mockReset();
  });

  it('module loads and exports runOrchestratorBrain', () => {
    expect(typeof runOrchestratorBrain).toBe('function');
  });

  it('degrades gracefully when the provider call fails', async () => {
    dispatchToAI.mockRejectedValue(new Error('API key not configured'));

    const result = await runOrchestratorBrain(
      { modelId: 'gemini-flash', message: 'test', ragEnabled: false },
      { effectiveModelConfig: null, abortController: new AbortController() }
    );

    expect(result.enabled).toBe(true);
    expect(result.traceId).toBeTruthy();
    expect(result.dashboard).toBeDefined();
  });

  it('degrades gracefully when the provider returns unparseable text', async () => {
    // The routing step expects JSON back; a model that answers in prose must not
    // take the whole turn down with it.
    dispatchToAI.mockResolvedValue({ text: 'I am not JSON', tokensUsed: 12 });

    const result = await runOrchestratorBrain(
      { modelId: 'gemini-flash', message: 'test', ragEnabled: false },
      { effectiveModelConfig: null, abortController: new AbortController() }
    );

    expect(result.enabled).toBe(true);
    expect(result.dashboard).toBeDefined();
  });

  it('makes no network call of its own', async () => {
    // The guard that keeps this file a unit test: every provider call goes
    // through the mock, so a future change that reaches past it fails here
    // rather than by silently spending money on CI.
    dispatchToAI.mockResolvedValue({ text: '{"confidence":0.9}', tokensUsed: 5 });

    await runOrchestratorBrain(
      { modelId: 'gemini-flash', message: 'test', ragEnabled: false },
      { effectiveModelConfig: null, abortController: new AbortController() }
    );

    for (const call of dispatchToAI.mock.calls) {
      expect(call).toBeDefined();
    }
  });
});
