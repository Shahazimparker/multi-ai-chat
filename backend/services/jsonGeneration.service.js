// FILE: backend/services/jsonGeneration.service.js
// PURPOSE: Generate JSON files from structured data
const { saveGeneratedFile } = require('./fileUpload.service');

/**
 * Generate a JSON file
 * @param {object} data - any JSON-serializable data
 * @param {string} userId
 * @param {string|null} topicId
 */
const generateJSON = async (data, userId, topicId) => {
  const content = JSON.stringify(data, null, 2);

  const fileName = `data_${Date.now()}.json`;

  const result = await saveGeneratedFile(userId, topicId, fileName, content, 'json');
  if (!result) throw new Error('Failed to save generated JSON to database');

  console.log(`[JSONGen] Saved as ${result.file_name} (id: ${result.file_id})`);
  return result;
};

module.exports = { generateJSON };
