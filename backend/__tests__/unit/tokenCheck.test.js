// vitest globals: describe, it, expect

const { tokenCheck } = require('../../middleware/tokenCheck');

describe('tokenCheck', () => {
  it('returns 401 when req.user is missing (requireAuth should have run first)', () => {
    const req = {};
    const res = {
      statusCode: null,
      body: null,
      status(code) { this.statusCode = code; return this; },
      json(data) { this.body = data; return this; },
    };
    let nextCalled = false;
    tokenCheck(req, res, () => { nextCalled = true; });
    expect(nextCalled).toBe(false);
    expect(res.statusCode).toBe(401);
  });

  it('calls next() when user has remaining tokens', () => {
    const req = {
      user: { total_tokens: 1000, used_tokens: 500 },
    };
    const res = {};
    let nextCalled = false;
    tokenCheck(req, res, () => { nextCalled = true; });
    expect(nextCalled).toBe(true);
    expect(req.tokenRemaining).toBe(500);
  });

  it('returns 429 when user has no remaining tokens', () => {
    const req = {
      user: { total_tokens: 1000, used_tokens: 1000 },
    };
    const res = {
      statusCode: null,
      body: null,
      status(code) { this.statusCode = code; return this; },
      json(data) { this.body = data; return this; },
    };
    tokenCheck(req, res, () => {});
    expect(res.statusCode).toBe(429);
    expect(res.body.error).toMatch(/quota exhausted/i);
  });

  it('returns 429 when user has exceeded tokens', () => {
    const req = {
      user: { total_tokens: 1000, used_tokens: 1500 },
    };
    const res = {
      statusCode: null,
      body: null,
      status(code) { this.statusCode = code; return this; },
      json(data) { this.body = data; return this; },
    };
    tokenCheck(req, res, () => {});
    expect(res.statusCode).toBe(429);
  });

  it('sets tokenRemaining correctly', () => {
    const req = {
      user: { total_tokens: 5000, used_tokens: 1234 },
    };
    const res = {};
    tokenCheck(req, res, () => {});
    expect(req.tokenRemaining).toBe(3766);
  });
});
