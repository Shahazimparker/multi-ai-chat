// FILE: backend/services/pptGeneration.service.js
// PURPOSE: Generate PowerPoint files from structured slide data using pptxgenjs
const pptxgen = require('pptxgenjs');
const { saveGeneratedBinaryFile } = require('./fileUpload.service');

// Theme presets
const THEMES = {
  modern_corporate: {
    headerBg: '0F172A',
    accent: '0EA5E9',
    accentLight: 'E0F2FE',
    textDark: '0B1220',
    textLight: 'FFFFFF',
    textMuted: '64748B',
  },
  startup_bold: {
    headerBg: '111827',
    accent: 'F97316',
    accentLight: 'FFEDD5',
    textDark: '111827',
    textLight: 'FFFFFF',
    textMuted: '6B7280',
  },
  clean_minimal: {
    headerBg: '1E3A5F',
    accent: '2563EB',
    accentLight: 'DBEAFE',
    textDark: '1F2937',
    textLight: 'FFFFFF',
    textMuted: '6B7280',
  },
};

/**
 * Generate a PPTX from structured slide data
 *
 * @param {string} title
 * @param {Array<{title:string, bullets?:string[], content?:string}>} slides
 * @param {string} userId
 * @param {string|null} topicId
 * @param {object} options  - subtitle, theme, style
 * @returns {{ file_id, file_name, file_type, created_at }}
 */
