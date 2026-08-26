// ============================================================
// FILE: backend/__tests__/unit/authCookie.test.js
// PURPOSE: Verify 30-day Remember Me vs session cookie behavior
// ============================================================

// vitest globals: describe, it, expect, beforeEach

const jwt = require('jsonwebtoken');
const {
  AUTH_COOKIE_NAME,
  CSRF_COOKIE_NAME,
  REMEMBER_ME_DAYS,
  REMEMBER_ME_SECONDS,
  getSessionSeconds,
  parseRememberMe,
  issueAuthCookie,
} = require('../../utils/authCookie');

process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-key-1234567890';

const makeMockRes = () => {
  const cookies = [];
  return {
    cookies,
    cookie: (name, value, options) => {
      cookies.push({ name, value, options });
    },
  };
};

describe('authCookie utils', () => {
  const mockUser = {
    id: 'user-123',
    role: 'user',
    session_minutes: 45,
  };

  it('correctly calculates 30 days for REMEMBER_ME_SECONDS', () => {
    expect(REMEMBER_ME_DAYS).toBe(30);
    expect(REMEMBER_ME_SECONDS).toBe(30 * 24 * 60 * 60);
    expect(REMEMBER_ME_SECONDS).toBe(2592000);
  });

  it('returns 30 days session seconds when rememberMe is true', () => {
    expect(getSessionSeconds(mockUser, true)).toBe(REMEMBER_ME_SECONDS);
    expect(getSessionSeconds(mockUser, 'true')).toBe(REMEMBER_ME_SECONDS);
    expect(getSessionSeconds(mockUser, 1)).toBe(REMEMBER_ME_SECONDS);
  });

  it('returns user session_minutes * 60 when rememberMe is false', () => {
    expect(getSessionSeconds(mockUser, false)).toBe(45 * 60);
    expect(getSessionSeconds(null, false)).toBe(60 * 60);
  });

  it('issues a 30-day persistent cookie and token when rememberMe is true', () => {
    const res = makeMockRes();
    const { token, csrfToken } = issueAuthCookie(res, mockUser, true);

    expect(token).toBeDefined();
    expect(csrfToken).toBeDefined();

    const authCookie = res.cookies.find(c => c.name === AUTH_COOKIE_NAME);
    const csrfCookie = res.cookies.find(c => c.name === CSRF_COOKIE_NAME);

    expect(authCookie).toBeDefined();
    expect(authCookie.options.maxAge).toBe(REMEMBER_ME_SECONDS * 1000);

    expect(csrfCookie).toBeDefined();
    expect(csrfCookie.options.maxAge).toBe(REMEMBER_ME_SECONDS * 1000);

    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    expect(decoded.userId).toBe(mockUser.id);
    expect(decoded.rememberMe).toBe(true);
    // JWT exp should match 30 days within a few seconds margin
    const nowSec = Math.floor(Date.now() / 1000);
    expect(decoded.exp - nowSec).toBeGreaterThanOrEqual(REMEMBER_ME_SECONDS - 5);
  });

  it('issues a session cookie with undefined maxAge when rememberMe is false', () => {
    const res = makeMockRes();
    const { token } = issueAuthCookie(res, mockUser, false);

    const authCookie = res.cookies.find(c => c.name === AUTH_COOKIE_NAME);
    const csrfCookie = res.cookies.find(c => c.name === CSRF_COOKIE_NAME);

    expect(authCookie.options.maxAge).toBeUndefined();
    expect(csrfCookie.options.maxAge).toBeUndefined();

    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    expect(decoded.rememberMe).toBe(false);
    const nowSec = Math.floor(Date.now() / 1000);
    expect(decoded.exp - nowSec).toBeLessThanOrEqual(45 * 60);
  });
});
