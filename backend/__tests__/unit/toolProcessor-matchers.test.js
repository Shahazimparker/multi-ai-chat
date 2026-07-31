// vitest globals: describe, it, expect

const {
  findSearchFileMatch,
  findGetFileMatch,
  findWebSearchMatch,
  findGenerateImageMatch,
  findGeneratePPTMatch,
  findGeneratePDFMatch,
  findGenerateExcelMatch,
  findGenerateDocxMatch,
  findGenerateCSVMatch,
  findGenerateChartMatch,
  findGenerateHTMLMatch,
  findGenerateJSONMatch,
  findGenerateMDMatch,
} = require('../../services/toolProcessor.service');

describe('findSearchFileMatch', () => {
  it('matches [SEARCH_FILES:query=...]', () => {
    const m = findSearchFileMatch('[SEARCH_FILES:query=invoice report]');
    expect(m).not.toBeNull();
    expect(m[1]).toBe('invoice report');
  });

  it('returns null for non-matching text', () => {
    expect(findSearchFileMatch('hello world')).toBeNull();
  });
});

describe('findGetFileMatch', () => {
  it('matches [GET_FILE:id=...]', () => {
    const m = findGetFileMatch('[GET_FILE:id=abc-123-def]');
    expect(m).not.toBeNull();
    expect(m[1]).toBe('abc-123-def');
  });

  it('returns null for non-matching text', () => {
    expect(findGetFileMatch('no file here')).toBeNull();
  });
});

describe('findWebSearchMatch', () => {
  it('matches [WEB_SEARCH:query="..."] with quotes', () => {
    const m = findWebSearchMatch('[WEB_SEARCH:query="latest AI news"]');
    expect(m).not.toBeNull();
    expect(m[1]).toBe('latest AI news');
  });

  it('matches [WEB_SEARCH:query=\'...\'] with single quotes', () => {
    const m = findWebSearchMatch("[WEB_SEARCH:query='stock market today']");
    expect(m).not.toBeNull();
    expect(m[1]).toBe('stock market today');
  });

  it('matches [WEB_SEARCH:...] without quotes', () => {
    const m = findWebSearchMatch('[WEB_SEARCH:weather forecast]');
    expect(m).not.toBeNull();
  });

  it('returns null for non-matching text', () => {
    expect(findWebSearchMatch('no search here')).toBeNull();
  });
});

describe('removed EXECUTE_CODE tool', () => {
  it('no longer exposes an EXECUTE_CODE matcher', () => {
    // The code-execution tool was removed: it never ran (the worker crashed on
    // construction), and its worker_threads design was not a real sandbox.
    const toolProcessor = require('../../services/toolProcessor.service');
    expect(toolProcessor.findExecuteCodeMatch).toBeUndefined();
  });

  it('leaves an [EXECUTE_CODE] tag unhandled so it is stripped, not executed', async () => {
    const { processToolCall } = require('../../services/toolProcessor.service');
    const result = await processToolCall({
      reply: '[EXECUTE_CODE]console.log("hello")[/EXECUTE_CODE]',
      aiResponse: {},
      aiMessages: [],
      user: { id: 'user-1' },
      topicId: null,
      abortController: new AbortController(),
    });
    expect(result.handled).toBe(false);
  });
});

describe('findGenerateImageMatch', () => {
  it('matches [GENERATE_IMAGE:prompt=...]', () => {
    const m = findGenerateImageMatch('[GENERATE_IMAGE:prompt=a beautiful sunset over mountains]');
    expect(m).not.toBeNull();
    expect(m[1]).toBe('a beautiful sunset over mountains');
  });

  it('extracts prompt with special characters', () => {
    const m = findGenerateImageMatch('[GENERATE_IMAGE:prompt=cyberpunk city, neon lights, rain, 4k]');
    expect(m).not.toBeNull();
    expect(m[1]).toBe('cyberpunk city, neon lights, rain, 4k');
  });

  it('returns null for non-matching text', () => {
    expect(findGenerateImageMatch('hello world')).toBeNull();
  });

  it('does not match GENERATE_PPT tag', () => {
    expect(findGenerateImageMatch('[GENERATE_PPT]{"title":"test"}[/GENERATE_PPT]')).toBeNull();
  });
});

describe('findGeneratePPTMatch', () => {
  it('matches [GENERATE_PPT]...[/GENERATE_PPT] with JSON body', () => {
    const m = findGeneratePPTMatch('[GENERATE_PPT]{"title":"My Presentation","slides":[{"title":"Slide 1","bullets":["a","b"]}]}[/GENERATE_PPT]');
    expect(m).not.toBeNull();
    expect(m[1]).toContain('"title":"My Presentation"');
    expect(m[1]).toContain('"slides"');
  });

  it('matches minimal PPT tag', () => {
    const m = findGeneratePPTMatch('[GENERATE_PPT]{"title":"Test"}[/GENERATE_PPT]');
    expect(m).not.toBeNull();
    expect(m[1]).toBe('{"title":"Test"}');
  });

  it('returns null for non-matching text', () => {
    expect(findGeneratePPTMatch('hello world')).toBeNull();
  });

  it('does not match GENERATE_IMAGE tag', () => {
    expect(findGeneratePPTMatch('[GENERATE_IMAGE:prompt=test]')).toBeNull();
  });
});

