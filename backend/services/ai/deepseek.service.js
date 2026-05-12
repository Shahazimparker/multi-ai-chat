// ============================================================
// FILE: backend/services/ai/deepseek.service.js
// PURPOSE: Calls Deepseek flash
// ============================================================

const axios = require('axios');

const calldeepseekAPI = async (model, apiKey, messages, signal = null) => {
    const response = await axios.post(
        'https://api.deepseek.com/v1/chat/completions',  // ← URL here
        {
            model,
            messages,
            max_tokens: 10000,
            temperature: 0.7,
        },
        {
            headers: {
                'Authorization': `Bearer ${apiKey}`,
            },
            signal,
        }
    );

    return {
        text: response.data.choices[0].message.content,
        tokensUsed: response.data.usage?.total_tokens || 0,
    };
};

module.exports = { calldeepseekAPI };