const axios = require('axios');

/**
 * Searches the web using DuckDuckGo Instant Answers API.
 * Falls back to Wikipedia if DuckDuckGo returns no results.
 * @param {string} query
 * @returns {Promise<Array>} Array of { title, snippet, url }
 */
const searchWeb = async (query) => {
  // ── DuckDuckGo (primary) ──
  try {
    const response = await axios.get('https://api.duckduckgo.com/', {
      params: {
        q: query,
        format: 'json',
        no_html: 1,
        skip_disambig: 1
      },
      headers: {
        'User-Agent': 'MultiAIChatBot/1.0 (https://github.com/Azim/multi-ai-chat) axios/1.7.9'
      }
    });

    const data = response.data;
    const results = [];

    // Abstract (main answer)
    if (data.AbstractText) {
      results.push({
        title: data.Heading || query,
        snippet: data.AbstractText,
        url: data.AbstractURL || `https://duckduckgo.com/?q=${encodeURIComponent(query)}`
      });
    }

    // Related topics
    if (data.RelatedTopics && data.RelatedTopics.length > 0) {
      for (const topic of data.RelatedTopics) {
        if (results.length >= 5) break;
        if (topic.Text && topic.FirstURL) {
          results.push({
            title: topic.Text.split(' - ')[0] || query,
            snippet: topic.Text,
            url: topic.FirstURL
          });
        }
      }
    }

    if (results.length > 0) return results;
  } catch (err) {
    console.error('[WebSearch] DuckDuckGo error:', err.message);
  }

  // ── Wikipedia fallback ──
  try {
    const response = await axios.get('https://en.wikipedia.org/w/api.php', {
      params: {
        action: 'query',
        list: 'search',
        srsearch: query,
        utf8: '',
        format: 'json'
      },
      headers: {
        'User-Agent': 'MultiAIChatBot/1.0 (https://github.com/Azim/multi-ai-chat) axios/1.7.9'
      }
    });

    if (!response.data || !response.data.query || !response.data.query.search) {
      return [];
    }

    const results = response.data.query.search.slice(0, 5).map(item => ({
      title: item.title,
      snippet: item.snippet.replace(/<[^>]+>/g, ''),
      url: `https://en.wikipedia.org/wiki/${encodeURIComponent(item.title.replace(/ /g, '_'))}`
    }));
    
    return results;
  } catch (err) {
    console.error('[WebSearch] Wikipedia error:', err.message);
    return [];
  }
};

module.exports = { searchWeb };
