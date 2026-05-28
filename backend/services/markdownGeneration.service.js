// FILE: backend/services/markdownGeneration.service.js
// PURPOSE: Generate Markdown files
const { saveGeneratedFile } = require('./fileUpload.service');

/**
 * Generate a Markdown file
 * @param {string} content - markdown text
 * @param {string} title - optional title for filename
 * @param {string} userId
 * @param {string|null} topicId
 */
const generateMarkdown = async (content, title, userId, topicId) => {
  const safeName = (title || 'document')
    .slice(0, 40)
    .replace(/[^a-z0-9\s]/gi, '')
    .trim()
    .replace(/\s+/g, '_')
    .toLowerCase() || 'document';

  const fileName = `${safeName}_${Date.now()}.md`;

  const result = await saveGeneratedFile(userId, topicId, fileName, content, 'md');
  if (!result) throw new Error('Failed to save generated Markdown to database');

  console.log(`[MDGen] Saved as ${result.file_name} (id: ${result.file_id})`);
  return result;
};

module.exports = { generateMarkdown };
