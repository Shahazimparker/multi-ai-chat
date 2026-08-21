// vitest globals: describe, it, expect
// Tests for pptGeneration.service.js — real pptxgenjs renderer, stubbed persistence.

// ── Stub the persistence layer ───────────────────────────────
//
// These tests assert on generation: layouts, themes, filename derivation, the
// shape of generatedMedia. The database write is incidental to all of it, and
// with real Supabase credentials loaded from .env it was a live INSERT on every
// run — 35 rows per suite into the production table.
//
// spyOn, not a vi.mock factory: these are CommonJS modules and a factory does
// NOT intercept the require — it fails open and leaves the real implementation
// in place, which is exactly how the live writes went unnoticed. The same
// footgun is documented in rag2.test.js and rerank.test.js.
//
// Order matters. The consumers destructure their import at require time
// (`const { saveGeneratedFile } = require('./fileUpload.service')`), capturing
// the reference. The spies must therefore be installed BEFORE the modules under
// test are required below.
const fileUploadService = require('../../services/fileUpload.service');

let savedSeq = 0;
const stubSaved = (fileName, fileType) => ({
  file_id: `test-file-${++savedSeq}`,
  file_name: fileName,
  file_type: fileType,
  created_at: new Date().toISOString(),
});

// Both stubs mirror the real contract, including returning null on the same
// missing-argument guards, so error paths stay reachable.
vi.spyOn(fileUploadService, 'saveGeneratedFile').mockImplementation(
  async (userId, topicId, fileName, content, fileType) =>
    (userId && fileName ? stubSaved(fileName, fileType) : null)
);
vi.spyOn(fileUploadService, 'saveGeneratedBinaryFile').mockImplementation(
  async (userId, topicId, fileName, textContent, fileType, binaryBuffer) =>
    (userId && fileName && binaryBuffer ? stubSaved(fileName, fileType) : null)
);

const { generatePPT } = require('../../services/pptGeneration.service');

const TEST_USER_ID = '023fec25-c86b-4b51-9d93-36f661ae5a67';

const ALL_LAYOUTS = [
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
];

const ALL_THEMES = [
  'modern_corporate',
  'startup_bold',
  'clean_minimal',
  'emerald_glass',
  'sunset_warm',
  'charcoal_lime',
  'sandstone_editorial',
  'ruby_noir',
  'violet_tech',
  'ocean_depth',
  'rose_creative',
  'mono_editorial',
];

// ─── Core generation ─────────────────────────────────────────

