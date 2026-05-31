const {
  parseGitLabRepoUrl,
  parseBitbucketRepoUrl,
  parseNotionUrl,
  parseConfluenceUrl,
  parseStackOverflowUrl,
  parseArxivUrl,
  parsePubmedUrl,
  parseGoogleDocsUrl,
  parseSharePointUrl,
  parseMediumOrSubstackUrl,
  parseYouTubeUrl,
  parseRedditUrl,
  parseQuoraUrl,
  parseApiDocsUrl,
  parseGovLegalUrl,
} = require('../../services/tools/siteReaders.service');

describe('siteReaders.service parsers', () => {
  it('parses gitlab repo url', () => {
    expect(parseGitLabRepoUrl('https://gitlab.com/group/repo')).toEqual({
      owner: 'group',
      repo: 'repo',
      canonicalUrl: 'https://gitlab.com/group/repo',
    });
  });

  it('parses bitbucket repo url', () => {
    expect(parseBitbucketRepoUrl('https://bitbucket.org/workspace/repo')).toEqual({
      workspace: 'workspace',
      repo: 'repo',
      canonicalUrl: 'https://bitbucket.org/workspace/repo',
    });
  });

  it('parses notion page url', () => {
    expect(parseNotionUrl('https://www.notion.so/workspace/Page-123')).toEqual({
      canonicalUrl: 'https://www.notion.so/workspace/Page-123',
    });
  });

  it('parses confluence page url', () => {
    expect(parseConfluenceUrl('https://abc.atlassian.net/wiki/spaces/ENG/pages/1234/Test')).toEqual({
      canonicalUrl: 'https://abc.atlassian.net/wiki/spaces/ENG/pages/1234/Test',
    });
  });

  it('parses stackoverflow question url', () => {
    expect(parseStackOverflowUrl('https://stackoverflow.com/questions/11227809/why-is-processing-a-sorted-array-faster')).toEqual({
      questionId: '11227809',
      canonicalUrl: 'https://stackoverflow.com/questions/11227809',
    });
  });

  it('parses arxiv url', () => {
    expect(parseArxivUrl('https://arxiv.org/abs/1706.03762')).toEqual({
      paperId: '1706.03762',
      canonicalUrl: 'https://arxiv.org/abs/1706.03762',
    });
  });

  it('parses pubmed url', () => {
    expect(parsePubmedUrl('https://pubmed.ncbi.nlm.nih.gov/12345678/')).toEqual({
      pmid: '12345678',
      canonicalUrl: 'https://pubmed.ncbi.nlm.nih.gov/12345678/',
    });
  });

  it('parses google docs url', () => {
    expect(parseGoogleDocsUrl('https://docs.google.com/document/d/abc123/edit')).toEqual({
      canonicalUrl: 'https://docs.google.com/document/d/abc123/edit',
    });
  });

  it('parses sharepoint url', () => {
    expect(parseSharePointUrl('https://contoso.sharepoint.com/sites/eng/SitePages/Home.aspx')).toEqual({
      canonicalUrl: 'https://contoso.sharepoint.com/sites/eng/SitePages/Home.aspx',
    });
  });

  it('parses medium/substack url', () => {
    expect(parseMediumOrSubstackUrl('https://medium.com/@test/post-123')?.source).toBe('medium');
    expect(parseMediumOrSubstackUrl('https://example.substack.com/p/test')?.source).toBe('substack');
  });

  it('parses youtube url', () => {
    expect(parseYouTubeUrl('https://www.youtube.com/watch?v=dQw4w9WgXcQ')).toEqual({
      videoId: 'dQw4w9WgXcQ',
      canonicalUrl: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
    });
  });

  it('parses reddit thread url', () => {
    expect(parseRedditUrl('https://www.reddit.com/r/node/comments/abc123/sample_post/')).toEqual({
      canonicalUrl: 'https://www.reddit.com/r/node/comments/abc123/sample_post/',
    });
  });

  it('parses quora url', () => {
    expect(parseQuoraUrl('https://www.quora.com/What-is-Node-js')).toEqual({
      canonicalUrl: 'https://www.quora.com/What-is-Node-js',
    });
  });

  it('parses api docs url', () => {
    expect(parseApiDocsUrl('https://api.example.com/swagger')).toEqual({
      canonicalUrl: 'https://api.example.com/swagger',
      host: 'api.example.com',
    });
  });

  it('parses gov/legal url', () => {
    expect(parseGovLegalUrl('https://www.usa.gov/benefits')).toEqual({
      canonicalUrl: 'https://www.usa.gov/benefits',
    });
  });
});
