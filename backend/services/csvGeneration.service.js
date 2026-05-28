// FILE: backend/services/csvGeneration.service.js
// PURPOSE: Generate CSV files from structured data
const { saveGeneratedFile } = require('./fileUpload.service');

/**
 * Generate a CSV file from headers and rows
 * @param {string[]} headers
 * @param {string[][]} rows
 * @param {string} userId
 * @param {string|null} topicId
 */
const generateCSV = async (headers, rows, userId, topicId) => {
  const escapeCell = (val) => {
    const str = String(val ?? '');
    if (str.includes(',') || str.includes('"') || str.includes('\n')) {
      return `"${str.replace(/"/g, '""')}"`;
    }
    return str;
  };

  const csvLines = [
    headers.map(escapeCell).join(','),
    ...rows.map((row) => row.map(escapeCell).join(',')),
  ];
  const content = csvLines.join('\n');

  const safeName = 'data_export';
  const fileName = `${safeName}_${Date.now()}.csv`;

  const result = await saveGeneratedFile(userId, topicId, fileName, content, 'csv');
  if (!result) throw new Error('Failed to save generated CSV to database');

  console.log(`[CSVGen] Saved as ${result.file_name} (id: ${result.file_id})`);
  return result;
};

module.exports = { generateCSV };
