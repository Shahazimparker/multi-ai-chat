// ============================================================
// FILE: backend/services/outputParser.service.js
// PURPOSE: Parse & validate structured output from AI models
//          - JSON extraction with schema validation
//          - Markdown table/list parsing
//          - CSV parsing
//          - Regex pattern extraction
//          - Auto-retry on parse failure
// ============================================================

/**
 * Base OutputParser interface
 */
class OutputParser {
  async parse(text, context = {}) {
    throw new Error('parse() not implemented');
  }

  async retry(text, context = {}, maxRetries = 3) {
    for (let i = 0; i < maxRetries; i++) {
      try {
        return await this.parse(text, context);
      } catch (err) {
        if (i === maxRetries - 1) throw err;
        console.warn(`[OutputParser] Attempt ${i + 1} failed, retrying...`);
      }
    }
  }
}

/**
 * JSONParser — Extract and validate JSON from text
 * Supports schema validation with basic type checking
 */
class JSONParser extends OutputParser {
  constructor(options = {}) {
    super();
    this.schema = options.schema || null; // { key: 'type', ... }
    this.strict = options.strict !== false; // strict mode = must match schema exactly
    this.allowPartial = options.allowPartial || false; // allow missing fields
  }

  /**
   * Validate value against type
   */
  _validateType(value, expectedType) {
    if (expectedType === 'string') return typeof value === 'string';
    if (expectedType === 'number') return typeof value === 'number';
    if (expectedType === 'boolean') return typeof value === 'boolean';
    if (expectedType === 'array') return Array.isArray(value);
    if (expectedType === 'object') return typeof value === 'object' && value !== null;
    return true; // unknown type
  }

  /**
   * Coerce value to expected type
   */
  _coerceType(value, expectedType) {
    if (this._validateType(value, expectedType)) return value;

    if (expectedType === 'number' && typeof value === 'string') {
      const num = parseFloat(value);
      return isNaN(num) ? value : num;
    }

    if (expectedType === 'boolean' && typeof value === 'string') {
      return value.toLowerCase() === 'true' || value === '1';
    }

    if (expectedType === 'string') return String(value);

    return value;
  }

  /**
   * Validate object against schema
   */
  _validateSchema(obj) {
    if (!this.schema) return true;

    const errors = [];

    for (const [key, expectedType] of Object.entries(this.schema)) {
      if (!(key in obj)) {
        if (!this.allowPartial) {
          errors.push(`Missing required field: ${key}`);
        }
      } else if (!this._validateType(obj[key], expectedType)) {
        errors.push(`Field '${key}' should be ${expectedType}, got ${typeof obj[key]}`);
      }
    }

    return errors.length === 0 ? true : errors;
  }

  /**
   * Extract JSON from text (handle markdown code blocks, etc)
   */
  _extractJSON(text) {
    // Try to find JSON in markdown code block
    const codeBlockMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (codeBlockMatch) {
      return codeBlockMatch[1].trim();
    }

    // Try to find raw JSON object/array
    const jsonMatch = text.match(/(\{[\s\S]*\}|\[[\s\S]*\])/);
    if (jsonMatch) {
      return jsonMatch[1];
    }

    return text;
  }

  async parse(text, context = {}) {
    if (!text || typeof text !== 'string') {
      throw new Error('Input must be a non-empty string');
    }

    try {
      // Extract JSON from text
      const jsonText = this._extractJSON(text);

      // Parse JSON
      let obj;
      try {
        obj = JSON.parse(jsonText);
      } catch (err) {
        throw new Error(`Failed to parse JSON: ${err.message}`);
      }

      if (typeof obj !== 'object' || obj === null) {
        throw new Error('Parsed JSON must be an object or array');
      }

      // Validate schema if provided
      if (this.schema) {
        const validationResult = this._validateSchema(obj);

        if (validationResult !== true) {
          if (this.strict) {
            throw new Error(`Schema validation failed: ${validationResult.join(', ')}`);
          } else {
            // Coerce types in lenient mode
            for (const [key, expectedType] of Object.entries(this.schema)) {
              if (key in obj) {
                obj[key] = this._coerceType(obj[key], expectedType);
              }
            }
          }
        }
      }

      return {
        success: true,
        data: obj,
        raw: jsonText,
      };
    } catch (err) {
      return {
        success: false,
        error: err.message,
        raw: text,
      };
    }
  }
}

/**
 * MarkdownParser — Parse markdown tables and lists
 */
class MarkdownParser extends OutputParser {
  /**
   * Parse markdown table into array of objects
   * | Header1 | Header2 |
   * |---------|---------|
   * | Value1  | Value2  |
   */
  parseTable(text) {
    const lines = text.split('\n').filter((line) => line.trim().startsWith('|'));

    if (lines.length < 3) {
      throw new Error('Invalid markdown table format');
    }

    // Parse header
    const headers = lines[0]
      .split('|')
      .map((h) => h.trim())
      .filter((h) => h.length > 0);

    // Skip separator line (line 1)
    // Parse data rows
    const rows = [];
    for (let i = 2; i < lines.length; i++) {
      const cells = lines[i]
        .split('|')
        .map((c) => c.trim())
        .filter((c) => c.length > 0);

      if (cells.length === headers.length) {
        const row = {};
        headers.forEach((header, idx) => {
          row[header] = cells[idx];
        });
        rows.push(row);
      }
    }

    return rows;
  }

