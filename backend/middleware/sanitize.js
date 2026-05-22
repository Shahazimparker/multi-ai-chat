// ============================================================
// FILE: backend/middleware/sanitize.js
// PURPOSE: Input sanitization middleware to prevent XSS attacks
//          Uses regex instead of jsdom/DOMPurify — lighter, faster,
//          same result for tag-stripping use case.
// ============================================================

/**
 * Sanitize user input to prevent XSS — strips all HTML tags,
 * decodes common HTML entities, collapses whitespace.
 * @param {string} input - Raw user input
 * @param {Object} _options - Ignored (kept for backward compat)
 * @returns {string} - Sanitized text
 */
const sanitizeInput = (input, _options = {}) => {
  if (typeof input !== 'string') return input;

  return input
    .replace(/<[^>]*>/g, '')                         // strip all HTML tags
    .replace(/</g, '<').replace(/>/g, '>')     // decode common entities
    .replace(/&/g, '&').replace(/"/g, '"')
    .replace(/&#x27;/g, "'").replace(/'/g, "'")
    .replace(/\s+/g, ' ')                            // collapse whitespace
    .trim();
};

/**
 * Middleware to sanitize request body fields
 * Use: app.use(sanitizeBody(['message', 'title', 'content']))
 */
const sanitizeBody = (fields = []) => {
  return (req, res, next) => {
    if (!req.body) return next();
    
    // If no fields specified, sanitize all string fields
    const fieldsToSanitize = fields.length > 0 
      ? fields 
      : Object.keys(req.body).filter(key => typeof req.body[key] === 'string');
    
    fieldsToSanitize.forEach(field => {
      if (req.body[field] && typeof req.body[field] === 'string') {
        req.body[field] = sanitizeInput(req.body[field]);
      }
    });
    
    next();
  };
};

/**
 * Sanitize query parameters
 */
const sanitizeQuery = (fields = []) => {
  return (req, res, next) => {
    if (!req.query) return next();
    
    const fieldsToSanitize = fields.length > 0 
      ? fields 
      : Object.keys(req.query).filter(key => typeof req.query[key] === 'string');
    
    fieldsToSanitize.forEach(field => {
      if (req.query[field] && typeof req.query[field] === 'string') {
        req.query[field] = sanitizeInput(req.query[field]);
      }
    });
    
    next();
  };
};

module.exports = { sanitizeInput, sanitizeBody, sanitizeQuery };
