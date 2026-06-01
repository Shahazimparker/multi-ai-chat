/**
 * Tools Catalog
 *
 * External capabilities invoked by toolProcessor during a chat turn.
 *
 * toolProcessor ──► webSearch   (Exa → Firecrawl → Tavily → SerpAPI → LangSearch)
 *              ──► urlReader    (validates URL, detects GitHub, dispatches to siteReaders)
 *                    └── githubReader  (GitHub API + raw content)
 *                    └── siteReaders   (GitLab, Bitbucket, arXiv, docs sites, YouTube…)
 *              ──► codeExecute  (sandboxed worker_thread, 2 s timeout, 5 KB limit)
 *              ──► rerank       (LangSearch BM25 reranking — wired but optional)
 */

const lazy = (path) => {
  let cache;
  return new Proxy({}, {
    get(_, key) { return (cache ??= require(path))[key]; }
  });
};

exports.webSearch    = lazy('./webSearch.service');
exports.urlReader    = lazy('./urlReader.service');
exports.githubReader = lazy('./githubReader.service');
exports.siteReaders  = lazy('./siteReaders.service');
exports.codeExecute  = lazy('./codeExecute.service');
exports.rerank       = lazy('./rerank.service');
