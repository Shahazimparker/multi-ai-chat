// FILE: backend/services/pptGeneration.service.js
// PURPOSE: Generate PowerPoint files from structured slide data using pptxgenjs
const pptxgen = require('pptxgenjs');
const { saveGeneratedBinaryFile } = require('./fileUpload.service');

// Theme colours
const THEME = {
  headerBg: '1E3A5F',     // deep navy for title slide bg
  accent: '2563EB',       // blue for slide header bar
  accentLight: 'DBEAFE',  // light blue for alt rows
  textDark: '1F2937',
  textLight: 'FFFFFF',
  textMuted: '6B7280',
};

/**
 * Generate a PPTX from structured slide data
 *
 * @param {string} title
 * @param {Array<{title:string, bullets?:string[], content?:string}>} slides
 * @param {string} userId
 * @param {string|null} topicId
 * @param {object} options  - subtitle, theme
 * @returns {{ file_id, file_name, file_type, created_at }}
 */
const generatePPT = async (title, slides, userId, topicId, options = {}) => {
  console.log(`[PPTGen] Generating PPT: "${title}" with ${slides.length} slides`);

  const prs = new pptxgen();
  prs.layout = 'LAYOUT_WIDE'; // 13.33" x 7.5"

  // ── Title slide ────────────────────────────────────────────
  const titleSlide = prs.addSlide();
  titleSlide.background = { color: THEME.headerBg };

  // Decorative accent bar at bottom
  titleSlide.addShape(prs.ShapeType.rect, {
    x: 0, y: 6.8, w: '100%', h: 0.7,
    fill: { color: THEME.accent },
    line: { type: 'none' },
  });

  titleSlide.addText(title, {
    x: '5%', y: '25%', w: '90%', h: '25%',
    fontSize: 40,
    bold: true,
    color: THEME.textLight,
    align: 'center',
    valign: 'middle',
    wrap: true,
  });

  if (options.subtitle) {
    titleSlide.addText(options.subtitle, {
      x: '10%', y: '52%', w: '80%', h: '12%',
      fontSize: 20,
      color: 'CBD5E0',
      align: 'center',
      italic: true,
    });
  }

  // Slide count note at bottom
  titleSlide.addText(`${slides.length} slide${slides.length !== 1 ? 's' : ''}`, {
    x: '5%', y: 6.85, w: '90%', h: 0.5,
    fontSize: 12,
    color: THEME.textLight,
    align: 'center',
  });

  // ── Content slides ─────────────────────────────────────────
  for (let i = 0; i < slides.length; i++) {
    const slide = slides[i];
    const s = prs.addSlide();

    s.background = { color: 'FFFFFF' };

    // Top header bar with slide title
    s.addShape(prs.ShapeType.rect, {
      x: 0, y: 0, w: '100%', h: 1.15,
      fill: { color: THEME.accent },
      line: { type: 'none' },
    });

    s.addText(slide.title || `Slide ${i + 1}`, {
      x: '2%', y: 0.12, w: '88%', h: 0.9,
      fontSize: 24,
      bold: true,
      color: THEME.textLight,
      valign: 'middle',
    });

    // Slide number (top-right)
    s.addText(`${i + 1} / ${slides.length}`, {
      x: '90%', y: 0.12, w: '8%', h: 0.9,
      fontSize: 12,
      color: 'BFD9FF',
      align: 'right',
      valign: 'middle',
    });

    // Content area
    const contentY = 1.3;
    const contentH = 5.8;

    if (slide.bullets && slide.bullets.length > 0) {
      const bulletItems = slide.bullets.map((b) => ({
        text: String(b),
        options: {
          bullet: { type: 'bullet', code: '2022' },
          fontSize: 18,
          color: THEME.textDark,
          paraSpaceAfter: 10,
          indentLevel: 0,
        },
      }));
      s.addText(bulletItems, {
        x: '3%', y: contentY, w: '94%', h: contentH,
        valign: 'top',
      });
    } else if (slide.content) {
      s.addText(slide.content, {
        x: '3%', y: contentY, w: '94%', h: contentH,
        fontSize: 18,
        color: THEME.textDark,
        valign: 'top',
        wrap: true,
      });
    }

    // Bottom accent line
    s.addShape(prs.ShapeType.rect, {
      x: 0, y: 7.3, w: '100%', h: 0.2,
      fill: { color: THEME.accentLight },
      line: { type: 'none' },
    });
  }

  const buffer = await prs.write({ outputType: 'nodebuffer' });

  const safeName = title
    .slice(0, 40)
    .replace(/[^a-z0-9\s]/gi, '')
    .trim()
    .replace(/\s+/g, '_')
    .toLowerCase() || 'presentation';

  const fileName = `${safeName}_${Date.now()}.pptx`;
  const textContent = `PowerPoint Presentation: ${title}\nSlides: ${slides.length}\n${slides.map((s, i) => `  Slide ${i + 1}: ${s.title}`).join('\n')}`;

  const result = await saveGeneratedBinaryFile(userId, topicId, fileName, textContent, 'pptx', buffer);

  if (!result) throw new Error('Failed to save generated PPTX to database');

  console.log(`[PPTGen] Saved as ${result.file_name} (id: ${result.file_id})`);
  return result;
};

module.exports = { generatePPT };
