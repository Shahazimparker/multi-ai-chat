// vitest globals: describe, it, expect, vi, beforeEach
// NOTE: supabase is mocked globally in setup.js
// These tests verify processToolCall logic paths

const { processToolCall } = require('../../services/toolProcessor.service');
const { approvalManager } = require('../../services/approvalManager.shared');

// Auto-approves any approval_request event so GENERATE_* tests don't wait for human input.
// Uses the real approvalManager — not a mock — matching production behavior.
const autoApprove = (event) => {
  if (event?.type === 'approval_request' && event.approvalId) {
    approvalManager.getHandler('default')
      .approve(event.approvalId, null, 'test-runner', '')
      .catch(() => {});
  }
};

describe('processToolCall', () => {
  const baseArgs = {
    reply: '',
    aiMessages: [],
    user: null,
    topicId: null,
    abortController: new AbortController(),
  };

  describe('no tool match', () => {
    it('returns handled: false for normal text', async () => {
      const result = await processToolCall({
        ...baseArgs,
        reply: 'This is a normal response with no tool calls.',
      });

      expect(result.handled).toBe(false);
    });
  });

  describe('tool tag matching', () => {
    it('matches SEARCH_FILES tag pattern', async () => {
      const result = await processToolCall({
        ...baseArgs,
        reply: '[SEARCH_FILES:query=test query]',
      });
      expect(result.handled).toBe(true);
    });

    it('matches GET_FILE tag pattern', async () => {
      const result = await processToolCall({
        ...baseArgs,
        reply: '[GET_FILE:id=test-id]',
      });
      expect(result.handled).toBe(true);
    });

    it('matches WEB_SEARCH tag pattern', async () => {
      const result = await processToolCall({
        ...baseArgs,
        reply: '[WEB_SEARCH:query="test"]',
      });
      expect(result.handled).toBe(true);
    });

    it('does not handle EXECUTE_CODE — the tool was removed', async () => {
      const result = await processToolCall({
        ...baseArgs,
        reply: '[EXECUTE_CODE]1+1[/EXECUTE_CODE]',
      });
      expect(result.handled).toBe(false);
    });
  });

  // Image generation test skipped to avoid Recraft/FLUX/DALL-E API costs
  // Run manually if needed with: npx vitest run --tag=api-costly

  describe('GENERATE_PPT handler', () => {
    // ── text-tag path ────────────────────────────────────────

    it('generates PPT via text tag and returns generatedMedia', async () => {
      const pptJson = JSON.stringify({
        title: 'Test Presentation',
        slides: [{ title: 'Slide 1', bullets: ['Point A', 'Point B'] }],
      });
      const result = await processToolCall({
        ...baseArgs,
        user: { id: '023fec25-c86b-4b51-9d93-36f661ae5a67' },
        onStatus: autoApprove,
        reply: `[GENERATE_PPT]${pptJson}[/GENERATE_PPT]`,
      });
      expect(result.handled).toBe(true);
      expect(result.generatedMedia).toBeDefined();
      expect(result.generatedMedia.length).toBeGreaterThan(0);
      expect(result.generatedMedia[0]).toHaveProperty('file_id');
      expect(result.generatedMedia[0]).toHaveProperty('file_name');
      expect(result.generatedMedia[0].file_type).toBe('pptx');
    }, 15000);

    it('text tag: handles invalid JSON', async () => {
      const result = await processToolCall({
        ...baseArgs,
        reply: '[GENERATE_PPT]not valid json[/GENERATE_PPT]',
      });
      expect(result.handled).toBe(true);
      expect(result.newMessages[1].content).toContain('Failed to generate presentation');
    });

    it('text tag: handles empty slides array', async () => {
      const result = await processToolCall({
        ...baseArgs,
        onStatus: autoApprove,
        reply: '[GENERATE_PPT]{"title":"Empty","slides":[]}[/GENERATE_PPT]',
      });
      expect(result.handled).toBe(true);
      expect(result.newMessages[1].content).toContain('Failed to generate presentation');
      expect(result.newMessages[1].content).toContain('No slides provided');
    });

    // ── function-call path ───────────────────────────────────

    it('function-call path: generates PPT and returns generatedMedia', async () => {
      const result = await processToolCall({
        ...baseArgs,
        user: { id: '023fec25-c86b-4b51-9d93-36f661ae5a67' },
        onStatus: autoApprove,
        reply: '',
        aiResponse: {
          toolCalls: [{
            type: 'function',
            function: {
              name: 'generate_ppt',
              arguments: JSON.stringify({
                title: 'Function Call PPT',
                theme: 'startup_bold',
                slides: [
                  { title: 'Intro', layout: 'title_bullets', bullets: ['Point A', 'Point B'] },
                  { title: 'Stats', layout: 'statistics_strip', bullets: ['Revenue: $12M', 'Users: 450k'] },
                ],
              }),
            },
          }],
        },
      });
      expect(result.handled).toBe(true);
      expect(result.generatedMedia.length).toBeGreaterThan(0);
      expect(result.generatedMedia[0]).toHaveProperty('file_id');
      expect(result.generatedMedia[0].file_type).toBe('pptx');
    }, 15000);

    it('function-call path: invalid JSON forwards actual parse error message', async () => {
      const result = await processToolCall({
        ...baseArgs,
        reply: '',
        aiResponse: {
          toolCalls: [{ type: 'function', function: { name: 'generate_ppt', arguments: '{bad json' } }],
        },
      });
      expect(result.handled).toBe(true);
      expect(result.newMessages[1].content).toContain('Failed to generate presentation');
      // Must NOT be the old hardcoded message — actual parse error must appear
      expect(result.newMessages[1].content).not.toContain('Invalid function-call arguments for generate_ppt');
    });

    it('function-call path: empty slides array includes "No slides provided" in error', async () => {
      const result = await processToolCall({
        ...baseArgs,
        onStatus: autoApprove,
        reply: '',
        aiResponse: {
          toolCalls: [{
            type: 'function',
            function: { name: 'generate_ppt', arguments: '{"title":"Empty","slides":[]}' },
          }],
        },
      });
      expect(result.handled).toBe(true);
      expect(result.newMessages[1].content).toContain('Failed to generate presentation');
      expect(result.newMessages[1].content).toContain('No slides provided');
    }, 15000);
  });

  describe('GENERATE_PDF handler', () => {
    it('generates PDF and returns generatedMedia', async () => {
      const pdfJson = JSON.stringify({ title: 'Test Report', sections: [{ heading: 'Intro', content: 'Test content.' }] });
      const result = await processToolCall({ ...baseArgs, user: { id: '023fec25-c86b-4b51-9d93-36f661ae5a67' }, onStatus: autoApprove, reply: `[GENERATE_PDF]${pdfJson}[/GENERATE_PDF]` });
      expect(result.handled).toBe(true);
      expect(result.generatedMedia.length).toBeGreaterThan(0);
      expect(result.generatedMedia[0].file_type).toBe('pdf');
    }, 15000);
  });

  describe('GENERATE_EXCEL handler', () => {
    it('generates Excel and returns generatedMedia', async () => {
      const xlJson = JSON.stringify({ title: 'Data', sheets: [{ name: 'Sheet1', headers: ['A', 'B'], rows: [['1', '2']] }] });
      const result = await processToolCall({ ...baseArgs, user: { id: '023fec25-c86b-4b51-9d93-36f661ae5a67' }, onStatus: autoApprove, reply: `[GENERATE_EXCEL]${xlJson}[/GENERATE_EXCEL]` });
      expect(result.handled).toBe(true);
      expect(result.generatedMedia.length).toBeGreaterThan(0);
      expect(result.generatedMedia[0].file_type).toBe('xlsx');
    }, 15000);
  });

  describe('GENERATE_DOCX handler', () => {
    it('generates DOCX and returns generatedMedia', async () => {
      const docxJson = JSON.stringify({ title: 'Test Doc', sections: [{ heading: 'Intro', content: 'Test content.' }] });
      const result = await processToolCall({ ...baseArgs, user: { id: '023fec25-c86b-4b51-9d93-36f661ae5a67' }, onStatus: autoApprove, reply: `[GENERATE_DOCX]${docxJson}[/GENERATE_DOCX]` });
      expect(result.handled).toBe(true);
      expect(result.generatedMedia.length).toBeGreaterThan(0);
      expect(result.generatedMedia[0].file_type).toBe('docx');
    }, 15000);
  });

  describe('GENERATE_CSV handler', () => {
    it('generates CSV and returns generatedMedia', async () => {
      const csvJson = JSON.stringify({ headers: ['Name', 'Age'], rows: [['John', '30'], ['Jane', '25']] });
      const result = await processToolCall({ ...baseArgs, user: { id: '023fec25-c86b-4b51-9d93-36f661ae5a67' }, onStatus: autoApprove, reply: `[GENERATE_CSV]${csvJson}[/GENERATE_CSV]` });
      expect(result.handled).toBe(true);
      expect(result.generatedMedia.length).toBeGreaterThan(0);
      expect(result.generatedMedia[0].file_type).toBe('csv');
    }, 15000);
  });

  describe('GENERATE_CHART handler', () => {
    it('generates Chart SVG and returns generatedMedia', async () => {
      const chartJson = JSON.stringify({ type: 'bar', title: 'Sales', labels: ['Q1', 'Q2'], data: [10, 20] });
      const result = await processToolCall({ ...baseArgs, user: { id: '023fec25-c86b-4b51-9d93-36f661ae5a67' }, onStatus: autoApprove, reply: `[GENERATE_CHART]${chartJson}[/GENERATE_CHART]` });
      expect(result.handled).toBe(true);
      expect(result.generatedMedia.length).toBeGreaterThan(0);
      expect(result.generatedMedia[0].file_type).toBe('svg');
    }, 15000);
  });

  describe('GENERATE_HTML handler', () => {
    it('generates HTML and returns generatedMedia', async () => {
      const htmlJson = JSON.stringify({ title: 'Test Page', body: '<h1>Hello</h1>' });
      const result = await processToolCall({ ...baseArgs, user: { id: '023fec25-c86b-4b51-9d93-36f661ae5a67' }, onStatus: autoApprove, reply: `[GENERATE_HTML]${htmlJson}[/GENERATE_HTML]` });
      expect(result.handled).toBe(true);
      expect(result.generatedMedia.length).toBeGreaterThan(0);
      expect(result.generatedMedia[0].file_type).toBe('html');
    }, 15000);
  });

  describe('GENERATE_JSON handler', () => {
    it('generates JSON file and returns generatedMedia', async () => {
      const jsonJson = JSON.stringify({ data: { key: 'value', list: [1, 2, 3] } });
      const result = await processToolCall({ ...baseArgs, user: { id: '023fec25-c86b-4b51-9d93-36f661ae5a67' }, onStatus: autoApprove, reply: `[GENERATE_JSON]${jsonJson}[/GENERATE_JSON]` });
      expect(result.handled).toBe(true);
      expect(result.generatedMedia.length).toBeGreaterThan(0);
      expect(result.generatedMedia[0].file_type).toBe('json');
    }, 15000);
  });

  describe('GENERATE_MD handler', () => {
    it('generates Markdown and returns generatedMedia', async () => {
      const mdJson = JSON.stringify({ title: 'Readme', content: '# Hello\n\nThis is a test.' });
      const result = await processToolCall({ ...baseArgs, user: { id: '023fec25-c86b-4b51-9d93-36f661ae5a67' }, onStatus: autoApprove, reply: `[GENERATE_MD]${mdJson}[/GENERATE_MD]` });
      expect(result.handled).toBe(true);
      expect(result.generatedMedia.length).toBeGreaterThan(0);
      expect(result.generatedMedia[0].file_type).toBe('md');
    }, 15000);
  });
});
