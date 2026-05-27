// vitest globals: describe, it, expect, beforeEach, afterEach

describe('chatRuntime.config', () => {
  let originalEnv;

  beforeEach(() => {
    originalEnv = { ...process.env };
    delete process.env.CHAT_MAX_DB_QUERIES;
    delete process.env.CHAT_MAX_CONSECUTIVE_ZERO_RESULTS;
    delete process.env.CHAT_TOOL_RESERVE_RATIO;
    delete process.env.CHAT_SEMANTIC_CACHE_THRESHOLD;
    delete require.cache[require.resolve('../../config/chatRuntime.config')];
  });

  afterEach(() => {
    process.env = originalEnv;
    delete require.cache[require.resolve('../../config/chatRuntime.config')];
  });

  it('returns default CHAT_MAX_DB_QUERIES when env not set', () => {
    const config = require('../../config/chatRuntime.config');
    expect(config.CHAT_MAX_DB_QUERIES).toBe(12);
  });

  it('returns default CHAT_MAX_CONSECUTIVE_ZERO_RESULTS when env not set', () => {
    const config = require('../../config/chatRuntime.config');
    expect(config.CHAT_MAX_CONSECUTIVE_ZERO_RESULTS).toBe(4);
  });

  it('returns default CHAT_TOOL_RESERVE_RATIO when env not set', () => {
    const config = require('../../config/chatRuntime.config');
    expect(config.CHAT_TOOL_RESERVE_RATIO).toBe(0.15);
  });

  it('returns default CHAT_SEMANTIC_CACHE_THRESHOLD when env not set', () => {
    const config = require('../../config/chatRuntime.config');
    expect(config.CHAT_SEMANTIC_CACHE_THRESHOLD).toBe(0.92);
  });

  it('reads CHAT_MAX_DB_QUERIES from env', () => {
    process.env.CHAT_MAX_DB_QUERIES = '25';
    const config = require('../../config/chatRuntime.config');
    expect(config.CHAT_MAX_DB_QUERIES).toBe(25);
  });

  it('clamps CHAT_MAX_DB_QUERIES to min 1', () => {
    process.env.CHAT_MAX_DB_QUERIES = '0';
    const config = require('../../config/chatRuntime.config');
    expect(config.CHAT_MAX_DB_QUERIES).toBe(1);
  });

  it('clamps CHAT_MAX_DB_QUERIES to max 100', () => {
    process.env.CHAT_MAX_DB_QUERIES = '200';
    const config = require('../../config/chatRuntime.config');
    expect(config.CHAT_MAX_DB_QUERIES).toBe(100);
  });

  it('clamps CHAT_MAX_CONSECUTIVE_ZERO_RESULTS to min 1', () => {
    process.env.CHAT_MAX_CONSECUTIVE_ZERO_RESULTS = '-5';
    const config = require('../../config/chatRuntime.config');
    expect(config.CHAT_MAX_CONSECUTIVE_ZERO_RESULTS).toBe(1);
  });

  it('clamps CHAT_TOOL_RESERVE_RATIO to min 0.05', () => {
    process.env.CHAT_TOOL_RESERVE_RATIO = '0.01';
    const config = require('../../config/chatRuntime.config');
    expect(config.CHAT_TOOL_RESERVE_RATIO).toBe(0.05);
  });

  it('clamps CHAT_TOOL_RESERVE_RATIO to max 0.6', () => {
    process.env.CHAT_TOOL_RESERVE_RATIO = '0.9';
    const config = require('../../config/chatRuntime.config');
    expect(config.CHAT_TOOL_RESERVE_RATIO).toBe(0.6);
  });

  it('clamps CHAT_SEMANTIC_CACHE_THRESHOLD to min 0', () => {
    process.env.CHAT_SEMANTIC_CACHE_THRESHOLD = '-0.5';
    const config = require('../../config/chatRuntime.config');
    expect(config.CHAT_SEMANTIC_CACHE_THRESHOLD).toBe(0);
  });

  it('clamps CHAT_SEMANTIC_CACHE_THRESHOLD to max 1', () => {
    process.env.CHAT_SEMANTIC_CACHE_THRESHOLD = '1.5';
    const config = require('../../config/chatRuntime.config');
    expect(config.CHAT_SEMANTIC_CACHE_THRESHOLD).toBe(1);
  });

  it('handles non-numeric env values by using fallback', () => {
    process.env.CHAT_MAX_DB_QUERIES = 'not_a_number';
    const config = require('../../config/chatRuntime.config');
    expect(config.CHAT_MAX_DB_QUERIES).toBe(12);
  });
});