describe('generatePPT — core generation', () => {
  it('generates a PPTX and returns file metadata', async () => {
    const slides = [
      { title: 'Introduction', bullets: ['Welcome', 'Agenda'] },
      { title: 'Details', content: 'This is the detailed content section.' },
    ];
    const result = await generatePPT('Test Presentation', slides, TEST_USER_ID, null);
    expect(result).toHaveProperty('file_id');
    expect(result).toHaveProperty('file_name');
    expect(result.file_name).toMatch(/\.pptx$/);
    expect(result.file_type).toBe('pptx');
  }, 15000);

  it('generates a PPTX with subtitle option', async () => {
    const slides = [{ title: 'Only Slide', bullets: ['Point 1'] }];
    const result = await generatePPT('Subtitle Test', slides, TEST_USER_ID, null, {
      subtitle: 'A Subtitle Here',
    });
    expect(result).toHaveProperty('file_id');
    expect(result.file_name).toMatch(/\.pptx$/);
  }, 15000);

  it('handles special characters in title for safe filename', async () => {
    const slides = [{ title: 'Test', bullets: ['a'] }];
    const result = await generatePPT('Special: Chars & Test!', slides, TEST_USER_ID, null);
    expect(result).toHaveProperty('file_id');
    expect(result.file_name).not.toMatch(/[@#$%^&*():!]/);
    expect(result.file_name).toMatch(/\.pptx$/);
  }, 15000);

  it('non-latin title falls back to safe filename', async () => {
    const slides = [{ title: 'Content', bullets: ['Point'] }];
    const result = await generatePPT('日本語タイトル', slides, TEST_USER_ID, null);
    expect(result.file_name).toMatch(/presentation_\d+\.pptx$/);
  }, 15000);

  it('title longer than 40 chars is truncated in filename', async () => {
    const slides = [{ title: 'Slide', bullets: ['x'] }];
    const result = await generatePPT(
      'This Is A Very Long Presentation Title That Exceeds Forty Characters',
      slides,
      TEST_USER_ID,
      null,
    );
    const nameWithoutExt = result.file_name.replace(/_\d+\.pptx$/, '');
    expect(nameWithoutExt.length).toBeLessThanOrEqual(40);
  }, 15000);
});

// ─── All 15 layouts ──────────────────────────────────────────

describe('generatePPT — all 15 layout types render without throwing', () => {
  it('renders all layouts in a single presentation', async () => {
    const slides = ALL_LAYOUTS.map((layout) => ({
      title: `${layout} slide`,
      layout,
      bullets: ['Alpha', 'Beta', 'Gamma', 'Delta'],
      content: 'Supplementary narrative text for this slide.',
      subtitle: 'Optional subtitle',
      footerNote: 'Footer reference',
    }));
    const result = await generatePPT('All Layouts', slides, TEST_USER_ID, null);
    expect(result).toHaveProperty('file_id');
    expect(result.file_type).toBe('pptx');
  }, 20000);
});

// ─── Layout-specific bug fixes ────────────────────────────────

describe('generatePPT — layout bug fixes', () => {
  it('timeline with a single item centres the dot without dividing by zero', async () => {
    const slides = [{ title: 'Milestone', layout: 'timeline', bullets: ['Launch Day'] }];
    const result = await generatePPT('Single Item Timeline', slides, TEST_USER_ID, null);
    expect(result).toHaveProperty('file_id');
    expect(result.file_type).toBe('pptx');
  }, 15000);

  it('statistics_strip splits "Label: Value" on colon into separate label and value text', async () => {
    const slides = [
      {
        title: 'KPIs',
        layout: 'statistics_strip',
        bullets: ['Revenue: $12M', 'Users: 450k', 'NPS: 72', 'Uptime: 99.9%'],
      },
    ];
    const result = await generatePPT('Stats with Labels', slides, TEST_USER_ID, null);
    expect(result).toHaveProperty('file_id');
    expect(result.file_type).toBe('pptx');
  }, 15000);

  it('statistics_strip with unlabelled bullets falls back to "Metric N" labels', async () => {
    const slides = [
      { title: 'Stats', layout: 'statistics_strip', bullets: ['32%', '18.4k', '$2.9M', '94%'] },
    ];
    const result = await generatePPT('Stats No Labels', slides, TEST_USER_ID, null);
    expect(result).toHaveProperty('file_id');
    expect(result.file_type).toBe('pptx');
  }, 15000);

  it('faq with 6 bullets generates without footer overflow (capped at 5)', async () => {
    const slides = [
      {
        title: 'FAQ',
        layout: 'faq',
        bullets: ['Q1 - A1', 'Q2 - A2', 'Q3 - A3', 'Q4 - A4', 'Q5 - A5', 'Q6 - A6 (should be dropped)'],
      },
    ];
    const result = await generatePPT('FAQ Six Items', slides, TEST_USER_ID, null);
    expect(result).toHaveProperty('file_id');
    expect(result.file_type).toBe('pptx');
  }, 15000);

  it('comparison_split uses leftTitle and rightTitle for column headers', async () => {
    const slides = [
      {
        title: 'Before vs After',
        layout: 'comparison_split',
        leftTitle: 'Before Migration',
        rightTitle: 'After Migration',
        bullets: ['Legacy DB', 'Slow queries', 'High costs', 'New DB', 'Fast queries', 'Lower costs'],
      },
    ];
    const result = await generatePPT('Comparison Split', slides, TEST_USER_ID, null);
    expect(result).toHaveProperty('file_id');
    expect(result.file_type).toBe('pptx');
  }, 15000);
});

// ─── Theme handling ──────────────────────────────────────────

describe('generatePPT — themes', () => {
  it.each(ALL_THEMES)('generates a PPTX with theme "%s"', async (theme) => {
    const slides = [{ title: 'Themed Slide', bullets: ['Point A', 'Point B'] }];
    const result = await generatePPT(`Theme ${theme}`, slides, TEST_USER_ID, null, { theme });
    expect(result).toHaveProperty('file_id');
    expect(result.file_type).toBe('pptx');
  }, 15000);

  it('unknown theme falls back to modern_corporate without throwing', async () => {
    const slides = [{ title: 'Fallback Theme', bullets: ['X'] }];
    const result = await generatePPT('Unknown Theme', slides, TEST_USER_ID, null, {
      theme: 'nonexistent_theme',
    });
    expect(result).toHaveProperty('file_id');
    expect(result.file_type).toBe('pptx');
  }, 15000);
});

// ─── Unknown layout fallback ─────────────────────────────────

describe('generatePPT — unknown layout fallback', () => {
  it('unrecognised layout falls back to title_bullets without throwing', async () => {
    const slides = [{ title: 'Fallback', layout: 'not_a_real_layout', bullets: ['Bullet 1'] }];
    const result = await generatePPT('Unknown Layout', slides, TEST_USER_ID, null);
    expect(result).toHaveProperty('file_id');
    expect(result.file_type).toBe('pptx');
  }, 15000);
});
