// ============================================================
// FILE: backend/services/textSplitter.service.js
// PURPOSE: Split large text into manageable chunks with different strategies
//          - RecursiveSplitter: Preserve document structure
//          - SemanticSplitter: Group by meaning
//          - SlidingWindowSplitter: Fixed windows with overlap
//          - LineBasedSplitter: Preserve code structure
// ============================================================

const { estimateTokens } = require('./tokenBudget.service');

/**
 * Base Chunk class
 */
class Chunk {
  constructor(content, metadata = {}) {
    this.content = content;
    this.metadata = {
      tokens: estimateTokens(content),
      size: content.length,
      ...metadata,
    };
  }
}

/**
 * RecursiveSplitter — split by hierarchy to preserve structure
 * Document → Paragraph → Sentence → Word
 */
class RecursiveSplitter {
  constructor(maxTokens = 500, overlapTokens = 50) {
    this.maxTokens = maxTokens;
    this.overlapTokens = overlapTokens;
    this.separators = ['\n\n', '\n', '. ', ' '];
  }

  split(text, metadata = {}) {
    if (!text) return [];

    const chunks = [];
    let currentSeparatorIdx = 0;
    const textTokens = estimateTokens(text);

    // If text fits in one chunk, return as-is
    if (textTokens <= this.maxTokens) {
      return [new Chunk(text, { ...metadata, strategy: 'recursive' })];
    }

    let splits = this._recursiveSplit(text, this.separators);

    // Merge splits into chunks respecting token limit
    let currentChunk = '';
    let currentTokens = 0;

    for (const split of splits) {
      const splitTokens = estimateTokens(split);

      if (currentTokens + splitTokens <= this.maxTokens) {
        currentChunk += split;
        currentTokens += splitTokens;
      } else {
        // Save current chunk and start new one
        if (currentChunk) {
          chunks.push(
            new Chunk(currentChunk.trim(), {
              ...metadata,
              strategy: 'recursive',
              chunkNumber: chunks.length,
            })
          );
        }

        // Add overlap from end of previous chunk
        if (this.overlapTokens > 0 && chunks.length > 0) {
          const lastContent = chunks[chunks.length - 1].content;
          const overlapText = this._getOverlapText(lastContent, this.overlapTokens);
          currentChunk = overlapText + split;
          currentTokens = estimateTokens(currentChunk);
        } else {
          currentChunk = split;
          currentTokens = splitTokens;
        }
      }
    }

    // Add final chunk
    if (currentChunk) {
      chunks.push(
        new Chunk(currentChunk.trim(), {
          ...metadata,
          strategy: 'recursive',
          chunkNumber: chunks.length,
        })
      );
    }

    return chunks;
  }

  _recursiveSplit(text, separators, idx = 0) {
    const splits = [];

    if (idx >= separators.length) {
      return [text];
    }

    const separator = separators[idx];
    const parts = text.split(separator);

    // Filter empty parts
    const goodSplits = parts.filter((p) => p.length > 0);

    if (goodSplits.length > 1) {
      // Recursively merge parts that are smaller than max
      let mergedSplits = [];
      let separator2 = separators[idx + 1];

      for (const split of goodSplits) {
        if (estimateTokens(split) <= this.maxTokens) {
          mergedSplits.push(split);
        } else {
          if (mergedSplits.length > 0) {
            const mergedText = mergedSplits.join(separator);
            splits.push(mergedText);
            mergedSplits = [];
          }
          // Recursively split this part
          const subSplits = this._recursiveSplit(split, separators, idx + 1);
          splits.push(...subSplits);
        }
      }

      if (mergedSplits.length > 0) {
        splits.push(mergedSplits.join(separator));
      }
    } else {
      // Recursively try next separator
      return this._recursiveSplit(text, separators, idx + 1);
    }

    return splits;
  }

  _getOverlapText(text, overlapTokens) {
    const words = text.split(/\s+/);
    let currentTokens = 0;
    let overlapWords = [];

    for (let i = words.length - 1; i >= 0; i--) {
      const wordTokens = estimateTokens(words[i]);
      if (currentTokens + wordTokens <= overlapTokens) {
        overlapWords.unshift(words[i]);
        currentTokens += wordTokens;
      } else {
        break;
      }
    }

    return overlapWords.join(' ') + ' ';
  }
}

/**
 * SemanticSplitter — split by semantic similarity
 * Keeps semantically related sentences together
 */
class SemanticSplitter {
  constructor(maxTokens = 500) {
    this.maxTokens = maxTokens;
  }

  split(text, metadata = {}) {
    if (!text) return [];

    // Split into sentences
    const sentences = this._splitSentences(text);

    if (sentences.length === 0) {
      return [new Chunk(text, { ...metadata, strategy: 'semantic' })];
    }

    const chunks = [];
    let currentChunk = '';
    let currentTokens = 0;

    for (const sentence of sentences) {
      const sentenceTokens = estimateTokens(sentence);

      if (currentTokens + sentenceTokens <= this.maxTokens) {
        currentChunk += sentence;
        currentTokens += sentenceTokens;
      } else {
        if (currentChunk) {
          chunks.push(
            new Chunk(currentChunk.trim(), {
              ...metadata,
              strategy: 'semantic',
              chunkNumber: chunks.length,
            })
          );
        }
        currentChunk = sentence;
        currentTokens = sentenceTokens;
      }
    }

    if (currentChunk) {
      chunks.push(
        new Chunk(currentChunk.trim(), {
          ...metadata,
          strategy: 'semantic',
          chunkNumber: chunks.length,
        })
      );
    }

    return chunks;
  }

