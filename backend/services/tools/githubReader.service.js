const axios = require('axios');

const DEFAULT_MAX_FILES = Number(process.env.GITHUB_READER_MAX_FILES || 60);
const DEFAULT_MAX_FILE_BYTES = Number(process.env.GITHUB_READER_MAX_FILE_BYTES || 150000);
const DEFAULT_MAX_TOTAL_CHARS = Number(process.env.GITHUB_READER_MAX_TOTAL_CHARS || 180000);

const isGitHubHost = (hostname = '') => {
  const host = String(hostname || '').toLowerCase();
  return host === 'github.com' || host === 'www.github.com';
};

const parseGitHubRepoUrl = (urlString) => {
  let parsed;
  try {
    parsed = new URL(urlString);
  } catch {
    return null;
  }
  if (!isGitHubHost(parsed.hostname)) return null;

  const parts = parsed.pathname.split('/').filter(Boolean);
  if (parts.length < 2) return null;
  const owner = parts[0];
  const repo = parts[1].replace(/\.git$/i, '');
  if (!owner || !repo) return null;
  return { owner, repo, canonicalUrl: `https://github.com/${owner}/${repo}` };
};

const shouldIncludePath = (path = '') => {
  const lower = String(path).toLowerCase();
  if (lower.includes('/node_modules/')) return false;
  if (lower.includes('/dist/')) return false;
  if (lower.includes('/build/')) return false;
  if (lower.includes('/.next/')) return false;
  if (lower.includes('/coverage/')) return false;
  if (lower.includes('/vendor/')) return false;
  if (lower.includes('/.git/')) return false;
  if (/\.(png|jpg|jpeg|gif|webp|svg|pdf|pptx?|xlsx?|docx?|zip|gz|tgz|lock|mp4|mp3|mov|avi)$/i.test(lower)) return false;
  return true;
};

const createGitHubHeaders = () => {
  const token = process.env.GITHUB_TOKEN;
  const headers = {
    Accept: 'application/vnd.github+json',
    'User-Agent': 'multi-ai-chat-url-reader',
  };
  if (token) headers.Authorization = `Bearer ${token}`;
  return headers;
};

const readGitHubRepo = async (urlString, options = {}) => {
  const parsed = parseGitHubRepoUrl(urlString);
  if (!parsed) return null;

  const timeout = Number(options.timeout || process.env.WEB_SEARCH_TIMEOUT_MS || 8000);
  const maxFiles = Number(options.maxFiles || DEFAULT_MAX_FILES);
  const maxFileBytes = Number(options.maxFileBytes || DEFAULT_MAX_FILE_BYTES);
  const maxTotalChars = Number(options.maxTotalChars || DEFAULT_MAX_TOTAL_CHARS);
  const headers = createGitHubHeaders();

  const branchRes = await axios.get(
    `https://api.github.com/repos/${parsed.owner}/${parsed.repo}`,
    { timeout, headers }
  );
  const defaultBranch = String(branchRes?.data?.default_branch || 'main');

  const treeRes = await axios.get(
    `https://api.github.com/repos/${parsed.owner}/${parsed.repo}/git/trees/${encodeURIComponent(defaultBranch)}?recursive=1`,
    { timeout, headers }
  );

  const files = (treeRes?.data?.tree || [])
    .filter((entry) => entry?.type === 'blob')
    .filter((entry) => shouldIncludePath(entry?.path))
    .filter((entry) => Number(entry?.size || 0) > 0 && Number(entry?.size || 0) <= maxFileBytes)
    .slice(0, maxFiles);

  if (files.length === 0) {
    return [{
      url: parsed.canonicalUrl,
      title: `${parsed.owner}/${parsed.repo}`,
      text: `Repository detected, but no eligible text files were selected (branch: ${defaultBranch}).`,
      source: 'github',
    }];
  }

  let totalChars = 0;
  const sections = [];
  for (const file of files) {
    if (totalChars >= maxTotalChars) break;
    try {
      const rawUrl = `https://raw.githubusercontent.com/${parsed.owner}/${parsed.repo}/${defaultBranch}/${file.path}`;
      const fileRes = await axios.get(rawUrl, {
        timeout,
        headers: { 'User-Agent': 'multi-ai-chat-url-reader' },
        responseType: 'text',
      });
      const text = String(fileRes?.data || '').trim();
      if (!text) continue;
      const remaining = Math.max(0, maxTotalChars - totalChars);
      const clipped = text.length > remaining ? text.slice(0, remaining) : text;
      sections.push(`## ${file.path}\n${clipped}`);
      totalChars += clipped.length;
    } catch {
      // continue
    }
  }

  if (sections.length === 0) {
    return [];
  }

  const summary = [
    `GitHub repository: ${parsed.owner}/${parsed.repo}`,
    `Branch: ${defaultBranch}`,
    `Files included: ${sections.length}/${files.length}`,
    '',
    ...sections,
  ].join('\n');

  return [{
    url: parsed.canonicalUrl,
    title: `${parsed.owner}/${parsed.repo}`,
    text: summary,
    source: 'github',
  }];
};

module.exports = {
  isGitHubHost,
  parseGitHubRepoUrl,
  readGitHubRepo,
};
