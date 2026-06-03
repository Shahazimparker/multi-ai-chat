declare namespace NodeJS {
  interface ProcessEnv {
    EXA_API_KEY?: string;
    TAVILY_API_KEY?: string;
    FIRECRAWL_API_KEY?: string;
    SERPAPI_API_KEY?: string;
    LANGSEARCH_API_KEY?: string;
    LANGSEARCH_FRESHNESS?: string;
    LANGSEARCH_SUMMARY?: string;
    WEB_SEARCH_TIMEOUT_MS?: string;
    WEB_SEARCH_MAX_RESULTS?: string;
  }
}
