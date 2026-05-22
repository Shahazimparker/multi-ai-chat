// ============================================================
// FILE: backend/services/ai/deepseek.service.js
// PURPOSE: Calls Deepseek flash
// ============================================================

const axios = require('axios');

const calldeepseekAPI = async (model, apiKey, messages, signal = null, modelConfig = null) => {
    const body = {
        model,
        messages,
        max_tokens: 16000,
        temperature: modelConfig?.temperature ?? 0.7,
    };

    // Inject reasoning params if configured
    if (modelConfig?.reasoning) {
        if (modelConfig.reasoning.thinking) {
            body.thinking = { type: modelConfig.reasoning.thinking };
        }
        if (modelConfig.reasoning.reasoningEffort) {
            body.reasoning_effort = modelConfig.reasoning.reasoningEffort;
        }
    }

    const response = await axios.post(
        'https://api.deepseek.com/v1/chat/completions',  // ← URL here
        body,
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