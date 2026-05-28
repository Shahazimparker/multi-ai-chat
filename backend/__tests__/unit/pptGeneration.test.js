// vitest globals: describe, it, expect
// Tests for pptGeneration.service.js

const { generatePPT } = require('../../services/pptGeneration.service');

const TEST_USER_ID = '023fec25-c86b-4b51-9d93-36f661ae5a67';

describe('generatePPT', () => {
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

    const result = await generatePPT('Special Chars Test', slides, TEST_USER_ID, null);
    expect(result).toHaveProperty('file_id');
    expect(result.file_name).not.toMatch(/[@#$%^&*()]/);
  }, 15000);
});
