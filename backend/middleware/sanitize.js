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

// For free text that is displayed via React (auto-escaped) or sent straight
// to an LLM — never interpreted as HTML — so tag-stripping only destroys
// legitimate content (`Array<string>`, `a < b && c > d`). What is still worth
// doing here: control characters and the \u2028/\u2029 line separators can
// break JSON/JS contexts downstream, so those are stripped; nothing else is.
const sanitizeText = (input) => {
  if (typeof input !== 'string') return input;

  return input
    // eslint-disable-next-line no-control-regex -- stripping control characters is this sanitizer's purpose
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '')
    .replace(/\u2028|\u2029/g, ' ')
    .trim();
};

// `fields` is either a plain array — every field gets the strict,
// tag-stripping `sanitizeInput` (the historical default) — or a map of
// field name to sanitizer function, for routes where different fields need
// different treatment (e.g. a free-text field bound for an LLM/React next to
// fields that are identifiers and must stay strictly sanitized).
const toSanitizerMap = (fields) =>
  Array.isArray(fields)
    ? Object.fromEntries(fields.map((field) => [field, sanitizeInput]))
    : { ...fields };

const sanitizeBody = (fields = []) => {
  const sanitizerMap = toSanitizerMap(fields);

  return (req, _res, next) => {
    if (!req.body) return next();

    const entries = Object.keys(sanitizerMap).length > 0
      ? Object.entries(sanitizerMap)
      : Object.keys(req.body)
          .filter((key) => typeof req.body[key] === 'string')
          .map((key) => [key, sanitizeInput]);

    entries.forEach(([field, sanitize]) => {
      if (typeof req.body[field] === 'string') {
        req.body[field] = sanitize(req.body[field]);
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

module.exports = { sanitizeInput, sanitizeText, sanitizeBody, sanitizeQuery };
