// FILE: backend/services/excelGeneration.service.js
// PURPOSE: Generate Excel (.xlsx) files using exceljs
const ExcelJS = require('exceljs');
const { saveGeneratedBinaryFile } = require('./fileUpload.service');

/**
 * Generate an Excel file from structured sheet data
 * @param {string} title
 * @param {Array<{name:string, headers:string[], rows:string[][]}>} sheets
 * @param {string} userId
 * @param {string|null} topicId
 */
const generateExcel = async (title, sheets, userId, topicId) => {
  console.log(`[ExcelGen] Generating Excel: "${title}" with ${sheets.length} sheet(s)`);

  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'Multi-AI Chat';

  for (const sheetData of sheets) {
    const ws = workbook.addWorksheet(sheetData.name || 'Sheet1');

    // Header row
    if (sheetData.headers && sheetData.headers.length > 0) {
      const headerRow = ws.addRow(sheetData.headers);
      headerRow.font = { bold: true, color: { argb: 'FFFFFFFF' } };
      headerRow.fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: 'FF2563EB' },
      };
      headerRow.alignment = { horizontal: 'center', vertical: 'middle' };
      headerRow.height = 24;
    }

    // Data rows
    if (sheetData.rows && sheetData.rows.length > 0) {
      for (const row of sheetData.rows) {
        ws.addRow(row);
      }
    }

    // Auto-fit column widths
    ws.columns.forEach((col, i) => {
      let maxLen = 10;
      ws.getColumn(i + 1).eachCell({ includeEmpty: true }, (cell) => {
        const len = cell.value ? String(cell.value).length : 0;
        if (len > maxLen) maxLen = len;
      });
      col.width = Math.min(maxLen + 4, 50);
    });

    // Alternate row colors
    ws.eachRow((row, rowNum) => {
      if (rowNum > 1 && rowNum % 2 === 0) {
        row.fill = {
          type: 'pattern',
          pattern: 'solid',
          fgColor: { argb: 'FFF3F4F6' },
        };
      }
    });
  }

  const buffer = await workbook.xlsx.writeBuffer();

  const safeName = (title || 'spreadsheet')
    .slice(0, 40)
    .replace(/[^a-z0-9\s]/gi, '')
    .trim()
    .replace(/\s+/g, '_')
    .toLowerCase() || 'spreadsheet';

  const fileName = `${safeName}_${Date.now()}.xlsx`;
  const textContent = `Excel Spreadsheet: ${title}\nSheets: ${sheets.length}\n${sheets.map((s, i) => `  Sheet ${i + 1}: ${s.name} (${(s.rows || []).length} rows)`).join('\n')}`;

  const result = await saveGeneratedBinaryFile(userId, topicId, fileName, textContent, 'xlsx', buffer);
  if (!result) throw new Error('Failed to save generated Excel to database');

  console.log(`[ExcelGen] Saved as ${result.file_name} (id: ${result.file_id})`);
  return result;
};

module.exports = { generateExcel };