  /**
   * Parse markdown list into array
   * - Item 1
   * - Item 2
   * - Item 3
   */
  parseList(text) {
    const lines = text.split('\n');
    const items = [];

    for (const line of lines) {
      const match = line.match(/^\s*[-*+]\s+(.+)$/);
      if (match) {
        items.push(match[1].trim());
      }
    }

    return items;
  }

  async parse(text, context = {}) {
    if (!text || typeof text !== 'string') {
      throw new Error('Input must be a non-empty string');
    }

    try {
      // Try to detect what to parse
      if (text.includes('|') && text.includes('---')) {
        // Looks like a table
        const table = this.parseTable(text);
        return {
          success: true,
          type: 'table',
          data: table,
          raw: text,
        };
      }

      if (text.match(/^\s*[-*+]\s/m)) {
        // Looks like a list
        const list = this.parseList(text);
        return {
          success: true,
          type: 'list',
          data: list,
          raw: text,
        };
      }

      // Return raw text if no structure detected
      return {
        success: true,
        type: 'text',
        data: text,
        raw: text,
      };
    } catch (err) {
      return {
        success: false,
        error: err.message,
        raw: text,
      };
    }
  }
}

/**
 * CSVParser — Parse CSV data
 */
class CSVParser extends OutputParser {
  constructor(options = {}) {
    super();
    this.delimiter = options.delimiter || ',';
    this.hasHeader = options.hasHeader !== false;
  }

  _parseCSVLine(line) {
    const result = [];
    let current = '';
    let insideQuotes = false;

    for (let i = 0; i < line.length; i++) {
      const char = line[i];

      if (char === '"') {
        insideQuotes = !insideQuotes;
      } else if (char === this.delimiter && !insideQuotes) {
        result.push(current.trim());
        current = '';
      } else {
        current += char;
      }
    }

    result.push(current.trim());
    return result;
  }

  async parse(text, context = {}) {
    if (!text || typeof text !== 'string') {
      throw new Error('Input must be a non-empty string');
    }

    try {
      const lines = text.split('\n').filter((line) => line.trim());

      if (lines.length === 0) {
        throw new Error('CSV text is empty');
      }

      const rows = lines.map((line) => this._parseCSVLine(line));

      let data = rows;
      let headers = null;

      if (this.hasHeader && rows.length > 0) {
        headers = rows[0];
        data = rows.slice(1).map((row) => {
          const obj = {};
          headers.forEach((header, idx) => {
            obj[header] = row[idx] || '';
          });
          return obj;
        });
      }

      return {
        success: true,
        data,
        headers,
        raw: text,
      };
    } catch (err) {
      return {
        success: false,
        error: err.message,
        raw: text,
      };
    }
  }
}

/**
 * RegexParser — Extract data using regex patterns
 */
class RegexParser extends OutputParser {
  constructor(options = {}) {
    super();
    this.patterns = options.patterns || {};
    // patterns: { email: /\b[\w.-]+@[\w.-]+\.\w+\b/g, ... }
  }

  async parse(text, context = {}) {
    if (!text || typeof text !== 'string') {
      throw new Error('Input must be a non-empty string');
    }

    try {
      const result = {};

      for (const [key, pattern] of Object.entries(this.patterns)) {
        const matches = text.match(pattern);
        if (pattern.global) {
          result[key] = matches || [];
        } else {
          result[key] = matches ? matches[0] : null;
        }
      }

      return {
        success: true,
        data: result,
        raw: text,
      };
    } catch (err) {
      return {
        success: false,
        error: err.message,
        raw: text,
      };
    }
  }
}

/**
 * CompositeParser — Try multiple parsers in order
 */
class CompositeParser extends OutputParser {
  constructor(parsers = []) {
    super();
    this.parsers = parsers;
  }

  async parse(text, context = {}) {
    for (const parser of this.parsers) {
      try {
        const result = await parser.parse(text, context);
        if (result.success) {
          return result;
        }
      } catch (err) {
        // Try next parser
        continue;
      }
    }

    return {
      success: false,
      error: 'All parsers failed',
      raw: text,
    };
  }
}

/**
 * Factory function — create parser by type
 */
const createParser = (type = 'json', options = {}) => {
  if (type === 'json') {
    return new JSONParser(options);
  }

  if (type === 'markdown') {
    return new MarkdownParser(options);
  }

  if (type === 'csv') {
    return new CSVParser(options);
  }

  if (type === 'regex') {
    return new RegexParser(options);
  }

  if (type === 'composite') {
    return new CompositeParser(options.parsers || []);
  }

  throw new Error(`Unknown parser type: ${type}`);
};

module.exports = {
  OutputParser,
  JSONParser,
  MarkdownParser,
  CSVParser,
  RegexParser,
  CompositeParser,
  createParser,
};
