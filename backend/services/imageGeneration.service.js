// FILE: backend/services/imageGeneration.service.js
// PURPOSE: AI image generation — OpenRouter (FLUX) or DALL-E 3 (OpenAI direct)
const OpenAI = require('openai');
const axios = require('axios');
const { saveGeneratedBinaryFile } = require('./fileUpload.service');

// OpenRouter image-generation models via chat completions API
// Ordered by preference: pick the first one that succeeds
const OPENROUTER_IMAGE_MODELS = [
  { model: 'recraft/recraft-v4.1',                 label: 'Recraft v4.1'      },
  { model: 'black-forest-labs/flux.2-klein-4b',    label: 'FLUX.2 Klein 4B'  },
  { model: 'black-forest-labs/flux.2-flex',        label: 'FLUX.2 Flex'      },
  { model: 'black-forest-labs/flux.2-pro',        label: 'FLUX.2 Pro'       },
];

/**
 * Download an image from a URL and return a Buffer.
 */
const fetchImageBuffer = async (url) => {
  const response = await axios.get(url, { responseType: 'arraybuffer', timeout: 30000 });
  return Buffer.from(response.data);
};

/**
 * Generate an image using OpenRouter chat completions API.
 * OpenRouter image models (FLUX, Recraft) return an image URL in the chat response.
 * Falls through model list until one succeeds.
 */
const generateViaOpenRouter = async (prompt, modelOverride = null) => {
  const openai = new OpenAI({
    baseURL: 'https://openrouter.ai/api/v1',
    apiKey: process.env.OPENROUTER_API_KEY,
    defaultHeaders: {
      'HTTP-Referer': process.env.FRONTEND_URL || 'https://multi-ai-chat.app',
      'X-Title': 'Multi-AI Chat',
    },
  });

  const modelsToTry = modelOverride
    ? [{ model: modelOverride, label: modelOverride }]
    : OPENROUTER_IMAGE_MODELS;

  let lastErr;
  for (const { model, label } of modelsToTry) {
    try {
      console.log(`[ImageGen] Trying OpenRouter model: ${label} (${model})`);
      const response = await openai.chat.completions.create({
        model,
        messages: [
          { role: 'user', content: prompt },
        ],
        max_tokens: 4096,
      });

      const message = response.choices?.[0]?.message || {};

      // Check for image in message.images array (OpenRouter native format)
      if (message.images && message.images.length > 0) {
        const img = message.images[0];
        const imgUrl = img?.image_url?.url || img?.url;
        if (imgUrl) {
          if (imgUrl.startsWith('data:')) {
            // Base64 data URL — decode directly
            const b64 = imgUrl.split(',')[1];
            if (b64) {
              console.log(`[ImageGen] ${label} returned base64 image (${b64.length} chars)`);
              return { buffer: Buffer.from(b64, 'base64'), model: label };
            }
          } else {
            // Remote URL — download
            console.log(`[ImageGen] ${label} returned image URL: ${imgUrl.slice(0, 80)}...`);
            const buffer = await fetchImageBuffer(imgUrl);
            return { buffer, model: label };
          }
        }
      }

      // Fallback: extract image URL from markdown or raw URL in content
      const content = message.content || '';
      const urlMatch = content.match(/!\[.*?\]\((https?:\/\/[^\s)]+)\)/) || content.match(/(https?:\/\/[^\s]+\.(?:png|jpg|jpeg|webp|gif))/i);
      if (urlMatch) {
        const imageUrl = urlMatch[1] || urlMatch[0];
        console.log(`[ImageGen] ${label} returned image URL in content: ${imageUrl.slice(0, 80)}...`);
        const buffer = await fetchImageBuffer(imageUrl);
        return { buffer, model: label };
      }

      throw new Error(`No image found in response (content: "${content.slice(0, 100)}", images: ${(message.images || []).length})`);
    } catch (err) {
      lastErr = err;
      console.warn(`[ImageGen] ${label} failed: ${err.message}`);
    }
  }
  throw lastErr || new Error('All OpenRouter image models failed');
};

/**
 * Generate an image using DALL-E 3 directly via OpenAI API.
 */
const generateViaDallE = async (prompt, size, quality) => {
  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  console.log(`[ImageGen] Using DALL-E 3 (OpenAI direct) size=${size}`);

  const response = await openai.images.generate({
    model: 'dall-e-3',
    prompt,
    n: 1,
    size,
    quality,
    response_format: 'b64_json',
  });

  const item = response.data[0];
  return {
    buffer: Buffer.from(item.b64_json, 'base64'),
    revisedPrompt: item.revised_prompt || prompt,
    model: 'DALL-E 3',
  };
};

/**
 * Main entry point — generate an image and save to DB.
 * Priority:
 *   1. options.model specified (use that exact OpenRouter model)
 *   2. OPENROUTER_API_KEY present → OpenRouter (FLUX 1.1 Pro → FLUX Pro → FLUX Schnell)
 *   3. OPENAI_API_KEY present      → DALL-E 3
 *
 * @param {string} prompt
 * @param {string} userId
 * @param {string|null} topicId
 * @param {object} options  - model (OpenRouter model id), size, quality
 */
const generateImage = async (prompt, userId, topicId, options = {}) => {
  const hasOpenRouter = !!process.env.OPENROUTER_API_KEY;
  const hasOpenAI    = !!process.env.OPENAI_API_KEY;

  if (!hasOpenRouter && !hasOpenAI) {
    throw new Error(
      'No image generation API key configured. ' +
      'Add OPENROUTER_API_KEY (for FLUX models) or OPENAI_API_KEY (for DALL-E 3) to .env'
    );
  }

  console.log(`[ImageGen] Generating: "${prompt.slice(0, 80)}..."`);

  let buffer, modelUsed, revisedPrompt = prompt;

  if (options.model) {
    // Caller specified a specific OpenRouter model
    ({ buffer, model: modelUsed } = await generateViaOpenRouter(prompt, options.model));
  } else if (hasOpenRouter) {
    ({ buffer, model: modelUsed } = await generateViaOpenRouter(prompt));
  } else {
    const result = await generateViaDallE(prompt, options.size || '1024x1024', options.quality || 'standard');
    buffer = result.buffer;
    modelUsed = result.model;
    revisedPrompt = result.revisedPrompt;
  }

  const safeName = prompt
    .slice(0, 40)
    .replace(/[^a-z0-9\s]/gi, '')
    .trim()
    .replace(/\s+/g, '_')
    .toLowerCase() || 'generated';

  const fileName = `image_${safeName}_${Date.now()}.png`;
  const textContent = `AI Generated Image (${modelUsed})\nPrompt: ${prompt}\nRevised: ${revisedPrompt}`;

  const result = await saveGeneratedBinaryFile(userId, topicId, fileName, textContent, 'png', buffer);
  if (!result) throw new Error('Failed to save generated image to database');

  console.log(`[ImageGen] Saved as ${result.file_name} (id: ${result.file_id}, model: ${modelUsed})`);
  return { ...result, revisedPrompt, modelUsed };
};

module.exports = { generateImage, OPENROUTER_IMAGE_MODELS };
