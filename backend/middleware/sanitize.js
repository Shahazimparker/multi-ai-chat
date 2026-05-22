// ============================================================
// FILE: backend/middleware/sanitize.js
// PURPOSE: Input sanitization middleware to prevent XSS attacks
// ============================================================

const DOMPurify = require('isomorphic-dompurify');

/**
 * Sanitize user input to prevent XSS
 * @param {string} input - Raw user input
 * @param {Object} options - Sanitization options
 * @returns {string} - Sanitized text
 */
const sanitizeInput = (input, options = {}) => {
  if (typeof input !== 'string') return input;
  
  const defaultOptions = {
    ALLOWED_TAGS: [],        // Strip all HTML tags
    KEEP_CONTENT: true,      // Keep text content
    ALLOWED_ATTR: [],        // No attributes allowed
    ...options
  };
  
  return DOMPurify.sanitize(input, defaultOptions);
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
