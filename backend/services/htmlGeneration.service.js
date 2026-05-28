// FILE: backend/services/htmlGeneration.service.js
// PURPOSE: Generate HTML files
const { saveGeneratedFile } = require('./fileUpload.service');

/**
 * Generate an HTML file
 * @param {string} title
 * @param {string} body - HTML body content
 * @param {string} css - optional CSS styles
 * @param {string} userId
 * @param {string|null} topicId
 */
const generateHTML = async (title, body, css, userId, topicId) => {
  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${title || 'Generated Page'}</title>
  <style>${css || 'body { font-family: system-ui, sans-serif; max-width: 800px; margin: 0 auto; padding: 2rem; }'}</style>
</head>
<body>
${body || ''}
</body>
</html>`;

  const safeName = (title || 'page')
    .slice(0, 40)
    .replace(/[^a-z0-9\s]/gi, '')
    .trim()
    .replace(/\s+/g, '_')
    .toLowerCase() || 'page';

  const fileName = `${safeName}_${Date.now()}.html`;

  const result = await saveGeneratedFile(userId, topicId, fileName, html, 'html');
  if (!result) throw new Error('Failed to save generated HTML to database');

  console.log(`[HTMLGen] Saved as ${result.file_name} (id: ${result.file_id})`);
  return result;
};

module.exports = { generateHTML };
