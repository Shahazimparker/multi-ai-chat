// FILE: backend/services/chartGeneration.service.js
// PURPOSE: Generate SVG chart files
const { saveGeneratedFile } = require('./fileUpload.service');

/**
 * Generate a simple SVG bar chart
 * @param {string} type - 'bar' | 'pie' | 'line'
 * @param {string} title
 * @param {string[]} labels
 * @param {number[]} data
 * @param {string} userId
 * @param {string|null} topicId
 */
const generateChart = async (type, title, labels, data, userId, topicId) => {
  const width = 800;
  const height = 500;
  const pad = { top: 60, right: 40, bottom: 80, left: 80 };
  const chartW = width - pad.left - pad.right;
  const chartH = height - pad.top - pad.bottom;

  const colors = ['#2563EB', '#DC2626', '#16A34A', '#CA8A04', '#9333EA', '#0891B2', '#DB2777', '#EA580C'];
  const maxVal = Math.max(...data, 1);

  let svgContent = '';

  if (type === 'bar') {
    const barWidth = Math.min(60, chartW / data.length - 10);
    const gap = chartW / data.length;

    svgContent = data.map((val, i) => {
      const barH = (val / maxVal) * chartH;
      const x = pad.left + i * gap + (gap - barWidth) / 2;
      const y = pad.top + chartH - barH;
      return `<rect x="${x}" y="${y}" width="${barWidth}" height="${barH}" fill="${colors[i % colors.length]}" rx="3"/>`;
    }).join('\n');

    // Value labels
    svgContent += '\n' + data.map((val, i) => {
      const barH = (val / maxVal) * chartH;
      const x = pad.left + i * gap + gap / 2;
      const y = pad.top + chartH - barH - 8;
      return `<text x="${x}" y="${y}" text-anchor="middle" font-size="14" fill="#1F2937">${val}</text>`;
    }).join('\n');

    // X-axis labels
    svgContent += '\n' + labels.map((label, i) => {
      const x = pad.left + i * gap + gap / 2;
      const y = height - 15;
      return `<text x="${x}" y="${y}" text-anchor="middle" font-size="12" fill="#6B7280" transform="rotate(-30, ${x}, ${y})">${label.slice(0, 15)}</text>`;
    }).join('\n');
  } else if (type === 'pie') {
    const cx = width / 2;
    const cy = pad.top + chartH / 2;
    const r = Math.min(chartW, chartH) / 2 - 20;
    const total = data.reduce((a, b) => a + b, 0);

    let startAngle = 0;
    svgContent = data.map((val, i) => {
      const sliceAngle = (val / total) * 360;
      const endAngle = startAngle + sliceAngle;
      const largeArc = sliceAngle > 180 ? 1 : 0;

      const x1 = cx + r * Math.cos((startAngle - 90) * Math.PI / 180);
      const y1 = cy + r * Math.sin((startAngle - 90) * Math.PI / 180);
      const x2 = cx + r * Math.cos((endAngle - 90) * Math.PI / 180);
      const y2 = cy + r * Math.sin((endAngle - 90) * Math.PI / 180);

      const midAngle = (startAngle + endAngle / 2 - 90) * Math.PI / 180;
      const lx = cx + (r + 30) * Math.cos(midAngle);
      const ly = cy + (r + 30) * Math.sin(midAngle);

      const result = `<path d="M${cx},${cy} L${x1},${y1} A${r},${r} 0 ${largeArc},1 ${x2},${y2} Z" fill="${colors[i % colors.length]}" stroke="#fff" stroke-width="2"/>
<text x="${lx}" y="${ly}" font-size="12" fill="#1F2937">${labels[i]}: ${val} (${Math.round(val/total*100)}%)</text>`;
      startAngle = endAngle;
      return result;
    }).join('\n');
  } else {
    // Line chart
    const points = data.map((val, i) => {
      const x = pad.left + (i / (data.length - 1 || 1)) * chartW;
      const y = pad.top + chartH - (val / maxVal) * chartH;
      return `${x},${y}`;
    }).join(' ');

    svgContent = `<polyline points="${points}" fill="none" stroke="#2563EB" stroke-width="3" stroke-linejoin="round"/>`;

    // Dots
    svgContent += '\n' + data.map((val, i) => {
      const x = pad.left + (i / (data.length - 1 || 1)) * chartW;
      const y = pad.top + chartH - (val / maxVal) * chartH;
      return `<circle cx="${x}" cy="${y}" r="5" fill="#2563EB"/><text x="${x}" y="${y - 12}" text-anchor="middle" font-size="13" fill="#1F2937">${val}</text>`;
    }).join('\n');

    // X-axis labels
    svgContent += '\n' + labels.map((label, i) => {
      const x = pad.left + (i / (data.length - 1 || 1)) * chartW;
      return `<text x="${x}" y="${height - 15}" text-anchor="middle" font-size="12" fill="#6B7280">${label.slice(0, 12)}</text>`;
    }).join('\n');
  }

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}">
  <rect width="${width}" height="${height}" fill="#FFFFFF"/>
  <text x="${width/2}" y="30" text-anchor="middle" font-size="20" font-weight="bold" fill="#1F2937">${title || 'Chart'}</text>
  ${svgContent}
</svg>`;

  const safeName = (title || 'chart')
    .slice(0, 40)
    .replace(/[^a-z0-9\s]/gi, '')
    .trim()
    .replace(/\s+/g, '_')
    .toLowerCase() || 'chart';

  const fileName = `${safeName}_${Date.now()}.svg`;

  const result = await saveGeneratedFile(userId, topicId, fileName, svg, 'svg');
  if (!result) throw new Error('Failed to save generated chart to database');

  console.log(`[ChartGen] Saved as ${result.file_name} (id: ${result.file_id})`);
  return result;
};

module.exports = { generateChart };
