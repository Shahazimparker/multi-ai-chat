// vitest globals: describe, it, expect
// Tests for imageGeneration.service.js

const { generateImage, OPENROUTER_IMAGE_MODELS } = require('../../services/imageGeneration.service');

const TEST_USER_ID = '023fec25-c86b-4b51-9d93-36f661ae5a67';

describe('OPENROUTER_IMAGE_MODELS', () => {
  it('exports the expected model list', () => {
    expect(Array.isArray(OPENROUTER_IMAGE_MODELS)).toBe(true);
    expect(OPENROUTER_IMAGE_MODELS.length).toBeGreaterThanOrEqual(4);
  });

  it('each model entry has model and label', () => {
    for (const entry of OPENROUTER_IMAGE_MODELS) {
      expect(entry).toHaveProperty('model');
      expect(entry).toHaveProperty('label');
      expect(typeof entry.model).toBe('string');
      expect(typeof entry.label).toBe('string');
    }
  });

  it('models are ordered by quality tier (Recraft v4.1 first)', () => {
    expect(OPENROUTER_IMAGE_MODELS[0].model).toBe('recraft/recraft-v4.1');
  });

  it('includes FLUX.2 models as fallbacks', () => {
    const modelIds = OPENROUTER_IMAGE_MODELS.map((e) => e.model);
    expect(modelIds).toContain('black-forest-labs/flux.2-pro');
    expect(modelIds).toContain('black-forest-labs/flux.2-flex');
    expect(modelIds).toContain('black-forest-labs/flux.2-klein-4b');
  });
});

// Real image generation test skipped to avoid Recraft/FLUX/DALL-E API costs
// Run manually with: npx vitest run --reporter=verbose __tests__/unit/imageGeneration.test.js --test-timeout=60000
describe.skip('generateImage', () => {
  it('generates an image and returns file metadata', async () => {
    const result = await generateImage('a simple red circle on white background', TEST_USER_ID, null);
    expect(result).toHaveProperty('file_id');
    expect(result).toHaveProperty('file_name');
    expect(result.file_name).toMatch(/\.png$/);
    expect(result.file_type).toBe('png');
    expect(result).toHaveProperty('modelUsed');
  }, 60000);
});
