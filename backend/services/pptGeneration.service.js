// FILE: backend/services/pptGeneration.service.js
// PURPOSE: Generate PowerPoint files from structured slide data using pptxgenjs
const pptxgen = require('pptxgenjs');
const { saveGeneratedBinaryFile } = require('./fileUpload.service');

const THEMES = {
  // ── Original 12 ──────────────────────────────────────────────
  modern_corporate:    { headerBg: '0F172A', accent: '0EA5E9', accentLight: 'E0F2FE', textDark: '0B1220', textLight: 'FFFFFF', textMuted: '64748B' },
  startup_bold:        { headerBg: '111827', accent: 'F97316', accentLight: 'FFEDD5', textDark: '111827', textLight: 'FFFFFF', textMuted: '6B7280' },
  clean_minimal:       { headerBg: '1E3A5F', accent: '2563EB', accentLight: 'DBEAFE', textDark: '1F2937', textLight: 'FFFFFF', textMuted: '6B7280' },
  emerald_glass:       { headerBg: '052E2B', accent: '10B981', accentLight: 'D1FAE5', textDark: '052E2B', textLight: 'FFFFFF', textMuted: '4B5563' },
  sunset_warm:         { headerBg: '7C2D12', accent: 'FB923C', accentLight: 'FFEDD5', textDark: '431407', textLight: 'FFFFFF', textMuted: '7C2D12' },
  charcoal_lime:       { headerBg: '1F2937', accent: '84CC16', accentLight: 'ECFCCB', textDark: '111827', textLight: 'FFFFFF', textMuted: '4B5563' },
  sandstone_editorial: { headerBg: '44403C', accent: 'D6A568', accentLight: 'FAF3E8', textDark: '292524', textLight: 'FFFFFF', textMuted: '78716C' },
  ruby_noir:           { headerBg: '3F0D1D', accent: 'E11D48', accentLight: 'FFE4E6', textDark: '4C0519', textLight: 'FFFFFF', textMuted: '7F1D1D' },
  violet_tech:         { headerBg: '312E81', accent: '8B5CF6', accentLight: 'EDE9FE', textDark: '1E1B4B', textLight: 'FFFFFF', textMuted: '5B21B6' },
  ocean_depth:         { headerBg: '0C4A6E', accent: '06B6D4', accentLight: 'CFFAFE', textDark: '082F49', textLight: 'FFFFFF', textMuted: '0E7490' },
  rose_creative:       { headerBg: '831843', accent: 'F43F5E', accentLight: 'FFE4E6', textDark: '4C0519', textLight: 'FFFFFF', textMuted: '9F1239' },
  mono_editorial:      { headerBg: '262626', accent: '737373', accentLight: 'F5F5F5', textDark: '171717', textLight: 'FFFFFF', textMuted: '525252' },
  // ── New modern 8 ─────────────────────────────────────────────
  arctic_blue:         { headerBg: '0A1628', accent: '38BDF8', accentLight: 'E0F7FF', textDark: '0A1628', textLight: 'FFFFFF', textMuted: '64748B' },
  forest_night:        { headerBg: '0D2B1F', accent: '4ADE80', accentLight: 'DCFCE7', textDark: '0D2B1F', textLight: 'FFFFFF', textMuted: '4B5563' },
  golden_age:          { headerBg: '1A1006', accent: 'D97706', accentLight: 'FEF3C7', textDark: '1A1006', textLight: 'FFFFFF', textMuted: '92400E' },
  midnight_plum:       { headerBg: '1E0A2E', accent: 'C084FC', accentLight: 'F3E8FF', textDark: '1E0A2E', textLight: 'FFFFFF', textMuted: '7C3AED' },
  slate_coral:         { headerBg: '1E293B', accent: 'F87171', accentLight: 'FEE2E2', textDark: '1E293B', textLight: 'FFFFFF', textMuted: '94A3B8' },
  graphite_gold:       { headerBg: '18181B', accent: 'FBBF24', accentLight: 'FEF9C3', textDark: '18181B', textLight: 'FFFFFF', textMuted: '71717A' },
  teal_glass:          { headerBg: '0F3C3C', accent: '2DD4BF', accentLight: 'CCFBF1', textDark: '0F3C3C', textLight: 'FFFFFF', textMuted: '0D9488' },
  cobalt_bold:         { headerBg: '1E3A8A', accent: '93C5FD', accentLight: 'DBEAFE', textDark: '1E1B4B', textLight: 'FFFFFF', textMuted: '6366F1' },
};

const KNOWN_LAYOUTS = new Set([
  'title_bullets', 'two_column', 'cards', 'quote', 'data_story',
  'timeline', 'process_steps', 'comparison_split', 'swot_grid',
  'kpi_dashboard', 'checklist', 'section_break', 'statistics_strip', 'faq', 'table_like',
  'hero_statement', 'agenda',
]);

// Slide canvas: 13.33 × 7.5 inches (LAYOUT_WIDE)
const CY = 1.42;   // content area top (below header)
const BT = 7.27;   // bottom bar top
const BH = 0.23;   // bottom bar height
const MW = 13.33;  // slide width
const MH = 7.5;    // slide height

// ── Header variants ───────────────────────────────────────────

// Dark editorial header: deep background + left accent tab + underline stripe
const darkHeader = (prs, s, title, i, total, t) => {
  s.addShape(prs.ShapeType.rect, { x: 0, y: 0, w: MW, h: 1.3, fill: { color: t.headerBg }, line: { type: 'none' } });
  s.addShape(prs.ShapeType.rect, { x: 0, y: 0, w: 0.24, h: 1.3, fill: { color: t.accent }, line: { type: 'none' } });
  s.addShape(prs.ShapeType.rect, { x: 0.24, y: 1.3, w: MW, h: 0.07, fill: { color: t.accent }, line: { type: 'none' } });
  s.addText(title, { x: 0.44, y: 0, w: 11.6, h: 1.3, fontSize: 27, bold: true, color: t.textLight, valign: 'middle' });
  s.addText(`${i + 1} / ${total}`, { x: 11.7, y: 0.46, w: 1.4, h: 0.38, fontSize: 11, bold: true, color: t.accent, align: 'right' });
};

