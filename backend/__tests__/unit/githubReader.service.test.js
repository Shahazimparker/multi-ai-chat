const { parseGitHubRepoUrl } = require('../../services/tools/githubReader.service');

describe('githubReader.service', () => {
  it('parses repo urls', () => {
    expect(parseGitHubRepoUrl('https://github.com/openai/openai-node')).toEqual({
      owner: 'openai',
      repo: 'openai-node',
      canonicalUrl: 'https://github.com/openai/openai-node',
    });
  });

  it('parses repo urls with .git suffix', () => {
    expect(parseGitHubRepoUrl('https://github.com/openai/openai-node.git')).toEqual({
      owner: 'openai',
      repo: 'openai-node',
      canonicalUrl: 'https://github.com/openai/openai-node',
    });
  });

  it('returns null for non-github urls', () => {
    expect(parseGitHubRepoUrl('https://example.com/openai/openai-node')).toBeNull();
  });
});
