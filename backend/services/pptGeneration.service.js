// FILE: backend/services/pptGeneration.service.js
// PURPOSE: Generate PowerPoint files from structured slide data using pptxgenjs
const pptxgen = require('pptxgenjs');
const { saveGeneratedBinaryFile } = require('./fileUpload.service');

const THEMES = {
  modern_corporate: { headerBg: '0F172A', accent: '0EA5E9', accentLight: 'E0F2FE', textDark: '0B1220', textLight: 'FFFFFF', textMuted: '64748B' },
  startup_bold: { headerBg: '111827', accent: 'F97316', accentLight: 'FFEDD5', textDark: '111827', textLight: 'FFFFFF', textMuted: '6B7280' },
  clean_minimal: { headerBg: '1E3A5F', accent: '2563EB', accentLight: 'DBEAFE', textDark: '1F2937', textLight: 'FFFFFF', textMuted: '6B7280' },
  emerald_glass: { headerBg: '052E2B', accent: '10B981', accentLight: 'D1FAE5', textDark: '052E2B', textLight: 'FFFFFF', textMuted: '4B5563' },
  sunset_warm: { headerBg: '7C2D12', accent: 'FB923C', accentLight: 'FFEDD5', textDark: '431407', textLight: 'FFFFFF', textMuted: '7C2D12' },
  charcoal_lime: { headerBg: '1F2937', accent: '84CC16', accentLight: 'ECFCCB', textDark: '111827', textLight: 'FFFFFF', textMuted: '4B5563' },
  sandstone_editorial: { headerBg: '44403C', accent: 'D6A568', accentLight: 'FAF3E8', textDark: '292524', textLight: 'FFFFFF', textMuted: '78716C' },
  ruby_noir: { headerBg: '3F0D1D', accent: 'E11D48', accentLight: 'FFE4E6', textDark: '4C0519', textLight: 'FFFFFF', textMuted: '7F1D1D' },
  violet_tech: { headerBg: '312E81', accent: '8B5CF6', accentLight: 'EDE9FE', textDark: '1E1B4B', textLight: 'FFFFFF', textMuted: '5B21B6' },
  ocean_depth: { headerBg: '0C4A6E', accent: '06B6D4', accentLight: 'CFFAFE', textDark: '082F49', textLight: 'FFFFFF', textMuted: '0E7490' },
  rose_creative: { headerBg: '831843', accent: 'F43F5E', accentLight: 'FFE4E6', textDark: '4C0519', textLight: 'FFFFFF', textMuted: '9F1239' },
  mono_editorial: { headerBg: '262626', accent: '737373', accentLight: 'F5F5F5', textDark: '171717', textLight: 'FFFFFF', textMuted: '525252' },
};

const KNOWN_LAYOUTS = new Set([
  'title_bullets',
  'two_column',
  'cards',
  'quote',
  'data_story',
  'timeline',
  'process_steps',
  'comparison_split',
  'swot_grid',
  'kpi_dashboard',
  'checklist',
  'section_break',
  'statistics_strip',
  'faq',
  'table_like',
]);

const addBullets = (slideObj, items, box, theme, fontSize = 16) => {
  if (!items || items.length === 0) return;
  const bulletItems = items.map((b) => ({
    text: String(b),
    options: {
      bullet: { type: 'bullet', code: '2022' },
      fontSize,
      color: theme.textDark,
      paraSpaceAfter: 8,
      indentLevel: 0,
    },
  }));
  slideObj.addText(bulletItems, { ...box, valign: 'top' });
};

const addFooter = (slideObj, slide, theme) => {
  if (!slide.footerNote) return;
  slideObj.addText(String(slide.footerNote), {
    x: 0.5, y: 6.95, w: 12.2, h: 0.24,
    fontSize: 10,
    color: theme.textMuted,
    align: 'right',
    italic: true,
  });
};