// Vivid accent header: accent band + dark left tab — for data/stats slides
const accentHeader = (prs, s, title, i, total, t) => {
  s.addShape(prs.ShapeType.rect, { x: 0, y: 0, w: MW, h: 1.3, fill: { color: t.accent }, line: { type: 'none' } });
  s.addShape(prs.ShapeType.rect, { x: 0, y: 0, w: 0.24, h: 1.3, fill: { color: t.headerBg }, line: { type: 'none' } });
  s.addShape(prs.ShapeType.rect, { x: 0.24, y: 1.3, w: MW, h: 0.07, fill: { color: t.headerBg }, line: { type: 'none' } });
  s.addText(title, { x: 0.44, y: 0, w: 11.6, h: 1.3, fontSize: 27, bold: true, color: t.textLight, valign: 'middle' });
  s.addText(`${i + 1} / ${total}`, { x: 11.7, y: 0.46, w: 1.4, h: 0.38, fontSize: 11, bold: true, color: t.headerBg, align: 'right' });
};

// ── Bullet helpers ────────────────────────────────────────────

const addBullets = (s, items, box, t, fontSize = 16) => {
  if (!items || items.length === 0) return;
  s.addText(
    items.map((b) => ({ text: String(b), options: { bullet: { type: 'bullet', code: '2022' }, fontSize, color: t.textDark, paraSpaceAfter: 8 } })),
    { ...box, valign: 'top' },
  );
};

const addBulletsLight = (s, items, box, t, fontSize = 16) => {
  if (!items || items.length === 0) return;
  s.addText(
    items.map((b) => ({ text: String(b), options: { bullet: { type: 'bullet', code: '2022' }, fontSize, color: t.textLight, paraSpaceAfter: 8 } })),
    { ...box, valign: 'top' },
  );
};

// ── Bottom bar / footer ───────────────────────────────────────

const addBottomBar = (prs, s, slide, t) => {
  s.addShape(prs.ShapeType.rect, { x: 0, y: BT, w: MW, h: BH, fill: { color: t.accentLight }, line: { type: 'none' } });
  if (slide.footerNote) {
    s.addText(String(slide.footerNote), {
      x: 0.5, y: BT + 0.03, w: 12.3, h: BH - 0.04,
      fontSize: 9, color: t.textMuted, align: 'right', italic: true,
    });
  }
};

// ── Layout renderers ──────────────────────────────────────────

