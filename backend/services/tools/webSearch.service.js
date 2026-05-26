const axios = require('axios');

/**
 * Searches Wikipedia and extracts results.
 * @param {string} query 
 * @returns {Promise<Array>} Array of { title, snippet, url }
 */
const searchWeb = async (query) => {
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
      snippet: item.snippet.replace(/<[^>]+>/g, ''), // Strip HTML from snippet
      url: `https://en.wikipedia.org/wiki/${encodeURIComponent(item.title.replace(/ /g, '_'))}`
    }));
    
    return results;
  } catch (err) {
    console.error('[WebSearch] Error:', err.message);
    return [];
  }
};

module.exports = { searchWeb };