describe('findGeneratePDFMatch', () => {
  it('matches [GENERATE_PDF]...[/GENERATE_PDF]', () => {
    const m = findGeneratePDFMatch('[GENERATE_PDF]{"title":"Report","sections":[{"heading":"Intro","content":"text"}]}[/GENERATE_PDF]');
    expect(m).not.toBeNull();
    expect(m[1]).toContain('"title":"Report"');
  });
  it('returns null for non-matching text', () => {
    expect(findGeneratePDFMatch('hello world')).toBeNull();
  });
});

describe('findGenerateExcelMatch', () => {
  it('matches [GENERATE_EXCEL]...[/GENERATE_EXCEL]', () => {
    const m = findGenerateExcelMatch('[GENERATE_EXCEL]{"title":"Data","sheets":[{"name":"S1","headers":["A"],"rows":[["1"]]}]}[/GENERATE_EXCEL]');
    expect(m).not.toBeNull();
    expect(m[1]).toContain('"title":"Data"');
  });
  it('returns null for non-matching text', () => {
    expect(findGenerateExcelMatch('hello world')).toBeNull();
  });
});

describe('findGenerateDocxMatch', () => {
  it('matches [GENERATE_DOCX]...[/GENERATE_DOCX]', () => {
    const m = findGenerateDocxMatch('[GENERATE_DOCX]{"title":"Doc","sections":[{"heading":"H1","content":"text"}]}[/GENERATE_DOCX]');
    expect(m).not.toBeNull();
    expect(m[1]).toContain('"title":"Doc"');
  });
  it('returns null for non-matching text', () => {
    expect(findGenerateDocxMatch('hello world')).toBeNull();
  });
});

describe('findGenerateCSVMatch', () => {
  it('matches [GENERATE_CSV]...[/GENERATE_CSV]', () => {
    const m = findGenerateCSVMatch('[GENERATE_CSV]{"headers":["Name","Age"],"rows":[["John","30"]]}[/GENERATE_CSV]');
    expect(m).not.toBeNull();
    expect(m[1]).toContain('"headers"');
  });
  it('returns null for non-matching text', () => {
    expect(findGenerateCSVMatch('hello world')).toBeNull();
  });
});

describe('findGenerateChartMatch', () => {
  it('matches [GENERATE_CHART]...[/GENERATE_CHART]', () => {
    const m = findGenerateChartMatch('[GENERATE_CHART]{"type":"bar","title":"Sales","labels":["Q1","Q2"],"data":[10,20]}[/GENERATE_CHART]');
    expect(m).not.toBeNull();
    expect(m[1]).toContain('"type":"bar"');
  });
  it('returns null for non-matching text', () => {
    expect(findGenerateChartMatch('hello world')).toBeNull();
  });
});

describe('findGenerateHTMLMatch', () => {
  it('matches [GENERATE_HTML]...[/GENERATE_HTML]', () => {
    const m = findGenerateHTMLMatch('[GENERATE_HTML]{"title":"Page","body":"<h1>Hi</h1>"}[/GENERATE_HTML]');
    expect(m).not.toBeNull();
    expect(m[1]).toContain('"title":"Page"');
  });
  it('returns null for non-matching text', () => {
    expect(findGenerateHTMLMatch('hello world')).toBeNull();
  });
});

describe('findGenerateJSONMatch', () => {
  it('matches [GENERATE_JSON]...[/GENERATE_JSON]', () => {
    const m = findGenerateJSONMatch('[GENERATE_JSON]{"data":{"key":"value"}}[/GENERATE_JSON]');
    expect(m).not.toBeNull();
    expect(m[1]).toContain('"key":"value"');
  });
  it('returns null for non-matching text', () => {
    expect(findGenerateJSONMatch('hello world')).toBeNull();
  });
});

describe('findGenerateMDMatch', () => {
  it('matches [GENERATE_MD]...[/GENERATE_MD]', () => {
    const m = findGenerateMDMatch('[GENERATE_MD]{"title":"Readme","content":"# Hello"}[/GENERATE_MD]');
    expect(m).not.toBeNull();
    expect(m[1]).toContain('"title":"Readme"');
  });
  it('returns null for non-matching text', () => {
    expect(findGenerateMDMatch('hello world')).toBeNull();
  });
});