const renderLayout = (prs, s, slide, i, slideCount, t) => {
  const bullets = Array.isArray(slide.bullets) ? slide.bullets : [];
  const content = String(slide.content || '');
  const layout = KNOWN_LAYOUTS.has(String(slide.layout || '').toLowerCase())
    ? String(slide.layout).toLowerCase()
    : 'title_bullets';

  s.background = { color: 'FFFFFF' };

  // ── section_break: full-slide treatment ──────────────────────
  if (layout === 'section_break') {
    s.background = { color: t.headerBg };
    // Large decorative ellipse top-right
    s.addShape(prs.ShapeType.ellipse, { x: 9.5, y: -1.5, w: 6.0, h: 6.0, fill: { color: t.accent, transparency: 82 }, line: { type: 'none' } });
    s.addShape(prs.ShapeType.ellipse, { x: 10.8, y: -0.2, w: 3.5, h: 3.5, fill: { color: t.accent, transparency: 72 }, line: { type: 'none' } });
    // Bottom-left decorative ellipse
    s.addShape(prs.ShapeType.ellipse, { x: -1.5, y: 5.5, w: 4.0, h: 4.0, fill: { color: t.accent, transparency: 85 }, line: { type: 'none' } });
    // Left accent vertical strip
    s.addShape(prs.ShapeType.rect, { x: 0, y: 0, w: 0.28, h: MH, fill: { color: t.accent }, line: { type: 'none' } });
    // Section label badge
    s.addShape(prs.ShapeType.roundRect, { x: 0.55, y: 1.8, w: 1.6, h: 0.38, fill: { color: t.accent }, line: { type: 'none' } });
    s.addText('SECTION', { x: 0.55, y: 1.8, w: 1.6, h: 0.38, fontSize: 11, bold: true, color: t.textLight, align: 'center', valign: 'middle' });
    // Main section title
    s.addText(slide.title || `Section ${i + 1}`, {
      x: 0.55, y: 2.3, w: 12.3, h: 2.2,
      fontSize: 48, bold: true, color: t.textLight, valign: 'top', wrap: true,
    });
    // Subtitle / description
    if (content || slide.subtitle) {
      s.addShape(prs.ShapeType.rect, { x: 0.55, y: 4.7, w: 6.0, h: 0.07, fill: { color: t.accent }, line: { type: 'none' } });
      s.addText(String(slide.subtitle || content), {
        x: 0.55, y: 4.9, w: 10.5, h: 0.9,
        fontSize: 18, color: t.accent, italic: true, wrap: true,
      });
    }
    // Slide count bottom-right
    s.addText(`${i + 1} / ${slideCount}`, { x: 11.5, y: 7.1, w: 1.5, h: 0.3, fontSize: 11, color: t.accent, align: 'right' });
    return;
  }

  // ── quote: dramatic full-dark treatment ───────────────────────
  if (layout === 'quote') {
    s.background = { color: t.headerBg };
    // Large decorative quotation mark
    s.addText('“', {
      x: 0.2, y: 0.5, w: 3.5, h: 3.5,
      fontSize: 260, bold: true, color: t.accent,
      valign: 'top', transparency: 75,
    });
    // Left accent strip
    s.addShape(prs.ShapeType.rect, { x: 0, y: 0, w: 0.28, h: MH, fill: { color: t.accent }, line: { type: 'none' } });
    // Slide header label
    s.addText(slide.title || 'Quote', {
      x: 0.5, y: 0.3, w: 12.3, h: 0.55,
      fontSize: 13, bold: true, color: t.accent, italic: false,
    });
    // Quote text — centered and large
    const quoteText = content || (bullets.length > 0 ? bullets[0] : 'Powerful idea goes here.');
    s.addText(`“${quoteText}”`, {
      x: 1.0, y: 1.8, w: 11.3, h: 3.8,
      fontSize: 28, bold: true, color: t.textLight,
      align: 'center', valign: 'middle', italic: true, wrap: true,
    });
    // Attribution
    if (slide.subtitle) {
      s.addShape(prs.ShapeType.rect, { x: 4.5, y: 5.75, w: 4.33, h: 0.05, fill: { color: t.accent }, line: { type: 'none' } });
      s.addText(`— ${slide.subtitle}`, {
        x: 1.0, y: 5.9, w: 11.3, h: 0.5,
        fontSize: 15, color: t.accent, align: 'center', italic: true,
      });
    }
    // Slide number
    s.addText(`${i + 1} / ${slideCount}`, { x: 11.5, y: 7.1, w: 1.5, h: 0.3, fontSize: 11, color: t.accent, align: 'right' });
    return;
  }

  // ── hero_statement: dramatic full-dark centered statement ─────
  if (layout === 'hero_statement') {
    s.background = { color: t.headerBg };
    // Decorative ellipses
    s.addShape(prs.ShapeType.ellipse, { x: 8.0, y: -2.5, w: 9.0, h: 9.0, fill: { color: t.accent, transparency: 88 }, line: { type: 'none' } });
    s.addShape(prs.ShapeType.ellipse, { x: -2.5, y: 3.5, w: 7.0, h: 7.0, fill: { color: t.accent, transparency: 88 }, line: { type: 'none' } });
    // Left accent strip
    s.addShape(prs.ShapeType.rect, { x: 0, y: 0, w: 0.28, h: MH, fill: { color: t.accent }, line: { type: 'none' } });
    // Slide label (title as small uppercase tag)
    s.addText((slide.title || 'Statement').toUpperCase(), {
      x: 0.5, y: 0.32, w: 12.3, h: 0.4,
      fontSize: 11, bold: true, color: t.accent, charSpacing: 2.5,
    });
    // Main statement — big centered bold text
    const statement = content || (bullets.length > 0 ? String(bullets[0]) : 'Your powerful statement goes here.');
    s.addText(statement, {
      x: 0.55, y: 1.4, w: 12.2, h: 4.2,
      fontSize: 36, bold: true, color: t.textLight,
      align: 'center', valign: 'middle', wrap: true,
    });
    // Supporting tagline below divider line
    const tagline = slide.subtitle || (bullets.length > 1 ? String(bullets[1]) : '');
    if (tagline) {
      s.addShape(prs.ShapeType.rect, { x: 3.5, y: 5.7, w: 6.33, h: 0.06, fill: { color: t.accent }, line: { type: 'none' } });
      s.addText(tagline, {
        x: 1.0, y: 5.85, w: 11.3, h: 0.52,
        fontSize: 16, color: t.accent, align: 'center', italic: true, wrap: true,
      });
    }
    // Subtle bottom band + slide number
    s.addShape(prs.ShapeType.rect, { x: 0, y: 7.12, w: MW, h: 0.26, fill: { color: t.accent, transparency: 80 }, line: { type: 'none' } });
    s.addText(`${i + 1} / ${slideCount}`, { x: 11.5, y: 7.15, w: 1.5, h: 0.22, fontSize: 10, color: t.accent, align: 'right' });
    return;
  }

  // ── Standard layouts: choose header, then body ────────────────
  const usesAccentHeader = ['statistics_strip', 'kpi_dashboard', 'data_story'].includes(layout);
  const titleText = slide.title || `Slide ${i + 1}`;
  if (usesAccentHeader) accentHeader(prs, s, titleText, i, slideCount, t);
  else darkHeader(prs, s, titleText, i, slideCount, t);

  // ── title_bullets (default) ───────────────────────────────────
  if (layout === 'title_bullets') {
    // Thin left accent rule alongside content
    s.addShape(prs.ShapeType.rect, { x: 0.38, y: CY, w: 0.06, h: BT - CY, fill: { color: t.accentLight }, line: { type: 'none' } });
    if (slide.subtitle) {
      s.addText(String(slide.subtitle), {
        x: 0.6, y: CY, w: 12.3, h: 0.42,
        fontSize: 14, color: t.textMuted, italic: true,
      });
      addBullets(s, bullets, { x: 0.6, y: CY + 0.5, w: 12.3, h: BT - CY - 0.55 }, t, 17);
      if (bullets.length === 0 && content) {
        s.addText(content, { x: 0.6, y: CY + 0.5, w: 12.3, h: BT - CY - 0.55, fontSize: 17, color: t.textDark, valign: 'top', wrap: true });
      }
    } else {
      addBullets(s, bullets, { x: 0.6, y: CY, w: 12.3, h: BT - CY }, t, 18);
      if (bullets.length === 0 && content) {
        s.addText(content, { x: 0.6, y: CY, w: 12.3, h: BT - CY, fontSize: 18, color: t.textDark, valign: 'top', wrap: true });
      }
    }

  // ── two_column ────────────────────────────────────────────────
  } else if (layout === 'two_column') {
    const panelH = BT - CY;
    const midX = 6.67;
    // Left panel: dark background
    s.addShape(prs.ShapeType.rect, { x: 0, y: CY, w: midX, h: panelH, fill: { color: t.headerBg }, line: { type: 'none' } });
    // Right panel: light background
    s.addShape(prs.ShapeType.rect, { x: midX, y: CY, w: MW - midX, h: panelH, fill: { color: 'F8FAFC' }, line: { type: 'none' } });
    // Center accent divider
    s.addShape(prs.ShapeType.rect, { x: midX - 0.04, y: CY, w: 0.08, h: panelH, fill: { color: t.accent }, line: { type: 'none' } });
    // Left column header label
    s.addText('KEY POINTS', {
      x: 0.35, y: CY + 0.15, w: midX - 0.5, h: 0.3,
      fontSize: 10, bold: true, color: t.accent, charSpacing: 1.5,
    });
    addBulletsLight(s, bullets.slice(0, 8), { x: 0.35, y: CY + 0.55, w: midX - 0.55, h: panelH - 0.65 }, t, 15);
    // Right column header label
    s.addText('DETAILS', {
      x: midX + 0.25, y: CY + 0.15, w: MW - midX - 0.4, h: 0.3,
      fontSize: 10, bold: true, color: t.textMuted, charSpacing: 1.5,
    });
    s.addText(content || 'Key narrative and supporting insight for this slide.', {
      x: midX + 0.25, y: CY + 0.55, w: MW - midX - 0.45, h: panelH - 0.65,
      fontSize: 15, color: t.textDark, valign: 'top', wrap: true,
    });

  // ── cards ─────────────────────────────────────────────────────
  } else if (layout === 'cards') {
    const items = bullets.length > 0 ? bullets : (content ? [content] : ['Insight 1', 'Insight 2', 'Insight 3']);
    const count = Math.min(4, items.length);
    const gap = 0.3;
    const cardW = (MW - 0.7 - gap * (count - 1)) / count;
    const cardY = CY + 0.1;
    const cardH = BT - cardY - 0.05;
    for (let c = 0; c < count; c++) {
      const x = 0.35 + c * (cardW + gap);
      // Card shadow effect (slightly offset dark rect)
      s.addShape(prs.ShapeType.roundRect, { x: x + 0.04, y: cardY + 0.06, w: cardW, h: cardH, fill: { color: t.accentLight }, line: { type: 'none' } });
      // Card body
      s.addShape(prs.ShapeType.roundRect, { x, y: cardY, w: cardW, h: cardH, fill: { color: 'FFFFFF' }, line: { color: t.accentLight, pt: 1 } });
      // Accent top strip
      s.addShape(prs.ShapeType.rect, { x, y: cardY, w: cardW, h: 0.42, fill: { color: t.accent }, line: { type: 'none' } });
      // Card number in top-left of strip
      s.addText(`${c + 1}`, { x: x + 0.12, y: cardY + 0.06, w: 0.3, h: 0.3, fontSize: 13, bold: true, color: t.textLight });
      // Card content text
      s.addText(String(items[c]), {
        x: x + 0.18, y: cardY + 0.52, w: cardW - 0.35, h: cardH - 0.62,
        fontSize: 14, color: t.textDark, valign: 'top', wrap: true, bold: false,
      });
    }

  // ── data_story ────────────────────────────────────────────────
  } else if (layout === 'data_story') {
    const kpis = bullets.length > 0 ? bullets.slice(0, 3) : ['Revenue +18%', 'Margin +3.2 pts', 'Churn -1.1 pts'];
    const kpiY = CY + 0.05;
    const kpiH = 1.55;
    const kpiW = (MW - 0.7) / 3;
    // KPI row
    for (let k = 0; k < 3; k++) {
      const x = 0.35 + k * kpiW;
      s.addShape(prs.ShapeType.roundRect, { x, y: kpiY, w: kpiW - 0.15, h: kpiH, fill: { color: t.headerBg }, line: { type: 'none' } });
      s.addShape(prs.ShapeType.rect, { x, y: kpiY, w: 0.18, h: kpiH, fill: { color: t.accent }, line: { type: 'none' } });
      s.addText(String(kpis[k] || `KPI ${k + 1}`), {
        x: x + 0.28, y: kpiY + 0.2, w: kpiW - 0.55, h: kpiH - 0.38,
        fontSize: 22, bold: true, color: t.textLight, valign: 'middle', align: 'center', wrap: true,
      });
    }
    // Narrative + Takeaway panels
    const panelY = kpiY + kpiH + 0.2;
    const panelH = BT - panelY - 0.05;
    const narW = 8.0;
    const takW = MW - narW - 0.7;
    s.addShape(prs.ShapeType.roundRect, { x: 0.35, y: panelY, w: narW, h: panelH, fill: { color: 'F8FAFC' }, line: { color: t.accentLight, pt: 1 } });
    s.addText('NARRATIVE', { x: 0.55, y: panelY + 0.15, w: 3.0, h: 0.28, fontSize: 10, bold: true, color: t.textMuted, charSpacing: 1.5 });
    s.addText(content || 'Performance improved due to stronger retention and faster cycle times.', {
      x: 0.55, y: panelY + 0.48, w: narW - 0.3, h: panelH - 0.6,
      fontSize: 15, color: t.textDark, valign: 'top', wrap: true,
    });
    s.addShape(prs.ShapeType.roundRect, { x: narW + 0.5, y: panelY, w: takW, h: panelH, fill: { color: t.accentLight }, line: { color: t.accent, pt: 1.2 } });
    s.addShape(prs.ShapeType.rect, { x: narW + 0.5, y: panelY, w: 0.2, h: panelH, fill: { color: t.accent }, line: { type: 'none' } });
    s.addText('KEY TAKEAWAY', { x: narW + 0.82, y: panelY + 0.15, w: takW - 0.4, h: 0.28, fontSize: 10, bold: true, color: t.textMuted, charSpacing: 1.5 });
    s.addText(String(slide.subtitle || 'Momentum is improving with durable operational gains.'), {
      x: narW + 0.82, y: panelY + 0.5, w: takW - 0.45, h: panelH - 0.62,
      fontSize: 14, color: t.textDark, bold: true, valign: 'top', wrap: true,
    });

  // ── timeline ──────────────────────────────────────────────────
  } else if (layout === 'timeline') {
    const items = bullets.length > 0 ? bullets.slice(0, 5) : ['Phase 1', 'Phase 2', 'Phase 3', 'Phase 4'];
    const lineY = 3.85;
    const lineX1 = 0.7;
    const lineX2 = MW - 0.7;
    // Background track
    s.addShape(prs.ShapeType.rect, { x: lineX1, y: lineY - 0.04, w: lineX2 - lineX1, h: 0.08, fill: { color: t.accentLight }, line: { type: 'none' } });
    // Active line (accent)
    s.addShape(prs.ShapeType.rect, { x: lineX1, y: lineY - 0.04, w: lineX2 - lineX1, h: 0.08, fill: { color: t.accent }, line: { type: 'none' } });

    items.forEach((item, idx) => {
      const x = items.length === 1 ? (lineX1 + lineX2) / 2 : lineX1 + idx * ((lineX2 - lineX1) / (items.length - 1));
      const above = idx % 2 === 0;
      // Node circle (filled)
      s.addShape(prs.ShapeType.ellipse, { x: x - 0.2, y: lineY - 0.2, w: 0.4, h: 0.4, fill: { color: t.accent }, line: { color: 'FFFFFF', pt: 2 } });
      // Connector tick
      s.addShape(prs.ShapeType.rect, { x: x - 0.02, y: above ? lineY - 0.6 : lineY + 0.2, w: 0.04, h: 0.4, fill: { color: t.accent }, line: { type: 'none' } });
      // Label card
      const cardW = Math.min(2.5, (lineX2 - lineX1) / items.length - 0.1);
      const cardY = above ? CY + 0.1 : lineY + 0.7;
      const cardH = above ? lineY - 0.6 - CY - 0.15 : BT - lineY - 0.75;
      s.addShape(prs.ShapeType.roundRect, {
        x: x - cardW / 2, y: cardY, w: cardW, h: cardH,
        fill: { color: idx % 2 ? t.accentLight : 'F8FAFC' }, line: { color: t.accentLight, pt: 1 },
      });
      s.addShape(prs.ShapeType.rect, { x: x - cardW / 2, y: cardY, w: cardW, h: 0.28, fill: { color: t.accent }, line: { type: 'none' } });
      s.addText(`${idx + 1}`, { x: x - cardW / 2, y: cardY, w: cardW, h: 0.28, fontSize: 11, bold: true, color: t.textLight, align: 'center', valign: 'middle' });
      s.addText(String(item), {
        x: x - cardW / 2 + 0.1, y: cardY + 0.33, w: cardW - 0.2, h: cardH - 0.42,
        fontSize: 12, bold: true, color: t.textDark, align: 'center', valign: 'top', wrap: true,
      });
    });
    if (content) {
      s.addText(content, { x: 0.5, y: BT - 0.4, w: MW - 1.0, h: 0.35, fontSize: 12, color: t.textMuted, align: 'center', wrap: true });
    }

  // ── process_steps ─────────────────────────────────────────────
  } else if (layout === 'process_steps') {
    const items = bullets.length > 0 ? bullets.slice(0, 5) : ['Discover', 'Plan', 'Build', 'Launch'];
    const n = items.length;
    const stepW = Math.min(2.4, (MW - 0.7) / n - 0.2);
    const totalW = n * stepW + (n - 1) * 0.3;
    const startX = (MW - totalW) / 2;
    const circleY = CY + 0.6;
    const circleR = 0.45;

    items.forEach((item, idx) => {
      const cx = startX + idx * (stepW + 0.3) + stepW / 2;
      // Connector line between steps
      if (idx > 0) {
        const prevCx = startX + (idx - 1) * (stepW + 0.3) + stepW / 2;
        s.addShape(prs.ShapeType.line, {
          x: prevCx + circleR, y: circleY + circleR,
          w: cx - prevCx - circleR * 2, h: 0,
          line: { color: t.accent, pt: 2 },
        });
        // Arrow head (simple)
        s.addText('▶', {
          x: cx - circleR - 0.28, y: circleY + circleR - 0.16,
          w: 0.3, h: 0.32, fontSize: 11, color: t.accent, align: 'center',
        });
      }
      // Step circle
      s.addShape(prs.ShapeType.ellipse, { x: cx - circleR, y: circleY, w: circleR * 2, h: circleR * 2, fill: { color: t.accent }, line: { type: 'none' } });
      s.addText(`${idx + 1}`, {
        x: cx - circleR, y: circleY, w: circleR * 2, h: circleR * 2,
        fontSize: 20, bold: true, color: t.textLight, align: 'center', valign: 'middle',
      });
      // Step card
      const cardY = circleY + circleR * 2 + 0.25;
      const cardH = BT - cardY - 0.1;
      s.addShape(prs.ShapeType.roundRect, {
        x: cx - stepW / 2, y: cardY, w: stepW, h: cardH,
        fill: { color: idx % 2 ? t.accentLight : 'F8FAFC' }, line: { color: t.accentLight, pt: 1 },
      });
      s.addText(String(item), {
        x: cx - stepW / 2 + 0.12, y: cardY + 0.1, w: stepW - 0.24, h: cardH - 0.2,
        fontSize: 13, bold: true, color: t.textDark, align: 'center', valign: 'top', wrap: true,
      });
    });
    if (content) {
      s.addText(content, { x: 0.5, y: CY + 0.05, w: MW - 1.0, h: 0.5, fontSize: 14, color: t.textMuted, align: 'center', wrap: true });
    }

  // ── comparison_split ──────────────────────────────────────────
  } else if (layout === 'comparison_split') {
    const half = bullets.length > 0 ? Math.ceil(bullets.length / 2) : 0;
    const leftItems = bullets.slice(0, half);
    const rightItems = bullets.slice(half);
    const midX = MW / 2;
    const panelH = BT - CY;
    // Left panel: dark
    s.addShape(prs.ShapeType.rect, { x: 0, y: CY, w: midX - 0.04, h: panelH, fill: { color: t.headerBg }, line: { type: 'none' } });
    // Right panel: accentLight
    s.addShape(prs.ShapeType.rect, { x: midX + 0.04, y: CY, w: MW - midX - 0.04, h: panelH, fill: { color: t.accentLight }, line: { type: 'none' } });
    // Center divider + VS badge
    s.addShape(prs.ShapeType.rect, { x: midX - 0.04, y: CY, w: 0.08, h: panelH, fill: { color: t.accent }, line: { type: 'none' } });
    s.addShape(prs.ShapeType.ellipse, { x: midX - 0.38, y: (CY + BT) / 2 - 0.38, w: 0.76, h: 0.76, fill: { color: t.accent }, line: { color: 'FFFFFF', pt: 2 } });
    s.addText('VS', { x: midX - 0.38, y: (CY + BT) / 2 - 0.38, w: 0.76, h: 0.76, fontSize: 13, bold: true, color: t.textLight, align: 'center', valign: 'middle' });
    // Left column header
    s.addText(String(slide.leftTitle || 'Option A'), { x: 0.3, y: CY + 0.12, w: midX - 0.5, h: 0.4, fontSize: 16, bold: true, color: t.accent });
    s.addShape(prs.ShapeType.rect, { x: 0.3, y: CY + 0.55, w: midX - 0.5, h: 0.05, fill: { color: t.accent }, line: { type: 'none' } });
    addBulletsLight(s, leftItems, { x: 0.3, y: CY + 0.7, w: midX - 0.5, h: panelH - 0.8 }, t, 14);
    if (leftItems.length === 0 && content) {
      s.addText(content, { x: 0.3, y: CY + 0.7, w: midX - 0.5, h: panelH - 0.8, fontSize: 14, color: t.textLight, valign: 'top', wrap: true });
    }
    // Right column header
    s.addText(String(slide.rightTitle || 'Option B'), { x: midX + 0.22, y: CY + 0.12, w: MW - midX - 0.35, h: 0.4, fontSize: 16, bold: true, color: t.textDark });
    s.addShape(prs.ShapeType.rect, { x: midX + 0.22, y: CY + 0.55, w: MW - midX - 0.35, h: 0.05, fill: { color: t.textMuted }, line: { type: 'none' } });
    addBullets(s, rightItems, { x: midX + 0.22, y: CY + 0.7, w: MW - midX - 0.35, h: panelH - 0.8 }, t, 14);

  // ── swot_grid ─────────────────────────────────────────────────
  } else if (layout === 'swot_grid') {
    const labels = ['Strengths', 'Weaknesses', 'Opportunities', 'Threats'];
    const icons  = ['S', 'W', 'O', 'T'];
    const qW = (MW - 0.7) / 2;
    const qH = (BT - CY - 0.2) / 2;
    for (let c = 0; c < 2; c++) {
      for (let r = 0; r < 2; r++) {
        const idx = r * 2 + c;
        const x = 0.35 + c * (qW + 0.05);
        const y = CY + 0.05 + r * (qH + 0.1);
        const isPositive = idx === 0 || idx === 2;
        s.addShape(prs.ShapeType.roundRect, { x, y, w: qW, h: qH, fill: { color: isPositive ? t.accentLight : 'F8FAFC' }, line: { color: t.accentLight, pt: 1 } });
        // Left accent bar
        s.addShape(prs.ShapeType.rect, { x, y, w: 0.2, h: qH, fill: { color: isPositive ? t.accent : t.textMuted }, line: { type: 'none' } });
        // Icon circle
        s.addShape(prs.ShapeType.ellipse, { x: x + 0.32, y: y + 0.12, w: 0.42, h: 0.42, fill: { color: isPositive ? t.accent : t.textMuted }, line: { type: 'none' } });
        s.addText(icons[idx], { x: x + 0.32, y: y + 0.12, w: 0.42, h: 0.42, fontSize: 14, bold: true, color: t.textLight, align: 'center', valign: 'middle' });
        s.addText(labels[idx], { x: x + 0.82, y: y + 0.14, w: qW - 1.0, h: 0.35, fontSize: 14, bold: true, color: isPositive ? t.accent : t.textMuted });
        s.addText(String(bullets[idx] || content || 'Add key points.'), {
          x: x + 0.32, y: y + 0.6, w: qW - 0.48, h: qH - 0.72,
          fontSize: 12, color: t.textDark, valign: 'top', wrap: true,
        });
      }
    }

  // ── kpi_dashboard ─────────────────────────────────────────────
  } else if (layout === 'kpi_dashboard') {
    const items = bullets.length > 0 ? bullets.slice(0, 6) : ['Revenue: $12.3M', 'Gross Margin: 61%', 'CAC: $142', 'LTV: $1,980', 'NPS: 52', 'On-time: 94%'];
    const cols = 3;
    const rows = Math.ceil(items.length / cols);
    const tileW = (MW - 0.7) / cols - 0.15;
    const tileH = (BT - CY - 0.2) / rows - 0.15;
    for (let idx = 0; idx < items.length; idx++) {
      const c = idx % cols;
      const r = Math.floor(idx / cols);
      const x = 0.35 + c * (tileW + 0.15);
      const y = CY + 0.05 + r * (tileH + 0.15);
      const raw = String(items[idx]);
      const colonIdx = raw.indexOf(':');
      const kpiValue = colonIdx !== -1 ? raw.slice(colonIdx + 1).trim() : raw;
      const kpiLabel = colonIdx !== -1 ? raw.slice(0, colonIdx).trim() : `KPI ${idx + 1}`;
      // Tile background
      s.addShape(prs.ShapeType.roundRect, { x, y, w: tileW, h: tileH, fill: { color: 'FFFFFF' }, line: { color: t.accentLight, pt: 1 } });
      // Accent top bar on tile
      s.addShape(prs.ShapeType.rect, { x, y, w: tileW, h: 0.32, fill: { color: t.headerBg }, line: { type: 'none' } });
      s.addText(kpiLabel, { x: x + 0.12, y: y + 0.04, w: tileW - 0.24, h: 0.24, fontSize: 11, bold: true, color: t.accent, valign: 'middle' });
      // Big value
      s.addText(kpiValue, {
        x: x + 0.08, y: y + 0.38, w: tileW - 0.16, h: tileH - 0.5,
        fontSize: 26, bold: true, color: t.textDark, align: 'center', valign: 'middle', wrap: true,
      });
    }
    if (content) {
      s.addText(content, { x: 0.5, y: BT - 0.38, w: MW - 1.0, h: 0.3, fontSize: 10, color: t.textMuted, align: 'center', italic: true });
    }

  // ── checklist ─────────────────────────────────────────────────
  } else if (layout === 'checklist') {
    const items = bullets.length > 0 ? bullets : ['Item 1', 'Item 2', 'Item 3'];
    const visible = items.slice(0, 10);
    const rowH = 0.5;
    const rowGap = 0.06;
    visible.forEach((item, idx) => {
      const y = CY + 0.05 + idx * (rowH + rowGap);
      s.addShape(prs.ShapeType.roundRect, {
        x: 0.35, y, w: MW - 0.7, h: rowH,
        fill: { color: idx % 2 ? 'FFFFFF' : t.accentLight }, line: { color: t.accentLight, pt: 0.5 },
      });
      // Checkbox: filled accent square
      s.addShape(prs.ShapeType.roundRect, { x: 0.5, y: y + 0.09, w: 0.32, h: 0.32, fill: { color: t.accent }, line: { type: 'none' } });
      s.addText('✓', { x: 0.5, y: y + 0.09, w: 0.32, h: 0.32, fontSize: 13, bold: true, color: t.textLight, align: 'center', valign: 'middle' });
      s.addText(String(item), {
        x: 0.94, y: y + 0.1, w: MW - 1.4, h: rowH - 0.18,
        fontSize: 13, color: t.textDark, valign: 'middle',
      });
    });
    // Progress bar
    const done = visible.length;
    const total2 = items.length;
    const barY = BT - 0.45;
    s.addText(`${done} of ${total2} items`, { x: 0.35, y: barY, w: 3.0, h: 0.28, fontSize: 11, color: t.textMuted });
    s.addShape(prs.ShapeType.roundRect, { x: 0.35, y: barY + 0.3, w: MW - 0.7, h: 0.1, fill: { color: t.accentLight }, line: { type: 'none' } });
    s.addShape(prs.ShapeType.roundRect, { x: 0.35, y: barY + 0.3, w: (MW - 0.7) * (done / Math.max(1, total2)), h: 0.1, fill: { color: t.accent }, line: { type: 'none' } });

  // ── statistics_strip ──────────────────────────────────────────
  } else if (layout === 'statistics_strip') {
    const items = bullets.length > 0 ? bullets.slice(0, 4) : ['32%', '18.4k', '$2.9M', '94%'];
    const statW = (MW - 0.7) / 4 - 0.15;
    for (let idx = 0; idx < 4; idx++) {
      const x = 0.35 + idx * (statW + 0.15);
      const raw = String(items[idx] || '-');
      const colonIdx = raw.indexOf(':');
      const statValue = colonIdx !== -1 ? raw.slice(colonIdx + 1).trim() : raw;
      const statLabel = colonIdx !== -1 ? raw.slice(0, colonIdx).trim() : `Metric ${idx + 1}`;
      const statH = BT - CY - 0.05;
      // Card: dark background for high contrast
      s.addShape(prs.ShapeType.roundRect, { x, y: CY + 0.05, w: statW, h: statH, fill: { color: t.headerBg }, line: { type: 'none' } });
      // Accent top bar on card
      s.addShape(prs.ShapeType.rect, { x, y: CY + 0.05, w: statW, h: 0.3, fill: { color: t.accent }, line: { type: 'none' } });
      // Big value
      s.addText(statValue, {
        x: x + 0.12, y: CY + 0.5, w: statW - 0.24, h: 2.2,
        fontSize: 40, bold: true, color: t.textLight, align: 'center', valign: 'middle', wrap: true,
      });
      // Label
      s.addText(statLabel, {
        x: x + 0.12, y: CY + 2.8, w: statW - 0.24, h: 0.55,
        fontSize: 13, color: t.accent, align: 'center', valign: 'middle', wrap: true,
      });
    }
    if (content) {
      s.addText(content, { x: 0.5, y: BT - 0.4, w: MW - 1.0, h: 0.35, fontSize: 13, color: t.textMuted, align: 'center', wrap: true });
    }

  // ── faq ───────────────────────────────────────────────────────
  } else if (layout === 'faq') {
    const items = bullets.length > 0 ? bullets.slice(0, 5) : ['Question 1 — Answer', 'Question 2 — Answer', 'Question 3 — Answer'];
    const rowH = (BT - CY - 0.1) / items.length - 0.06;
    items.forEach((item, idx) => {
      const y = CY + 0.05 + idx * (rowH + 0.06);
      s.addShape(prs.ShapeType.roundRect, {
        x: 0.35, y, w: MW - 0.7, h: rowH,
        fill: { color: idx % 2 ? 'F8FAFC' : 'FFFFFF' }, line: { color: t.accentLight, pt: 0.8 },
      });
      // Left accent strip per row
      s.addShape(prs.ShapeType.rect, { x: 0.35, y, w: 0.2, h: rowH, fill: { color: t.accent }, line: { type: 'none' } });
      // Q badge
      s.addShape(prs.ShapeType.roundRect, { x: 0.65, y: y + rowH / 2 - 0.18, w: 0.36, h: 0.36, fill: { color: t.accentLight }, line: { type: 'none' } });
      s.addText(`Q${idx + 1}`, { x: 0.65, y: y + rowH / 2 - 0.18, w: 0.36, h: 0.36, fontSize: 11, bold: true, color: t.accent, align: 'center', valign: 'middle' });
      s.addText(String(item), {
        x: 1.14, y: y + 0.08, w: MW - 1.6, h: rowH - 0.16,
        fontSize: 13, color: t.textDark, valign: 'middle', wrap: true,
      });
    });

  // ── table_like ────────────────────────────────────────────────
  } else if (layout === 'table_like') {
    const rows = bullets.length > 0 ? bullets.slice(0, 9) : ['Row 1 | Value A', 'Row 2 | Value B', 'Row 3 | Value C'];
    // Table header row
    s.addShape(prs.ShapeType.rect, { x: 0.35, y: CY + 0.05, w: MW - 0.7, h: 0.46, fill: { color: t.headerBg }, line: { type: 'none' } });
    s.addShape(prs.ShapeType.rect, { x: 0.35, y: CY + 0.05, w: 0.2, h: 0.46, fill: { color: t.accent }, line: { type: 'none' } });
    s.addText('CATEGORY', { x: 0.7, y: CY + 0.08, w: 6.5, h: 0.38, fontSize: 12, bold: true, color: t.textLight, valign: 'middle', charSpacing: 1.2 });
    s.addText('VALUE', { x: 7.3, y: CY + 0.08, w: 5.5, h: 0.38, fontSize: 12, bold: true, color: t.accent, valign: 'middle', charSpacing: 1.2 });
    // Column divider
    s.addShape(prs.ShapeType.rect, { x: 7.2, y: CY + 0.05, w: 0.05, h: 0.46, fill: { color: t.accent }, line: { type: 'none' } });
    // Body rows
    const availH = BT - (CY + 0.55);
    const rowH2 = availH / Math.min(9, rows.length);
    rows.forEach((row, idx) => {
      const y = CY + 0.55 + idx * rowH2;
      s.addShape(prs.ShapeType.rect, {
        x: 0.35, y, w: MW - 0.7, h: rowH2 - 0.03,
        fill: { color: idx % 2 ? t.accentLight : 'FFFFFF' }, line: { type: 'none' },
      });
      s.addShape(prs.ShapeType.rect, { x: 7.2, y, w: 0.03, h: rowH2 - 0.03, fill: { color: t.accentLight }, line: { type: 'none' } });
      const parts = String(row).split('|');
      const cat = (parts[0] || row).trim();
      const val = (parts[1] || '').trim();
      s.addText(cat, { x: 0.7, y: y + 0.04, w: 6.35, h: rowH2 - 0.1, fontSize: 12, color: t.textDark, valign: 'middle', wrap: true });
      s.addText(val, { x: 7.3, y: y + 0.04, w: 5.6, h: rowH2 - 0.1, fontSize: 12, color: t.textDark, valign: 'middle', align: 'right', wrap: true });
    });

  // ── agenda ────────────────────────────────────────────────────
  } else if (layout === 'agenda') {
    const items = bullets.length > 0 ? bullets.slice(0, 7) : ['Introduction', 'Key Points', 'Discussion', 'Q&A', 'Next Steps'];
    const gap = 0.09;
    const availH = BT - CY - 0.1;
    const rowH = Math.min(0.74, (availH - gap * (items.length - 1)) / items.length);
    items.forEach((item, idx) => {
      const y = CY + 0.05 + idx * (rowH + gap);
      // Row background
      s.addShape(prs.ShapeType.roundRect, {
        x: 1.05, y, w: MW - 1.45, h: rowH,
        fill: { color: idx % 2 ? t.accentLight : 'F8FAFC' }, line: { color: t.accentLight, pt: 0.6 },
      });
      // Left accent bar on row
      s.addShape(prs.ShapeType.rect, { x: 1.05, y, w: 0.18, h: rowH, fill: { color: idx === 0 ? t.accent : t.textMuted }, line: { type: 'none' } });
      // Number circle badge
      s.addShape(prs.ShapeType.ellipse, {
        x: 0.35, y: y + (rowH - 0.6) / 2, w: 0.6, h: 0.6,
        fill: { color: idx === 0 ? t.accent : t.headerBg }, line: { type: 'none' },
      });
      s.addText(String(idx + 1).padStart(2, '0'), {
        x: 0.35, y: y + (rowH - 0.6) / 2, w: 0.6, h: 0.6,
        fontSize: 13, bold: true, color: t.textLight, align: 'center', valign: 'middle',
      });
      // Item text
      s.addText(String(item), {
        x: 1.32, y: y + 0.06, w: MW - 1.78, h: rowH - 0.12,
        fontSize: 14, bold: idx === 0, color: t.textDark, valign: 'middle', wrap: true,
      });
      // Right dot indicator
      s.addShape(prs.ShapeType.ellipse, {
        x: MW - 0.54, y: y + (rowH - 0.26) / 2, w: 0.26, h: 0.26,
        fill: { color: idx === 0 ? t.accent : t.accentLight }, line: { type: 'none' },
      });
    });

  // ── title_bullets fallback ────────────────────────────────────
  } else {
    s.addShape(prs.ShapeType.rect, { x: 0.38, y: CY, w: 0.06, h: BT - CY, fill: { color: t.accentLight }, line: { type: 'none' } });
    addBullets(s, bullets, { x: 0.6, y: CY, w: 12.3, h: BT - CY }, t, 18);
    if (bullets.length === 0 && content) {
      s.addText(content, { x: 0.6, y: CY, w: 12.3, h: BT - CY, fontSize: 18, color: t.textDark, valign: 'top', wrap: true });
    }
  }

  addBottomBar(prs, s, slide, t);
};

