// ============================================================
// FILE: backend/middleware/sanitize.js
// PURPOSE: Input sanitization middleware to reduce XSS payloads
// ============================================================

const ENTITY_MAP = {
  '&lt;': '<',
  '&gt;': '>',
  '&amp;': '&',
  '&quot;': '"',
  '&#39;': "'",
  '&#x27;': "'",
};

const decodeEntities = (value) => value.replace(/&(lt|gt|amp|quot|#39|#x27);/gi, (match) => {
  const key = match.toLowerCase();
  return ENTITY_MAP[key] ?? match;
});

const sanitizeInput = (input, _options = {}) => {
  if (typeof input !== 'string') return input;

  return decodeEntities(input)
    .replace(/<[^>]*>/g, '')
    // eslint-disable-next-line no-control-regex -- stripping control characters is this sanitizer's purpose
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '')
    .replace(/\u2028|\u2029/g, ' ')
    .trim();
};

const sanitizeBody = (fields = []) => {
  return (req, _res, next) => {
    if (!req.body) return next();

    const fieldsToSanitize = fields.length > 0
      ? fields
      : Object.keys(req.body).filter((key) => typeof req.body[key] === 'string');

    fieldsToSanitize.forEach((field) => {
      if (typeof req.body[field] === 'string') {
        req.body[field] = sanitizeInput(req.body[field]);
      }
    });

    next();
  };
};

const sanitizeQuery = (fields = []) => {
  return (req, _res, next) => {
    if (!req.query) return next();

    const fieldsToSanitize = fields.length > 0
      ? fields
      : Object.keys(req.query).filter((key) => typeof req.query[key] === 'string');

    fieldsToSanitize.forEach((field) => {
      if (typeof req.query[field] === 'string') {
        req.query[field] = sanitizeInput(req.query[field]);
      }
    });

    next();
  };
};

module.exports = { sanitizeInput, sanitizeBody, sanitizeQuery };
