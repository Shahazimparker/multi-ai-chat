// vitest globals: describe, it, expect

const { sanitizeInput } = require('../../middleware/sanitize');

describe('sanitizeInput', () => {
  it('returns non-string input unchanged', () => {
    expect(sanitizeInput(123)).toBe(123);
    expect(sanitizeInput(null)).toBe(null);
    expect(sanitizeInput(undefined)).toBe(undefined);
    expect(sanitizeInput({ key: 'value' })).toEqual({ key: 'value' });
  });

  it('strips HTML tags', () => {
    expect(sanitizeInput('<script>alert("xss")</script>')).toBe('alert("xss")');
    expect(sanitizeInput('<b>bold</b>')).toBe('bold');
    expect(sanitizeInput('<div class="test">content</div>')).toBe('content');
  });

  it('decodes HTML entities', () => {
    // sanitizeInput first strips HTML tags, then decodes entities
    // < has no HTML tags, so it passes through tag stripping
    // Then < → < and > → >, but < and > are then treated as HTML tags and stripped
    // So <script> → <script> → (stripped) → ''
    expect(sanitizeInput('<script>')).toBe('');
    expect(sanitizeInput('&')).toBe('&');
    expect(sanitizeInput('"hello"')).toBe('"hello"');
  });

  it('collapses multiple whitespace', () => {
    expect(sanitizeInput('hello    world')).toBe('hello world');
    expect(sanitizeInput('hello\n\n\nworld')).toBe('hello world');
    expect(sanitizeInput('  hello   world  ')).toBe('hello world');
  });

  it('handles nested tags', () => {
    expect(sanitizeInput('<div><p>nested <b>content</b></p></div>')).toBe('nested content');
  });

  it('handles empty string', () => {
    expect(sanitizeInput('')).toBe('');
  });

  it('handles text with no HTML', () => {
    const input = 'This is normal text with no HTML tags.';
    expect(sanitizeInput(input)).toBe(input);
  });

  it('handles XSS vectors', () => {
    expect(sanitizeInput('<img src=x onerror=alert(1)>')).toBe('');
    expect(sanitizeInput('<svg onload=alert(1)>')).toBe('');
    expect(sanitizeInput('javascript:alert(1)')).toBe('javascript:alert(1)');
  });
});