const renderLayout = (prs, s, slide, i, slideCount, theme) => {
  const bullets = Array.isArray(slide.bullets) ? slide.bullets : [];
  const content = String(slide.content || '');
  const layout = KNOWN_LAYOUTS.has(String(slide.layout || '').toLowerCase())
    ? String(slide.layout).toLowerCase()
    : 'title_bullets';

  s.background = { color: 'FFFFFF' };
  s.addShape(prs.ShapeType.rect, { x: 0, y: 0, w: '100%', h: 1.15, fill: { color: theme.accent }, line: { type: 'none' } });
  s.addText(slide.title || `Slide ${i + 1}`, { x: '2%', y: 0.12, w: '88%', h: 0.9, fontSize: 24, bold: true, color: theme.textLight, valign: 'middle' });
  s.addText(`${i + 1} / ${slideCount}`, { x: '90%', y: 0.12, w: '8%', h: 0.9, fontSize: 12, color: 'BFD9FF', align: 'right', valign: 'middle' });

  if (layout === 'two_column') {
    s.addShape(prs.ShapeType.roundRect, { x: 0.45, y: 1.45, w: 6.15, h: 5.45, fill: { color: 'F8FAFC' }, line: { color: theme.accentLight, pt: 1 } });
    s.addShape(prs.ShapeType.roundRect, { x: 6.75, y: 1.45, w: 6.15, h: 5.45, fill: { color: 'FFFFFF' }, line: { color: theme.accentLight, pt: 1 } });
    addBullets(s, bullets.slice(0, 8), { x: 0.8, y: 1.8, w: 5.5, h: 4.9 }, theme, 16);
    s.addText(content || 'Key narrative and supporting insight.', { x: 7.1, y: 1.8, w: 5.45, h: 4.9, fontSize: 16, color: theme.textDark, valign: 'top', wrap: true });
  } else if (layout === 'cards') {
    const items = bullets.length > 0 ? bullets : [content || 'Insight 1', 'Insight 2', 'Insight 3'];
    const count = Math.min(3, items.length);
    const gap = 0.45;
    const cardW = (12.2 - (gap * (count - 1))) / count;
    for (let c = 0; c < count; c++) {
      const x = 0.8 + c * (cardW + gap);
      s.addShape(prs.ShapeType.roundRect, { x, y: 1.85, w: cardW, h: 4.9, fill: { color: c % 2 ? 'FFFFFF' : 'F8FAFC' }, line: { color: theme.accentLight, pt: 1 } });
      s.addText(String(items[c]), { x: x + 0.28, y: 2.15, w: cardW - 0.56, h: 4.3, fontSize: 15, color: theme.textDark, bold: true, valign: 'top', wrap: true });
    }
  } else if (layout === 'quote') {
    s.addShape(prs.ShapeType.roundRect, { x: 1.2, y: 1.8, w: 10.9, h: 4.8, fill: { color: theme.accentLight }, line: { color: theme.accent, pt: 1.2 } });
    s.addText(`"${content || bullets[0] || 'Powerful idea goes here.'}"`, { x: 1.65, y: 2.25, w: 10.0, h: 3.2, fontSize: 30, bold: true, color: theme.textDark, align: 'center', valign: 'middle', italic: true, wrap: true });
    if (slide.subtitle) s.addText(String(slide.subtitle), { x: 1.65, y: 5.6, w: 10.0, h: 0.6, fontSize: 14, color: theme.textMuted, align: 'center' });
  } else if (layout === 'data_story') {
    const kpis = bullets.length > 0 ? bullets.slice(0, 3) : ['Revenue +18%', 'Margin +3.2 pts', 'Churn -1.1 pts'];
    s.addShape(prs.ShapeType.roundRect, { x: 0.7, y: 1.6, w: 12.0, h: 2.1, fill: { color: 'F8FAFC' }, line: { color: theme.accentLight, pt: 1 } });
    for (let k = 0; k < 3; k++) {
      const x = 1.05 + (k * 3.95);
      s.addShape(prs.ShapeType.roundRect, { x, y: 1.95, w: 3.72, h: 1.4, fill: { color: 'FFFFFF' }, line: { color: theme.accentLight, pt: 1 } });
      s.addText(String(kpis[k] || `KPI ${k + 1}`), { x: x + 0.2, y: 2.35, w: 3.32, h: 0.65, fontSize: 20, bold: true, color: theme.accent, align: 'center', valign: 'middle' });
    }
    s.addShape(prs.ShapeType.roundRect, { x: 0.7, y: 4.0, w: 7.6, h: 2.8, fill: { color: 'FFFFFF' }, line: { color: theme.accentLight, pt: 1 } });
    s.addText('Narrative', { x: 0.95, y: 4.2, w: 1.8, h: 0.35, fontSize: 12, bold: true, color: theme.textMuted });
    s.addText(content || 'Performance improved due to stronger retention and faster cycle times.', { x: 0.95, y: 4.55, w: 7.1, h: 2.05, fontSize: 16, color: theme.textDark, wrap: true });
    s.addShape(prs.ShapeType.roundRect, { x: 8.55, y: 4.0, w: 4.15, h: 2.8, fill: { color: theme.accentLight }, line: { color: theme.accent, pt: 1 } });
    s.addText('Key Takeaway', { x: 8.85, y: 4.2, w: 3.5, h: 0.35, fontSize: 12, bold: true, color: theme.textMuted });
    s.addText(String(slide.subtitle || 'Momentum is improving with durable operational gains.'), { x: 8.85, y: 4.6, w: 3.5, h: 1.95, fontSize: 14, color: theme.textDark, bold: true, wrap: true });
  } else if (layout === 'timeline') {
    const items = bullets.length > 0 ? bullets.slice(0, 5) : ['Phase 1', 'Phase 2', 'Phase 3', 'Phase 4'];
    s.addShape(prs.ShapeType.line, { x: 1.0, y: 3.6, w: 11.2, h: 0, line: { color: theme.accent, pt: 2 } });
    items.forEach((item, idx) => {
      const x = 1.2 + idx * (10.4 / Math.max(1, items.length - 1));
      s.addShape(prs.ShapeType.ellipse, { x: x - 0.12, y: 3.48, w: 0.24, h: 0.24, fill: { color: theme.accent }, line: { color: theme.accent, pt: 1 } });
      s.addText(String(item), { x: x - 1.0, y: idx % 2 ? 3.9 : 2.55, w: 2.0, h: 0.9, fontSize: 12, bold: true, color: theme.textDark, align: 'center', wrap: true });
    });
    if (content) s.addText(content, { x: 1.0, y: 5.7, w: 11.2, h: 0.9, fontSize: 14, color: theme.textMuted, align: 'center', wrap: true });
  } else if (layout === 'process_steps') {
    const items = bullets.length > 0 ? bullets.slice(0, 5) : ['Discover', 'Plan', 'Build', 'Launch'];
    const w = Math.min(2.5, 10.8 / items.length);
    items.forEach((item, idx) => {
      const x = 1.0 + idx * (w + 0.25);
      s.addShape(prs.ShapeType.roundRect, { x, y: 2.3, w, h: 2.2, fill: { color: idx % 2 ? 'FFFFFF' : 'F8FAFC' }, line: { color: theme.accentLight, pt: 1 } });
      s.addText(`${idx + 1}`, { x: x + 0.15, y: 2.45, w: 0.5, h: 0.35, fontSize: 12, bold: true, color: theme.accent, align: 'center' });
      s.addText(String(item), { x: x + 0.2, y: 2.95, w: w - 0.4, h: 1.2, fontSize: 14, bold: true, color: theme.textDark, align: 'center', valign: 'middle', wrap: true });
    });
    if (content) s.addText(content, { x: 1.0, y: 5.2, w: 11.4, h: 1.2, fontSize: 15, color: theme.textDark, align: 'center', wrap: true });
  } else if (layout === 'comparison_split') {
    s.addShape(prs.ShapeType.roundRect, { x: 0.8, y: 1.7, w: 5.85, h: 5.1, fill: { color: 'F8FAFC' }, line: { color: theme.accentLight, pt: 1 } });
    s.addShape(prs.ShapeType.roundRect, { x: 6.65, y: 1.7, w: 5.85, h: 5.1, fill: { color: 'FFFFFF' }, line: { color: theme.accentLight, pt: 1 } });
    s.addText(String(slide.leftTitle || 'Option A'), { x: 1.1, y: 2.0, w: 5.2, h: 0.4, fontSize: 14, bold: true, color: theme.accent });
    s.addText(String(slide.rightTitle || 'Option B'), { x: 6.95, y: 2.0, w: 5.2, h: 0.4, fontSize: 14, bold: true, color: theme.accent });
    addBullets(s, bullets.slice(0, Math.ceil(bullets.length / 2)), { x: 1.1, y: 2.5, w: 5.2, h: 3.9 }, theme, 14);
    const rightItems = bullets.slice(Math.ceil(bullets.length / 2));
    if (rightItems.length) addBullets(s, rightItems, { x: 6.95, y: 2.5, w: 5.2, h: 3.9 }, theme, 14);
    if (content) s.addText(content, { x: 1.0, y: 6.1, w: 11.4, h: 0.5, fontSize: 12, color: theme.textMuted, align: 'center', wrap: true });
  } else if (layout === 'swot_grid') {
    const labels = ['Strengths', 'Weaknesses', 'Opportunities', 'Threats'];
    for (let c = 0; c < 2; c++) {
      for (let r = 0; r < 2; r++) {
        const idx = r * 2 + c;
        const x = 0.8 + c * 6.0;
        const y = 1.7 + r * 2.6;
        s.addShape(prs.ShapeType.roundRect, { x, y, w: 5.7, h: 2.4, fill: { color: idx % 2 ? 'FFFFFF' : 'F8FAFC' }, line: { color: theme.accentLight, pt: 1 } });
        s.addText(labels[idx], { x: x + 0.2, y: y + 0.2, w: 5.2, h: 0.35, fontSize: 12, bold: true, color: theme.accent });
        s.addText(String(bullets[idx] || content || 'Add key points.'), { x: x + 0.2, y: y + 0.62, w: 5.2, h: 1.55, fontSize: 12, color: theme.textDark, wrap: true });
      }
    }
  } else if (layout === 'kpi_dashboard') {
    const items = bullets.length > 0 ? bullets.slice(0, 6) : ['Revenue: $12.3M', 'Gross Margin: 61%', 'CAC: $142', 'LTV: $1,980', 'NPS: 52', 'On-time: 94%'];
    for (let idx = 0; idx < items.length; idx++) {
      const c = idx % 3;
      const r = Math.floor(idx / 3);
      const x = 0.8 + c * 4.05;
      const y = 1.8 + r * 2.35;
      s.addShape(prs.ShapeType.roundRect, { x, y, w: 3.75, h: 2.1, fill: { color: 'FFFFFF' }, line: { color: theme.accentLight, pt: 1 } });
      s.addText(String(items[idx]), { x: x + 0.2, y: y + 0.5, w: 3.35, h: 1.2, fontSize: 16, bold: true, color: theme.accent, align: 'center', valign: 'middle', wrap: true });
    }
    if (content) s.addText(content, { x: 0.9, y: 6.5, w: 11.9, h: 0.35, fontSize: 11, color: theme.textMuted, align: 'center', italic: true });
  } else if (layout === 'checklist') {
    const items = bullets.length > 0 ? bullets : ['Item 1', 'Item 2', 'Item 3'];
    items.slice(0, 10).forEach((item, idx) => {
      const y = 1.8 + idx * 0.48;
      s.addShape(prs.ShapeType.roundRect, { x: 0.95, y, w: 11.4, h: 0.38, fill: { color: idx % 2 ? 'FFFFFF' : 'F8FAFC' }, line: { color: theme.accentLight, pt: 0.5 } });
      s.addText('✓', { x: 1.15, y: y + 0.04, w: 0.3, h: 0.25, fontSize: 13, bold: true, color: theme.accent });
      s.addText(String(item), { x: 1.55, y: y + 0.06, w: 10.5, h: 0.25, fontSize: 12, color: theme.textDark, wrap: true });
    });
    if (content) s.addText(content, { x: 1.0, y: 6.7, w: 11.2, h: 0.35, fontSize: 11, color: theme.textMuted, align: 'center' });
  } else if (layout === 'section_break') {
    s.addShape(prs.ShapeType.roundRect, { x: 0.9, y: 1.8, w: 11.5, h: 4.8, fill: { color: theme.accentLight }, line: { color: theme.accent, pt: 1.2 } });
    s.addText(slide.title || `Section ${i + 1}`, { x: 1.4, y: 3.1, w: 10.5, h: 1.0, fontSize: 40, bold: true, color: theme.textDark, align: 'center', valign: 'middle', wrap: true });
    if (content || slide.subtitle) s.addText(String(slide.subtitle || content), { x: 1.8, y: 4.4, w: 9.8, h: 0.7, fontSize: 16, color: theme.textMuted, align: 'center', wrap: true });
  } else if (layout === 'statistics_strip') {
    const items = bullets.length > 0 ? bullets.slice(0, 4) : ['32%', '18.4k', '$2.9M', '94%'];
    const stripW = 2.8;
    for (let idx = 0; idx < 4; idx++) {
      const x = 0.9 + idx * 3.05;
      s.addShape(prs.ShapeType.roundRect, { x, y: 2.5, w: stripW, h: 2.6, fill: { color: idx % 2 ? 'FFFFFF' : 'F8FAFC' }, line: { color: theme.accentLight, pt: 1 } });
      s.addText(String(items[idx] || '-'), { x: x + 0.2, y: 3.1, w: stripW - 0.4, h: 0.8, fontSize: 28, bold: true, color: theme.accent, align: 'center' });
      s.addText(`Metric ${idx + 1}`, { x: x + 0.2, y: 4.0, w: stripW - 0.4, h: 0.5, fontSize: 11, color: theme.textMuted, align: 'center' });
    }
    if (content) s.addText(content, { x: 1.0, y: 5.8, w: 11.3, h: 0.8, fontSize: 14, color: theme.textDark, align: 'center', wrap: true });
  } else if (layout === 'faq') {
    const items = bullets.length > 0 ? bullets.slice(0, 6) : ['Question 1 - Answer', 'Question 2 - Answer', 'Question 3 - Answer'];
    items.forEach((item, idx) => {
      const y = 1.7 + idx * 0.84;
      s.addShape(prs.ShapeType.roundRect, { x: 0.85, y, w: 11.8, h: 0.72, fill: { color: idx % 2 ? 'FFFFFF' : 'F8FAFC' }, line: { color: theme.accentLight, pt: 0.8 } });
      s.addText(String(item), { x: 1.1, y: y + 0.17, w: 11.2, h: 0.4, fontSize: 12, color: theme.textDark, wrap: true });
    });
    if (content) s.addText(content, { x: 0.95, y: 6.8, w: 11.5, h: 0.3, fontSize: 10, color: theme.textMuted, italic: true, align: 'center' });
  } else if (layout === 'table_like') {
    const rows = bullets.length > 0 ? bullets.slice(0, 8) : ['Row 1 | Value', 'Row 2 | Value', 'Row 3 | Value'];
    s.addShape(prs.ShapeType.roundRect, { x: 0.85, y: 1.8, w: 11.8, h: 0.55, fill: { color: theme.accentLight }, line: { color: theme.accentLight, pt: 1 } });
    s.addText('Category', { x: 1.1, y: 1.98, w: 5.4, h: 0.2, fontSize: 11, bold: true, color: theme.textDark });
    s.addText('Value', { x: 6.8, y: 1.98, w: 5.4, h: 0.2, fontSize: 11, bold: true, color: theme.textDark });
    rows.forEach((row, idx) => {
      const y = 2.4 + idx * 0.53;
      s.addShape(prs.ShapeType.roundRect, { x: 0.85, y, w: 11.8, h: 0.48, fill: { color: idx % 2 ? 'FFFFFF' : 'F8FAFC' }, line: { color: theme.accentLight, pt: 0.5 } });
      const parts = String(row).split('|');
      s.addText(String((parts[0] || row).trim()), { x: 1.1, y: y + 0.13, w: 5.3, h: 0.2, fontSize: 10, color: theme.textDark });
      s.addText(String((parts[1] || '').trim()), { x: 6.8, y: y + 0.13, w: 5.3, h: 0.2, fontSize: 10, color: theme.textDark });
    });
    if (content) s.addText(content, { x: 0.95, y: 6.9, w: 11.5, h: 0.2, fontSize: 10, color: theme.textMuted, align: 'right' });
  } else {
    addBullets(s, bullets, { x: '3%', y: 1.3, w: '94%', h: 5.8 }, theme, 18);
    if (bullets.length === 0 && content) s.addText(content, { x: '3%', y: 1.3, w: '94%', h: 5.8, fontSize: 18, color: theme.textDark, valign: 'top', wrap: true });
  }

  addFooter(s, slide, theme);
  s.addShape(prs.ShapeType.rect, { x: 0, y: 7.3, w: '100%', h: 0.2, fill: { color: theme.accentLight }, line: { type: 'none' } });
};