  _splitSentences(text) {
    // Split on . ! ? but preserve sentence boundaries
    const sentenceRegex = /(?<=[.!?])\s+(?=[A-Z])/;
    return text.split(sentenceRegex).filter((s) => s.length > 0);
  }
}

/**
 * SlidingWindowSplitter — fixed-size windows with overlap
 * Best for code and structured data
 */
class SlidingWindowSplitter {
  constructor(windowTokens = 500, overlapTokens = 50) {
    this.windowTokens = windowTokens;
    this.overlapTokens = Math.min(overlapTokens, Math.floor(windowTokens / 2));
  }

  split(text, metadata = {}) {
    if (!text) return [];

    const words = text.split(/\s+/);
    const chunks = [];
    let idx = 0;

    while (idx < words.length) {
      let currentChunk = [];
      let currentTokens = 0;

      // Fill window to token limit
      while (idx < words.length && currentTokens < this.windowTokens) {
        const word = words[idx];
        const wordTokens = estimateTokens(word);

        if (currentTokens + wordTokens <= this.windowTokens) {
          currentChunk.push(word);
          currentTokens += wordTokens;
          idx++;
        } else {
          break;
        }
      }

      if (currentChunk.length > 0) {
        chunks.push(
          new Chunk(currentChunk.join(' '), {
            ...metadata,
            strategy: 'sliding_window',
            chunkNumber: chunks.length,
          })
        );
      }

      // Move back by overlap amount
      idx = Math.max(idx - this.overlapTokens, idx - currentChunk.length / 2);
    }

    return chunks;
  }
}

/**
 * LineBasedSplitter — preserve code structure
 * Groups lines, useful for source code
 */
class LineBasedSplitter {
  constructor(maxTokens = 500, linesPerChunk = 50) {
    this.maxTokens = maxTokens;
    this.linesPerChunk = linesPerChunk;
  }

  split(text, metadata = {}) {
    if (!text) return [];

    const lines = text.split('\n');
    const chunks = [];
    let currentLines = [];
    let currentTokens = 0;
    let lineCount = 0;

    for (const line of lines) {
      const lineTokens = estimateTokens(line);

      if (
        (currentTokens + lineTokens <= this.maxTokens &&
          lineCount < this.linesPerChunk) ||
        currentLines.length === 0
      ) {
        currentLines.push(line);
        currentTokens += lineTokens;
        lineCount++;
      } else {
        if (currentLines.length > 0) {
          chunks.push(
            new Chunk(currentLines.join('\n'), {
              ...metadata,
              strategy: 'line_based',
              chunkNumber: chunks.length,
              lineRange: [chunks.length * this.linesPerChunk, lineCount],
            })
          );
        }
        currentLines = [line];
        currentTokens = lineTokens;
        lineCount = 1;
      }
    }

    if (currentLines.length > 0) {
      chunks.push(
        new Chunk(currentLines.join('\n'), {
          ...metadata,
          strategy: 'line_based',
          chunkNumber: chunks.length,
        })
      );
    }

    return chunks;
  }
}

/**
 * Auto-select splitter based on content type
 */
const getOptimalSplitter = (fileType, maxTokens = 500) => {
  if (fileType === 'code') {
    return new LineBasedSplitter(maxTokens, 50);
  }

  if (fileType === 'spreadsheet') {
    return new LineBasedSplitter(maxTokens, 30);
  }

  if (fileType === 'pdf' || fileType === 'document') {
    return new RecursiveSplitter(maxTokens, 50);
  }

  // Default: semantic for most content
  return new SemanticSplitter(maxTokens);
};

/**
 * Split text using optimal strategy for file type
 */
const splitText = (text, fileType, options = {}) => {
  const {
    maxTokens = 500,
    strategy = 'auto',
    metadata = {},
  } = options;

  let splitter;

  if (strategy === 'auto') {
    splitter = getOptimalSplitter(fileType, maxTokens);
  } else if (strategy === 'recursive') {
    splitter = new RecursiveSplitter(maxTokens, 50);
  } else if (strategy === 'semantic') {
    splitter = new SemanticSplitter(maxTokens);
  } else if (strategy === 'sliding_window') {
    splitter = new SlidingWindowSplitter(maxTokens, 50);
  } else if (strategy === 'line_based') {
    splitter = new LineBasedSplitter(maxTokens, 50);
  } else {
    throw new Error(`Unknown split strategy: ${strategy}`);
  }

  return splitter.split(text, metadata);
};

module.exports = {
  splitText,
  getOptimalSplitter,
  RecursiveSplitter,
  SemanticSplitter,
  SlidingWindowSplitter,
  LineBasedSplitter,
  Chunk,
};
