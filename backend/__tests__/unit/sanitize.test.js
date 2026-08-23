// vitest globals: describe, it, expect

const { sanitizeInput, sanitizeText } = require('../../middleware/sanitize');

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

  it('preserves newlines and multi-line content', () => {
    const codeBlock = 'function foo() {\n  return "bar";\n}';
    expect(sanitizeInput(codeBlock)).toBe(codeBlock);
  });

  it('preserves internal whitespace (trim only removes leading/trailing)', () => {
    expect(sanitizeInput('hello    world')).toBe('hello    world');
    expect(sanitizeInput('  hello   world  ')).toBe('hello   world');
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

  it('still strips tags for identifier-style fields (unchanged, strict path)', () => {
    expect(sanitizeInput('<script>alert(1)</script>modelId')).toBe('alert(1)modelId');
    expect(sanitizeInput('claude-sonnet-5<b>')).toBe('claude-sonnet-5');
  });
});

describe('sanitizeText', () => {
  it('returns non-string input unchanged', () => {
    expect(sanitizeText(123)).toBe(123);
    expect(sanitizeText(null)).toBe(null);
    expect(sanitizeText(undefined)).toBe(undefined);
    expect(sanitizeText({ key: 'value' })).toEqual({ key: 'value' });
  });

  it('preserves generic type syntax verbatim', () => {
    const code = 'function f(x: Array<string>): Map<string, number> {}';
    expect(sanitizeText(code)).toBe(code);
  });

  it('preserves comparison operators verbatim', () => {
    const code = 'Compare a < b && c > d in JS';
    expect(sanitizeText(code)).toBe(code);
  });

  it('does not strip HTML-looking tags — this is not an HTML sink', () => {
    expect(sanitizeText('<div>hello</div>')).toBe('<div>hello</div>');
  });

  it('still strips control characters', () => {
    expect(sanitizeText('hello\u0000\u0001world')).toBe('helloworld');
    expect(sanitizeText('a\u001Bb')).toBe('ab');
  });

  it('still normalizes \u2028/\u2029 line separators to a space', () => {
    expect(sanitizeText('line1\u2028line2')).toBe('line1 line2');
    expect(sanitizeText('line1\u2029line2')).toBe('line1 line2');
  });

  it('trims leading/trailing whitespace but preserves internal whitespace', () => {
    expect(sanitizeText('  hello   world  ')).toBe('hello   world');
  });

  it('preserves newlines and multi-line code blocks', () => {
    const codeBlock = 'function foo() {\n  return "bar";\n}';
    expect(sanitizeText(codeBlock)).toBe(codeBlock);
  });
});
