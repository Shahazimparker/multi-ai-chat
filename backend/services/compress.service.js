// ============================================================
// FILE: backend/services/compress.service.js
// PURPOSE: Removes low-value words from prompts to save input tokens
//          Strips: please, kindly, can you, guide me, help me, etc.
// ============================================================

// Regex patterns for common polite/filler phrases
const FILLER_PATTERNS = [
  /\b(please|kindly|do me a favor|if you don't mind)\b/gi,
  /\b(can you|could you|would you|will you)\s+(please\s+)?(help me\s+)?/gi,
  /\b(i would like you to|i want you to|i need you to)\s+/gi,
  /\b(help me (to\s+)?|guide me (to\s+)?|assist me (in\s+)?)/gi,
  /\b(as an ai|as a language model|as chatgpt|as claude)\b/gi,
  /\b(i hope (you are )?(doing well|fine)\.?\s*)/gi,
  /\b(thank you( in advance)?\.?\s*)/gi,
];

/**
 * compressPrompt — strips filler words and collapses whitespace
 * @param {string} text  raw user input
 * @returns {string}     compressed prompt
 */
const compressPrompt = (text) => {
  if (!text || text.length < 50) return text; // short prompts — skip compression

  let compressed = text;
  for (const pattern of FILLER_PATTERNS) {
    compressed = compressed.replace(pattern, '');
  }

  // Collapse multiple spaces/newlines
  compressed = compressed.replace(/\s{2,}/g, ' ').trim();

  // If compression removed too much (>50%), return original to be safe
  if (compressed.length < text.length * 0.5) return text;

  return compressed;
};

module.exports = { compressPrompt };