/**
 * Generate a PPTX from structured slide data
 *
 * @param {string} title
 * @param {Array<{title:string, bullets?:string[], content?:string}>} slides
 * @param {string} userId
 * @param {string|null} topicId
 * @param {object} options - subtitle, theme, style
 * @returns {{ file_id, file_name, file_type, created_at }}
 */
const generatePPT = async (title, slides, userId, topicId, options = {}) => {
  console.log(`[PPTGen] Generating PPT: "${title}" with ${slides.length} slides`);
  const themeKey = String(options.theme || options.style || 'modern_corporate').toLowerCase();
  const theme = THEMES[themeKey] || THEMES.modern_corporate;

  const prs = new pptxgen();
  prs.layout = 'LAYOUT_WIDE';

  const titleSlide = prs.addSlide();
  titleSlide.background = { color: theme.headerBg };
  titleSlide.addShape(prs.ShapeType.rect, { x: 0, y: 6.8, w: '100%', h: 0.7, fill: { color: theme.accent }, line: { type: 'none' } });
  titleSlide.addText(title, { x: '5%', y: '25%', w: '90%', h: '25%', fontSize: 40, bold: true, color: theme.textLight, align: 'center', valign: 'middle', wrap: true });
  if (options.subtitle) titleSlide.addText(options.subtitle, { x: '10%', y: '52%', w: '80%', h: '12%', fontSize: 20, color: 'CBD5E0', align: 'center', italic: true });
  titleSlide.addText(`${slides.length} slide${slides.length !== 1 ? 's' : ''}`, { x: '5%', y: 6.85, w: '90%', h: 0.5, fontSize: 12, color: theme.textLight, align: 'center' });

  for (let i = 0; i < slides.length; i++) {
    renderLayout(prs, prs.addSlide(), slides[i], i, slides.length, theme);
  }

  const buffer = await prs.write({ outputType: 'nodebuffer' });
  const safeName = title.slice(0, 40).replace(/[^a-z0-9\s]/gi, '').trim().replace(/\s+/g, '_').toLowerCase() || 'presentation';
  const fileName = `${safeName}_${Date.now()}.pptx`;
  const textContent = `PowerPoint Presentation: ${title}\nTheme: ${themeKey}\nSlides: ${slides.length}\n${slides.map((s, i) => `  Slide ${i + 1}: ${s.title}`).join('\n')}`;
  const result = await saveGeneratedBinaryFile(userId, topicId, fileName, textContent, 'pptx', buffer);
  if (!result) throw new Error('Failed to save generated PPTX to database');
  console.log(`[PPTGen] Saved as ${result.file_name} (id: ${result.file_id})`);
  return result;
};

module.exports = { generatePPT };