// ── Title slide ───────────────────────────────────────────────

const buildTitleSlide = (prs, slide, title, options, theme, slideCount) => {
  const t = theme;
  slide.background = { color: t.headerBg };

  // Decorative geometry: large ellipses top-right
  slide.addShape(prs.ShapeType.ellipse, { x: 9.8, y: -2.0, w: 7.0, h: 7.0, fill: { color: t.accent, transparency: 85 }, line: { type: 'none' } });
  slide.addShape(prs.ShapeType.ellipse, { x: 11.2, y: -0.5, w: 4.5, h: 4.5, fill: { color: t.accent, transparency: 75 }, line: { type: 'none' } });
  slide.addShape(prs.ShapeType.ellipse, { x: -1.8, y: 5.5, w: 4.5, h: 4.5, fill: { color: t.accent, transparency: 85 }, line: { type: 'none' } });

  // Left accent vertical bar
  slide.addShape(prs.ShapeType.rect, { x: 0, y: 0, w: 0.32, h: MH, fill: { color: t.accent }, line: { type: 'none' } });
  // Top accent bar (thin)
  slide.addShape(prs.ShapeType.rect, { x: 0.32, y: 0, w: MW, h: 0.08, fill: { color: t.accent }, line: { type: 'none' } });
  // Bottom accent band
  slide.addShape(prs.ShapeType.rect, { x: 0, y: 6.85, w: MW, h: 0.65, fill: { color: t.accent }, line: { type: 'none' } });

  // Main title
  slide.addText(title, {
    x: 0.65, y: 1.6, w: 10.8, h: 2.8,
    fontSize: 44, bold: true, color: t.textLight,
    align: 'left', valign: 'top', wrap: true,
  });

  // Accent rule under title
  if (options.subtitle) {
    slide.addShape(prs.ShapeType.rect, { x: 0.65, y: 4.55, w: 4.0, h: 0.07, fill: { color: t.accent }, line: { type: 'none' } });
    slide.addText(options.subtitle, {
      x: 0.65, y: 4.72, w: 11.2, h: 0.85,
      fontSize: 20, color: 'CBD5E0', italic: true, align: 'left', wrap: true,
    });
  }

  // Slide count in bottom band
  slide.addText(`${slideCount} slide${slideCount !== 1 ? 's' : ''}`, {
    x: 0.65, y: 6.92, w: 11.5, h: 0.5,
    fontSize: 13, color: t.textLight, align: 'left', valign: 'middle',
  });
};

// ── Main export ───────────────────────────────────────────────

const generatePPT = async (title, slides, userId, topicId, options = {}) => {
  console.log(`[PPTGen] Generating PPT: "${title}" with ${slides.length} slides`);
  const themeKey = String(options.theme || options.style || 'modern_corporate').toLowerCase();
  const theme = THEMES[themeKey] || THEMES.modern_corporate;

  const prs = new pptxgen();
  prs.layout = 'LAYOUT_WIDE';

  buildTitleSlide(prs, prs.addSlide(), title, options, theme, slides.length);

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
