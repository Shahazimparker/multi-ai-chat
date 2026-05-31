const { extractUrls, validatePublicHttpUrl } = require('../../services/tools/urlReader.service');

describe('urlReader.service', () => {
  it('extracts distinct http/https urls from text', () => {
    const text = 'Check https://example.com and http://test.com/a?x=1 and https://example.com';
    const urls = extractUrls(text);
    expect(urls).toEqual(['https://example.com', 'http://test.com/a?x=1']);
  });

  it('strips trailing punctuation from extracted urls', () => {
    const text = 'Read this (https://github.com/octocat/Hello-World), and this https://example.org/test.';
    const urls = extractUrls(text);
    expect(urls).toEqual(['https://github.com/octocat/Hello-World', 'https://example.org/test']);
  });

  it('allows valid public http/https urls', () => {
    expect(validatePublicHttpUrl('https://example.com/path')).toBe('https://example.com/path');
    expect(validatePublicHttpUrl('http://8.8.8.8/info')).toBe('http://8.8.8.8/info');
  });

  it('blocks localhost and private hosts', () => {
    expect(() => validatePublicHttpUrl('http://localhost:3000')).toThrow();
    expect(() => validatePublicHttpUrl('http://127.0.0.1:8080')).toThrow();
    expect(() => validatePublicHttpUrl('http://10.0.0.5')).toThrow();
    expect(() => validatePublicHttpUrl('http://192.168.1.20')).toThrow();
    expect(() => validatePublicHttpUrl('http://172.16.2.10')).toThrow();
    expect(() => validatePublicHttpUrl('http://internal.local/path')).toThrow();
  });

  it('blocks non-http protocols', () => {
    expect(() => validatePublicHttpUrl('file:///etc/passwd')).toThrow();
    expect(() => validatePublicHttpUrl('ftp://example.com')).toThrow();
  });
});