const generatePPT = async (title, slides, userId, topicId, options = {}) => {
  console.log(`[PPTGen] Generating PPT: "${title}" with ${slides.length} slides`);
  const themeKey = String(options.theme || options.style || 'modern_corporate').toLowerCase();
  const THEME = THEMES[themeKey] || THEMES.modern_corporate;

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
    const layout = String(slide.layout || 'title_bullets').toLowerCase();

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

    const bullets = Array.isArray(slide.bullets) ? slide.bullets : [];
    const content = String(slide.content || '');

    if (layout === 'two_column') {
      s.addShape(prs.ShapeType.roundRect, {
        x: 0.45, y: 1.45, w: 6.15, h: 5.45,
        fill: { color: 'F8FAFC' },
        line: { color: THEME.accentLight, pt: 1 },
      });
      s.addShape(prs.ShapeType.roundRect, {
        x: 6.75, y: 1.45, w: 6.15, h: 5.45,
        fill: { color: 'FFFFFF' },
        line: { color: THEME.accentLight, pt: 1 },
      });

      if (bullets.length > 0) {
        const bulletItems = bullets.slice(0, 8).map((b) => ({
          text: String(b),
          options: {
            bullet: { type: 'bullet', code: '2022' },
            fontSize: 16,
            color: THEME.textDark,
            paraSpaceAfter: 8,
            indentLevel: 0,
          },
        }));
        s.addText(bulletItems, { x: 0.8, y: 1.8, w: 5.5, h: 4.9, valign: 'top' });
      }
      s.addText(content || 'Key narrative and supporting insight.', {
        x: 7.1, y: 1.8, w: 5.45, h: 4.9,
        fontSize: 16,
        color: THEME.textDark,
        valign: 'top',
        wrap: true,
      });
    } else if (layout === 'quote') {
      s.addShape(prs.ShapeType.roundRect, {
        x: 1.2, y: 1.8, w: 10.9, h: 4.8,
        fill: { color: THEME.accentLight },
        line: { color: THEME.accent, pt: 1.2 },
      });
      s.addText(`“${content || (bullets[0] || 'Powerful idea goes here.')}”`, {
        x: 1.65, y: 2.25, w: 10.0, h: 3.2,
        fontSize: 30,
        bold: true,
        color: THEME.textDark,
        align: 'center',
        valign: 'middle',
        italic: true,
        wrap: true,
      });
      if (slide.subtitle) {
        s.addText(String(slide.subtitle), {
          x: 1.65, y: 5.6, w: 10.0, h: 0.6,
          fontSize: 14,
          color: THEME.textMuted,
          align: 'center',
        });
      }
    } else if (layout === 'cards') {
      const items = bullets.length > 0 ? bullets : [content || 'Insight 1', 'Insight 2', 'Insight 3'];
      const cardCount = Math.min(3, items.length);
      const startX = 0.8;
      const gap = 0.45;
      const cardW = (12.2 - (gap * (cardCount - 1))) / cardCount;
      for (let c = 0; c < cardCount; c++) {
        const x = startX + c * (cardW + gap);
        s.addShape(prs.ShapeType.roundRect, {
          x, y: 1.85, w: cardW, h: 4.9,
          fill: { color: c % 2 ? 'FFFFFF' : 'F8FAFC' },
          line: { color: THEME.accentLight, pt: 1 },
          shadow: { type: 'outer', color: '94A3B8', blur: 2, angle: 45, distance: 1, opacity: 0.15 },
        });
        s.addText(String(items[c]), {
          x: x + 0.28, y: 2.15, w: cardW - 0.56, h: 4.3,
          fontSize: 15,
          color: THEME.textDark,
          bold: true,
          valign: 'top',
          wrap: true,
        });
      }
    } else if (layout === 'data_story') {
      const kpis = bullets.length > 0 ? bullets.slice(0, 3) : ['Revenue +18%', 'Margin +3.2 pts', 'Churn -1.1 pts'];
      const narrative = content || 'Performance improved due to stronger retention, better pricing discipline, and faster cycle times.';

      s.addShape(prs.ShapeType.roundRect, {
        x: 0.7, y: 1.6, w: 12.0, h: 2.1,
        fill: { color: 'F8FAFC' },
        line: { color: THEME.accentLight, pt: 1 },
      });
      const kpiW = 3.72;
      for (let k = 0; k < 3; k++) {
        const x = 1.05 + (k * 3.95);
        s.addShape(prs.ShapeType.roundRect, {
          x, y: 1.95, w: kpiW, h: 1.4,
          fill: { color: 'FFFFFF' },
          line: { color: THEME.accentLight, pt: 1 },
        });
        s.addText(String(kpis[k] || `KPI ${k + 1}`), {
          x: x + 0.2, y: 2.35, w: kpiW - 0.4, h: 0.65,
          fontSize: 20,
          bold: true,
          color: THEME.accent,
          align: 'center',
          valign: 'middle',
        });
      }

      s.addShape(prs.ShapeType.roundRect, {
        x: 0.7, y: 4.0, w: 7.6, h: 2.8,
        fill: { color: 'FFFFFF' },
        line: { color: THEME.accentLight, pt: 1 },
      });
      s.addText('Narrative', {
        x: 0.95, y: 4.2, w: 1.8, h: 0.35,
        fontSize: 12,
        bold: true,
        color: THEME.textMuted,
      });
      s.addText(narrative, {
        x: 0.95, y: 4.55, w: 7.1, h: 2.05,
        fontSize: 16,
        color: THEME.textDark,
        wrap: true,
      });

      s.addShape(prs.ShapeType.roundRect, {
        x: 8.55, y: 4.0, w: 4.15, h: 2.8,
        fill: { color: THEME.accentLight },
        line: { color: THEME.accent, pt: 1 },
      });
      s.addText('Key Takeaway', {
        x: 8.85, y: 4.2, w: 3.5, h: 0.35,
        fontSize: 12,
        bold: true,
        color: THEME.textMuted,
      });
      s.addText(String(slide.subtitle || 'Momentum is improving with durable operational gains.'), {
        x: 8.85, y: 4.6, w: 3.5, h: 1.95,
        fontSize: 14,
        color: THEME.textDark,
        bold: true,
        wrap: true,
      });
    } else {
      const contentY = 1.3;
      const contentH = 5.8;
      if (bullets.length > 0) {
        const bulletItems = bullets.map((b) => ({
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
      } else if (content) {
        s.addText(content, {
          x: '3%', y: contentY, w: '94%', h: contentH,
          fontSize: 18,
          color: THEME.textDark,
          valign: 'top',
          wrap: true,
        });
      }
    }

    if (slide.footerNote) {
      s.addText(String(slide.footerNote), {
        x: 0.5, y: 6.95, w: 12.2, h: 0.24,
        fontSize: 10,
        color: THEME.textMuted,
        align: 'right',
        italic: true,
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
  const textContent = `PowerPoint Presentation: ${title}\nTheme: ${themeKey}\nSlides: ${slides.length}\n${slides.map((s, i) => `  Slide ${i + 1}: ${s.title}`).join('\n')}`;

  const result = await saveGeneratedBinaryFile(userId, topicId, fileName, textContent, 'pptx', buffer);

  if (!result) throw new Error('Failed to save generated PPTX to database');

  console.log(`[PPTGen] Saved as ${result.file_name} (id: ${result.file_id})`);
  return result;
};

module.exports = { generatePPT };
