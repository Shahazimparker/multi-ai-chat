const axios = require('axios');

const DEFAULT_MAX_FILES = Number(process.env.SITE_READER_MAX_FILES || 60);
const DEFAULT_MAX_FILE_BYTES = Number(process.env.SITE_READER_MAX_FILE_BYTES || 150000);
const DEFAULT_MAX_TOTAL_CHARS = Number(process.env.SITE_READER_MAX_TOTAL_CHARS || 180000);

const safeDecode = (value = '') => {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
};

const trimToTotalChars = (chunks = [], maxChars = DEFAULT_MAX_TOTAL_CHARS) => {
  let used = 0;
  const output = [];
  for (const chunk of chunks) {
    if (used >= maxChars) break;
    const remain = maxChars - used;
    const clipped = chunk.length > remain ? chunk.slice(0, remain) : chunk;
    output.push(clipped);
    used += clipped.length;
  }
  return output;
};

const shouldIncludeRepoPath = (path = '') => {
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

const parseHost = (urlString) => {
  try {
    const parsed = new URL(urlString);
    return { host: String(parsed.hostname || '').toLowerCase(), parsed };
  } catch {
    return { host: '', parsed: null };
  }
};

const parseGitLabRepoUrl = (urlString) => {
  const { host, parsed } = parseHost(urlString);
  if (!parsed || (host !== 'gitlab.com' && host !== 'www.gitlab.com')) return null;
  const parts = parsed.pathname.split('/').filter(Boolean);
  if (parts.length < 2) return null;
  const owner = parts[0];
  const repo = parts[1].replace(/\.git$/i, '');
  if (!owner || !repo) return null;
  return { owner, repo, canonicalUrl: `https://gitlab.com/${owner}/${repo}` };
};

const parseBitbucketRepoUrl = (urlString) => {
  const { host, parsed } = parseHost(urlString);
  if (!parsed || (host !== 'bitbucket.org' && host !== 'www.bitbucket.org')) return null;
  const parts = parsed.pathname.split('/').filter(Boolean);
  if (parts.length < 2) return null;
  const workspace = parts[0];
  const repo = parts[1].replace(/\.git$/i, '');
  if (!workspace || !repo) return null;
  return { workspace, repo, canonicalUrl: `https://bitbucket.org/${workspace}/${repo}` };
};

const parseNotionUrl = (urlString) => {
  const { host, parsed } = parseHost(urlString);
  if (!parsed) return null;
  if (host !== 'notion.so' && host !== 'www.notion.so') return null;
  return { canonicalUrl: parsed.toString() };
};

const parseConfluenceUrl = (urlString) => {
  const { host, parsed } = parseHost(urlString);
  if (!parsed) return null;
  if (!host.includes('atlassian.net') && !parsed.pathname.toLowerCase().includes('/confluence/')) return null;
  return { canonicalUrl: parsed.toString() };
};

const parseStackOverflowUrl = (urlString) => {
  const { host, parsed } = parseHost(urlString);
  if (!parsed || host !== 'stackoverflow.com') return null;
  const m = parsed.pathname.match(/\/questions\/(\d+)/i);
  if (!m) return null;
  return { questionId: m[1], canonicalUrl: `https://stackoverflow.com/questions/${m[1]}` };
};

const parseArxivUrl = (urlString) => {
  const { host, parsed } = parseHost(urlString);
  if (!parsed || (host !== 'arxiv.org' && host !== 'www.arxiv.org')) return null;
  const m = parsed.pathname.match(/\/(?:abs|pdf)\/([^/?#]+)/i);
  if (!m) return null;
  const paperId = m[1].replace(/\.pdf$/i, '');
  return { paperId, canonicalUrl: `https://arxiv.org/abs/${paperId}` };
};

const parsePubmedUrl = (urlString) => {
  const { host, parsed } = parseHost(urlString);
  if (!parsed) return null;
  const pubmedHost = host === 'pubmed.ncbi.nlm.nih.gov' || host.endsWith('.ncbi.nlm.nih.gov');
  if (!pubmedHost) return null;
  const m = parsed.pathname.match(/\/(\d+)\/?/);
  if (!m) return null;
  return { pmid: m[1], canonicalUrl: `https://pubmed.ncbi.nlm.nih.gov/${m[1]}/` };
};

const parseGoogleDocsUrl = (urlString) => {
  const { host, parsed } = parseHost(urlString);
  if (!parsed || host !== 'docs.google.com') return null;
  if (!parsed.pathname.includes('/document/')) return null;
  return { canonicalUrl: parsed.toString() };
};

const parseSharePointUrl = (urlString) => {
  const { host, parsed } = parseHost(urlString);
  if (!parsed) return null;
  if (!host.includes('sharepoint.com')) return null;
  return { canonicalUrl: parsed.toString() };
};

const parseMediumOrSubstackUrl = (urlString) => {
  const { host, parsed } = parseHost(urlString);
  if (!parsed) return null;
  const isMedium = host === 'medium.com' || host.endsWith('.medium.com');
  const isSubstack = host.endsWith('.substack.com');
  if (!isMedium && !isSubstack) return null;
  return { canonicalUrl: parsed.toString(), source: isMedium ? 'medium' : 'substack' };
};

const parseYouTubeUrl = (urlString) => {
  const { host, parsed } = parseHost(urlString);
  if (!parsed) return null;
  const isYouTube = host === 'youtube.com' || host === 'www.youtube.com' || host === 'youtu.be';
  if (!isYouTube) return null;
  let videoId = parsed.searchParams.get('v');
  if (!videoId && host === 'youtu.be') videoId = parsed.pathname.split('/').filter(Boolean)[0];
  if (!videoId) return null;
  return { videoId, canonicalUrl: `https://www.youtube.com/watch?v=${videoId}` };
};

const parseRedditUrl = (urlString) => {
  const { host, parsed } = parseHost(urlString);
  if (!parsed || (host !== 'reddit.com' && host !== 'www.reddit.com')) return null;
  if (!parsed.pathname.includes('/comments/')) return null;
  return { canonicalUrl: parsed.toString() };
};

const parseQuoraUrl = (urlString) => {
  const { host, parsed } = parseHost(urlString);
  if (!parsed || (host !== 'quora.com' && host !== 'www.quora.com')) return null;
  return { canonicalUrl: parsed.toString() };
};

const parseApiDocsUrl = (urlString) => {
  const { host, parsed } = parseHost(urlString);
  if (!parsed) return null;
  const path = parsed.pathname.toLowerCase();
  const looksLikeApiDoc = path.includes('/swagger') || path.includes('/openapi') || path.endsWith('/api-docs') || path.endsWith('/docs');
  if (!looksLikeApiDoc) return null;
  return { canonicalUrl: parsed.toString(), host };
};

const parseGovLegalUrl = (urlString) => {
  const { host, parsed } = parseHost(urlString);
  if (!parsed) return null;
  const looksGov = host.endsWith('.gov') || host.includes('.gov.');
  const looksLegal = host.includes('court') || host.includes('law') || host.includes('legislation') || host.includes('justice');
  if (!looksGov && !looksLegal) return null;
  return { canonicalUrl: parsed.toString() };
};

const htmlToText = (html = '') => String(html || '')
  .replace(/<script[\s\S]*?<\/script>/gi, '')
  .replace(/<style[\s\S]*?<\/style>/gi, '')
  .replace(/<[^>]+>/g, ' ')
  .replace(/\s+/g, ' ')
  .trim();

const readGitLabRepo = async (urlString, options = {}) => {
  const repo = parseGitLabRepoUrl(urlString);
  if (!repo) return null;
  const timeout = Number(options.timeout || process.env.WEB_SEARCH_TIMEOUT_MS || 8000);
  const maxFiles = Number(options.maxFiles || DEFAULT_MAX_FILES);
  const maxFileBytes = Number(options.maxFileBytes || DEFAULT_MAX_FILE_BYTES);
  const maxTotalChars = Number(options.maxTotalChars || DEFAULT_MAX_TOTAL_CHARS);

  const projectId = encodeURIComponent(`${repo.owner}/${repo.repo}`);
  const projectRes = await axios.get(`https://gitlab.com/api/v4/projects/${projectId}`, { timeout });
  const defaultBranch = String(projectRes?.data?.default_branch || 'main');
  const treeRes = await axios.get(
    `https://gitlab.com/api/v4/projects/${projectId}/repository/tree`,
    { timeout, params: { recursive: true, per_page: 100 } }
  );
  const files = (treeRes?.data || [])
    .filter((f) => f?.type === 'blob')
    .filter((f) => shouldIncludeRepoPath(f?.path))
    .slice(0, maxFiles);

  const chunks = [];
  for (const file of files) {
    const rawUrl = `https://gitlab.com/${repo.owner}/${repo.repo}/-/raw/${encodeURIComponent(defaultBranch)}/${file.path}`;
    try {
      const res = await axios.get(rawUrl, { timeout, responseType: 'text' });
      const text = String(res?.data || '').trim();
      if (!text || text.length > maxFileBytes) continue;
      chunks.push(`## ${file.path}\n${text}`);
    } catch {
      // continue
    }
  }
  const clipped = trimToTotalChars(chunks, maxTotalChars);
  if (clipped.length === 0) return [];
  return [{
    url: repo.canonicalUrl,
    title: `${repo.owner}/${repo.repo}`,
    text: [`GitLab repository: ${repo.owner}/${repo.repo}`, `Branch: ${defaultBranch}`, '', ...clipped].join('\n'),
    source: 'gitlab',
  }];
};

const readBitbucketRepo = async (urlString, options = {}) => {
  const repo = parseBitbucketRepoUrl(urlString);
  if (!repo) return null;
  const timeout = Number(options.timeout || process.env.WEB_SEARCH_TIMEOUT_MS || 8000);
  const maxFiles = Number(options.maxFiles || DEFAULT_MAX_FILES);
  const maxFileBytes = Number(options.maxFileBytes || DEFAULT_MAX_FILE_BYTES);
  const maxTotalChars = Number(options.maxTotalChars || DEFAULT_MAX_TOTAL_CHARS);

  const refRes = await axios.get(
    `https://api.bitbucket.org/2.0/repositories/${repo.workspace}/${repo.repo}`,
    { timeout }
  );
  const defaultBranch = String(refRes?.data?.mainbranch?.name || 'main');
  const treeRes = await axios.get(
    `https://api.bitbucket.org/2.0/repositories/${repo.workspace}/${repo.repo}/src/${encodeURIComponent(defaultBranch)}/`,
    { timeout, params: { pagelen: 100 } }
  );
  const files = (treeRes?.data?.values || [])
    .filter((entry) => entry?.type === 'commit_file')
    .filter((entry) => shouldIncludeRepoPath(entry?.path))
    .slice(0, maxFiles);

  const chunks = [];
  for (const file of files) {
    try {
      const rawRes = await axios.get(
        `https://api.bitbucket.org/2.0/repositories/${repo.workspace}/${repo.repo}/src/${encodeURIComponent(defaultBranch)}/${file.path}`,
        { timeout, responseType: 'text' }
      );
      const text = String(rawRes?.data || '').trim();
      if (!text || text.length > maxFileBytes) continue;
      chunks.push(`## ${file.path}\n${text}`);
    } catch {
      // continue
    }
  }
  const clipped = trimToTotalChars(chunks, maxTotalChars);
  if (clipped.length === 0) return [];
  return [{
    url: repo.canonicalUrl,
    title: `${repo.workspace}/${repo.repo}`,
    text: [`Bitbucket repository: ${repo.workspace}/${repo.repo}`, `Branch: ${defaultBranch}`, '', ...clipped].join('\n'),
    source: 'bitbucket',
  }];
};

const readNotionPage = async (urlString, options = {}) => {
  const page = parseNotionUrl(urlString);
  if (!page) return null;
  const timeout = Number(options.timeout || process.env.WEB_SEARCH_TIMEOUT_MS || 8000);
  const res = await axios.get(page.canonicalUrl, { timeout, responseType: 'text' });
  const html = String(res?.data || '');
  const text = html.replace(/<script[\s\S]*?<\/script>/gi, '').replace(/<style[\s\S]*?<\/style>/gi, '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  if (!text) return [];
  return [{
    url: page.canonicalUrl,
    title: 'Notion page',
    text: text.slice(0, DEFAULT_MAX_TOTAL_CHARS),
    source: 'notion',
  }];
};

const readConfluencePage = async (urlString, options = {}) => {
  const page = parseConfluenceUrl(urlString);
  if (!page) return null;
  const timeout = Number(options.timeout || process.env.WEB_SEARCH_TIMEOUT_MS || 8000);
  const res = await axios.get(page.canonicalUrl, { timeout, responseType: 'text' });
  const html = String(res?.data || '');
  const text = html.replace(/<script[\s\S]*?<\/script>/gi, '').replace(/<style[\s\S]*?<\/style>/gi, '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  if (!text) return [];
  return [{
    url: page.canonicalUrl,
    title: 'Confluence page',
    text: text.slice(0, DEFAULT_MAX_TOTAL_CHARS),
    source: 'confluence',
  }];
};

const readStackOverflowThread = async (urlString, options = {}) => {
  const thread = parseStackOverflowUrl(urlString);
  if (!thread) return null;
  const timeout = Number(options.timeout || process.env.WEB_SEARCH_TIMEOUT_MS || 8000);
  const apiRes = await axios.get(
    `https://api.stackexchange.com/2.3/questions/${thread.questionId}`,
    {
      timeout,
      params: { site: 'stackoverflow', filter: 'withbody' },
    }
  );
  const q = apiRes?.data?.items?.[0];
  if (!q) return [];
  const answersRes = await axios.get(
    `https://api.stackexchange.com/2.3/questions/${thread.questionId}/answers`,
    { timeout, params: { site: 'stackoverflow', filter: 'withbody', sort: 'votes' } }
  );
  const clean = (html) => String(html || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  const chunks = [`# ${safeDecode(q.title)}\n${clean(q.body)}`];
  for (const a of answersRes?.data?.items || []) {
    chunks.push(`## Answer (score: ${a.score || 0})\n${clean(a.body)}`);
  }
  const text = trimToTotalChars(chunks, DEFAULT_MAX_TOTAL_CHARS).join('\n\n');
  return [{
    url: thread.canonicalUrl,
    title: safeDecode(q.title || thread.canonicalUrl),
    text,
    source: 'stackoverflow',
  }];
};

const readArxivPaper = async (urlString, options = {}) => {
  const parsed = parseArxivUrl(urlString);
  if (!parsed) return null;
  const timeout = Number(options.timeout || process.env.WEB_SEARCH_TIMEOUT_MS || 8000);
  const api = `https://export.arxiv.org/api/query?id_list=${encodeURIComponent(parsed.paperId)}`;
  const res = await axios.get(api, { timeout, responseType: 'text' });
  const xml = String(res?.data || '');
  const title = (xml.match(/<title>([\s\S]*?)<\/title>/i)?.[1] || '').replace(/\s+/g, ' ').trim();
  const summary = (xml.match(/<summary>([\s\S]*?)<\/summary>/i)?.[1] || '').replace(/\s+/g, ' ').trim();
  if (!title && !summary) return [];
  return [{ url: parsed.canonicalUrl, title: title || parsed.paperId, text: `Title: ${title}\n\nAbstract:\n${summary}`, source: 'arxiv' }];
};

const readPubmedArticle = async (urlString, options = {}) => {
  const parsed = parsePubmedUrl(urlString);
  if (!parsed) return null;
  const timeout = Number(options.timeout || process.env.WEB_SEARCH_TIMEOUT_MS || 8000);
  const api = `https://eutils.ncbi.nlm.nih.gov/entrez/eutils/efetch.fcgi?db=pubmed&id=${encodeURIComponent(parsed.pmid)}&retmode=xml`;
  const res = await axios.get(api, { timeout, responseType: 'text' });
  const xml = String(res?.data || '');
  const title = (xml.match(/<ArticleTitle>([\s\S]*?)<\/ArticleTitle>/i)?.[1] || '').replace(/\s+/g, ' ').trim();
  const abstract = [...xml.matchAll(/<AbstractText[^>]*>([\s\S]*?)<\/AbstractText>/gi)].map((m) => String(m[1] || '').replace(/\s+/g, ' ').trim()).join('\n');
  if (!title && !abstract) return [];
  return [{ url: parsed.canonicalUrl, title: title || `PubMed ${parsed.pmid}`, text: `Title: ${title}\n\nAbstract:\n${abstract}`, source: 'pubmed' }];
};

const readGoogleDoc = async (urlString, options = {}) => {
  const parsed = parseGoogleDocsUrl(urlString);
  if (!parsed) return null;
  const timeout = Number(options.timeout || process.env.WEB_SEARCH_TIMEOUT_MS || 8000);
  const pubUrl = parsed.canonicalUrl.replace(/\/edit.*$/i, '/export?format=txt');
  const res = await axios.get(pubUrl, { timeout, responseType: 'text' });
  const text = String(res?.data || '').trim();
  if (!text) return [];
  return [{ url: parsed.canonicalUrl, title: 'Google Doc', text: text.slice(0, DEFAULT_MAX_TOTAL_CHARS), source: 'google_docs' }];
};

const readSharePointPage = async (urlString, options = {}) => {
  const parsed = parseSharePointUrl(urlString);
  if (!parsed) return null;
  const timeout = Number(options.timeout || process.env.WEB_SEARCH_TIMEOUT_MS || 8000);
  const res = await axios.get(parsed.canonicalUrl, { timeout, responseType: 'text' });
  const text = htmlToText(res?.data || '');
  if (!text) return [];
  return [{ url: parsed.canonicalUrl, title: 'SharePoint page', text: text.slice(0, DEFAULT_MAX_TOTAL_CHARS), source: 'sharepoint' }];
};

const readArticlePage = async (urlString, options = {}) => {
  const parsed = parseMediumOrSubstackUrl(urlString);
  if (!parsed) return null;
  const timeout = Number(options.timeout || process.env.WEB_SEARCH_TIMEOUT_MS || 8000);
  const res = await axios.get(parsed.canonicalUrl, { timeout, responseType: 'text' });
  const text = htmlToText(res?.data || '');
  if (!text) return [];
  return [{ url: parsed.canonicalUrl, title: `${parsed.source} article`, text: text.slice(0, DEFAULT_MAX_TOTAL_CHARS), source: parsed.source }];
};

const readYouTubeVideo = async (urlString, options = {}) => {
  const parsed = parseYouTubeUrl(urlString);
  if (!parsed) return null;
  const timeout = Number(options.timeout || process.env.WEB_SEARCH_TIMEOUT_MS || 8000);
  const oembed = await axios.get('https://www.youtube.com/oembed', { timeout, params: { url: parsed.canonicalUrl, format: 'json' } });
  const title = String(oembed?.data?.title || `YouTube video ${parsed.videoId}`);
  return [{ url: parsed.canonicalUrl, title, text: `Video title: ${title}\nURL: ${parsed.canonicalUrl}\nNote: transcript extraction not available in this environment; use web fallback if needed.`, source: 'youtube' }];
};

const readRedditThread = async (urlString, options = {}) => {
  const parsed = parseRedditUrl(urlString);
  if (!parsed) return null;
  const timeout = Number(options.timeout || process.env.WEB_SEARCH_TIMEOUT_MS || 8000);
  const jsonUrl = parsed.canonicalUrl.replace(/\/$/, '') + '.json';
  const res = await axios.get(jsonUrl, { timeout, headers: { 'User-Agent': 'multi-ai-chat-url-reader' } });
  const post = res?.data?.[0]?.data?.children?.[0]?.data;
  if (!post) return [];
  const comments = (res?.data?.[1]?.data?.children || [])
    .map((c) => c?.data?.body)
    .filter(Boolean)
    .slice(0, 10)
    .map((c, i) => `Comment ${i + 1}: ${String(c).replace(/\s+/g, ' ').trim()}`);
  const body = String(post.selftext || '').replace(/\s+/g, ' ').trim();
  const text = [`Title: ${post.title || ''}`, body, ...comments].join('\n\n').slice(0, DEFAULT_MAX_TOTAL_CHARS);
  return [{ url: parsed.canonicalUrl, title: post.title || 'Reddit thread', text, source: 'reddit' }];
};

const readQuoraPage = async (urlString, options = {}) => {
  const parsed = parseQuoraUrl(urlString);
  if (!parsed) return null;
  const timeout = Number(options.timeout || process.env.WEB_SEARCH_TIMEOUT_MS || 8000);
  const res = await axios.get(parsed.canonicalUrl, { timeout, responseType: 'text' });
  const text = htmlToText(res?.data || '');
  if (!text) return [];
  return [{ url: parsed.canonicalUrl, title: 'Quora page', text: text.slice(0, DEFAULT_MAX_TOTAL_CHARS), source: 'quora' }];
};

const readApiDocsPage = async (urlString, options = {}) => {
  const parsed = parseApiDocsUrl(urlString);
  if (!parsed) return null;
  const timeout = Number(options.timeout || process.env.WEB_SEARCH_TIMEOUT_MS || 8000);
  const jsonCandidates = [
    `${parsed.canonicalUrl.replace(/\/$/, '')}/openapi.json`,
    `${parsed.canonicalUrl.replace(/\/$/, '')}/swagger.json`,
  ];
  for (const candidate of jsonCandidates) {
    try {
      const res = await axios.get(candidate, { timeout, responseType: 'json' });
      const body = typeof res?.data === 'object' ? JSON.stringify(res.data) : String(res?.data || '');
      if (body) return [{ url: parsed.canonicalUrl, title: 'API docs', text: body.slice(0, DEFAULT_MAX_TOTAL_CHARS), source: 'api_docs' }];
    } catch {
      // continue
    }
  }
  const page = await axios.get(parsed.canonicalUrl, { timeout, responseType: 'text' });
  const text = htmlToText(page?.data || '');
  if (!text) return [];
  return [{ url: parsed.canonicalUrl, title: 'API docs page', text: text.slice(0, DEFAULT_MAX_TOTAL_CHARS), source: 'api_docs' }];
};

const readGovLegalPage = async (urlString, options = {}) => {
  const parsed = parseGovLegalUrl(urlString);
  if (!parsed) return null;
  const timeout = Number(options.timeout || process.env.WEB_SEARCH_TIMEOUT_MS || 8000);
  const page = await axios.get(parsed.canonicalUrl, { timeout, responseType: 'text' });
  const text = htmlToText(page?.data || '');
  if (!text) return [];
  return [{ url: parsed.canonicalUrl, title: 'Government/Legal page', text: text.slice(0, DEFAULT_MAX_TOTAL_CHARS), source: 'gov_legal' }];
};

const readSiteSpecificUrl = async (urlString, options = {}) => {
  const readers = [
    readGitLabRepo,
    readBitbucketRepo,
    readArxivPaper,
    readPubmedArticle,
    readGoogleDoc,
    readSharePointPage,
    readArticlePage,
    readYouTubeVideo,
    readRedditThread,
    readQuoraPage,
    readApiDocsPage,
    readGovLegalPage,
    readStackOverflowThread,
    readNotionPage,
    readConfluencePage,
  ];
  for (const reader of readers) {
    try {
      const out = await reader(urlString, options);
      if (Array.isArray(out) && out.length > 0) return out;
    } catch {
      // continue
    }
  }
  return [];
};

module.exports = {
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
  readSiteSpecificUrl,
};
