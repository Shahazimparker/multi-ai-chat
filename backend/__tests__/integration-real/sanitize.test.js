// Real sanitize integration tests — tests the express middleware via http
// Run: npx vitest run --config vitest.real.config.js
// Prerequisite: npm run dev (start backend first)

const { sanitizeInput, sanitizeBody } = require('../../middleware/sanitize');

describe('sanitizeInput (real)', () => {
  it('strips HTML tags from user input', () => {
    expect(sanitizeInput('<script>alert("xss")</script>')).toBe('alert("xss")');
    expect(sanitizeInput('<img src=x onerror=alert(1)>')).toBe('');
  });

  it('preserves normal text unchanged', () => {
    const text = 'SELECT * FROM users WHERE id = 1; -- normal SQL comment';
    expect(sanitizeInput(text)).toBe(text);
  });

  it('preserves code blocks with special chars', () => {
    const code = 'function hello() {\n  return "world";\n}';
    expect(sanitizeInput(code)).toBe(code);
  });

  it('handles deeply nested HTML', () => {
    const nested = '<div><span><b><i>deep</i></b></span></div>';
    expect(sanitizeInput(nested)).toBe('deep');
  });

  it('preserve multiline with indentation', () => {
    const text = 'line1\n  indented\nline3';
    expect(sanitizeInput(text)).toBe(text);
  });

  it('removes leading/trailing whitespace but preserves internal', () => {
    expect(sanitizeInput('  hello   world  ')).toBe('hello   world');
  });

  it('handles empty and edge cases', () => {
    expect(sanitizeInput('')).toBe('');
    expect(sanitizeInput(null)).toBe(null);
    expect(sanitizeInput(undefined)).toBe(undefined);
    expect(sanitizeInput(0)).toBe(0);
  });

  it('strips multiple HTML entities', () => {
    // < and > become < and > which then get stripped
    expect(sanitizeInput('<script>')).toBe('');
  });
});

describe('sanitizeBody middleware', () => {
  it('sanitizes specified fields on the request body', () => {
    const req = {
      body: {
        message: '<script>alert("xss")</script>',
        modelId: 'gemini-flash',
        untouched: '<b>keep</b>',
      },
    };
    const res = {};
    const next = () => {};

    const middleware = sanitizeBody(['message', 'modelId']);
    middleware(req, res, next);

    expect(req.body.message).toBe('alert("xss")');
    expect(req.body.modelId).toBe('gemini-flash'); // no HTML, unchanged
    expect(req.body.untouched).toBe('<b>keep</b>'); // not in the list
  });

  it('handles missing fields gracefully', () => {
    const req = { body: {} };
    const res = {};
    const next = () => {};

    const middleware = sanitizeBody(['message']);
    middleware(req, res, next);

    expect(req.body).toEqual({});
  });

  it('handles null body gracefully', () => {
    const req = { body: null };
    const res = {};
    const next = () => {};

    const middleware = sanitizeBody(['message']);
    middleware(req, res, next);

    expect(req.body).toBeNull();
  });
});
