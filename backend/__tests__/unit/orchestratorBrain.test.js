vi.mock('../../services/ai/dispatcher.service', () => ({
  dispatchToAI: vi.fn(async () => ({
    text: '{"final_answer":"ok"}',
    tokensUsed: 7,
  })),
}));

const { runOrchestratorBrain } = require('../../services/orchestratorBrain.service');
const { MODELS } = require('../../config/models');

describe('orchestratorBrain runtime wiring', () => {
  it('runs the real framework graph and emits stream status events', async () => {
    const statuses = [];
    const modelId = 'gemini-flash';

    const result = await runOrchestratorBrain(
      {
        modelId,
        message: 'Summarize uploaded file context',
        ragEnabled: true,
      },
      {
        effectiveModelConfig: MODELS[modelId],
        abortController: new AbortController(),
        onToolStatus: (event) => statuses.push(event),
      }
    );

    expect(result.enabled).toBe(true);
    expect(result.traceId).toBeTruthy();
    expect(result.dashboard.status).toBe('success');
    expect(result.dashboard.totalSteps).toBeGreaterThan(0);
    expect(result.graph.success).toBe(true);
    expect(result.graph.executionPath.map((step) => step.node)).toEqual(['prepare', 'plan', 'retrieve']);
    expect(result.traceReport.status).toBe('success');
    expect(result.metrics.totalOperations).toBeGreaterThan(0);
    expect(statuses.map((event) => event.status)).toContain('started');
    expect(statuses.map((event) => event.status)).toContain('ready');
  });
});
