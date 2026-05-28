// vitest globals: describe, it, expect

const {
  findSearchFileMatch,
  findGetFileMatch,
  findWebSearchMatch,
  findExecuteCodeMatch,
  findGetSchemaMatch,
  findQueryDbMatch,
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
  hasBareCloseTag,
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

describe('findExecuteCodeMatch', () => {
  it('matches [EXECUTE_CODE]...[/EXECUTE_CODE]', () => {
    const m = findExecuteCodeMatch('[EXECUTE_CODE]console.log("hello")[/EXECUTE_CODE]');
    expect(m).not.toBeNull();
    expect(m[1]).toBe('console.log("hello")');
  });

  it('matches multiline code', () => {
    const m = findExecuteCodeMatch('[EXECUTE_CODE]const x = 1;\nconsole.log(x);[/EXECUTE_CODE]');
    expect(m).not.toBeNull();
    expect(m[1]).toContain('const x = 1;');
  });

  it('returns null for non-matching text', () => {
    expect(findExecuteCodeMatch('no code here')).toBeNull();
  });
});

describe('findGetSchemaMatch', () => {
  it('matches [GET_SCHEMA:table1,table2]', () => {
    const m = findGetSchemaMatch('[GET_SCHEMA:users,orders]');
    expect(m).not.toBeNull();
    expect(m[1]).toBe('users,orders');
  });

  it('matches <GET_SCHEMA:table_name>', () => {
    const m = findGetSchemaMatch('<GET_SCHEMA:invoices>');
    expect(m).not.toBeNull();
    expect(m[1]).toBe('invoices');
  });

  it('matches <GET_SCHEMA>table</GET_SCHEMA>', () => {
    const m = findGetSchemaMatch('<GET_SCHEMA>products</GET_SCHEMA>');
    expect(m).not.toBeNull();
    expect(m[1]).toBe('products');
  });

  it('matches <DB_SCHEMA_REQUEST>table</DB_SCHEMA_REQUEST>', () => {
    const m = findGetSchemaMatch('<DB_SCHEMA_REQUEST>users</DB_SCHEMA_REQUEST>');
    expect(m).not.toBeNull();
    expect(m[1]).toBe('users');
  });

  it('matches [DB_SCHEMA_REQUEST:table]', () => {
    const m = findGetSchemaMatch('[DB_SCHEMA_REQUEST:orders]');
    expect(m).not.toBeNull();
    expect(m[1]).toBe('orders');
  });

  it('matches XML request format', () => {
    const m = findGetSchemaMatch('<request><method>Get_Schema</method><params><table>products</table></params></request>');
    expect(m).not.toBeNull();
    expect(m[1]).toBe('products');
  });

  it('matches <request_label> format', () => {
    const m = findGetSchemaMatch('<request_label>Get Schema</request_label><request_text>invoices</request_text>');
    expect(m).not.toBeNull();
    expect(m[1]).toBe('invoices');
  });

  it('matches JSON tables array in request', () => {
    const m = findGetSchemaMatch('<request>{"tables":["users","orders"]}</request>');
    expect(m).not.toBeNull();
    expect(m[1]).toBe('users, orders');
  });

  it('returns null for non-matching text', () => {
    expect(findGetSchemaMatch('no schema request here')).toBeNull();
  });
});

describe('findQueryDbMatch', () => {
  it('matches [QUERY_DB]...[/QUERY_DB]', () => {
    const m = findQueryDbMatch('[QUERY_DB]SELECT * FROM users[/QUERY_DB]');
    expect(m).not.toBeNull();
    expect(m[1].trim()).toBe('SELECT * FROM users');
  });

  it('matches [QUERY_DB]<SQL_QUERY>... variant', () => {
    const m = findQueryDbMatch('[QUERY_DB]<SQL_QUERY>SELECT 1</SQL_QUERY>[/QUERY_DB]');
    expect(m).not.toBeNull();
    expect(m[1].trim()).toBe('SELECT 1');
  });

  it('matches <QUERY_DB>...<SQL_QUERY>... variant', () => {
    const m = findQueryDbMatch('<QUERY_DB><SQL_QUERY>SELECT name FROM users</SQL_QUERY>[/QUERY_DB]');
    expect(m).not.toBeNull();
    expect(m[1].trim()).toBe('SELECT name FROM users');
  });

  it('matches <QUERY_DB>... plain variant', () => {
    const m = findQueryDbMatch('<QUERY_DB>SELECT COUNT(*) FROM orders</QUERY_DB>');
    expect(m).not.toBeNull();
    expect(m[1].trim()).toBe('SELECT COUNT(*) FROM orders');
  });

  it('matches <query>...</query> variant', () => {
    const m = findQueryDbMatch('<query>SELECT * FROM invoices</query>');
    expect(m).not.toBeNull();
    expect(m[1].trim()).toBe('SELECT * FROM invoices');
  });

  it('matches <Function id="query_db_..."> variant', () => {
    const m = findQueryDbMatch('<Function id="query_db_1">SELECT 1</Function>');
    expect(m).not.toBeNull();
    expect(m[1].trim()).toBe('SELECT 1');
  });

  it('returns null for non-matching text', () => {
    expect(findQueryDbMatch('no query here')).toBeNull();
  });
});

describe('hasBareCloseTag', () => {
  it('detects orphan [/QUERY_DB] without opening', () => {
    expect(hasBareCloseTag('[/QUERY_DB]')).toBe(true);
  });

  it('detects orphan </query> without opening', () => {
    expect(hasBareCloseTag('</query>')).toBe(true);
  });

  it('detects orphan </Function> without opening', () => {
    expect(hasBareCloseTag('</Function>')).toBe(true);
  });

  it('returns false when opening tag is present', () => {
    expect(hasBareCloseTag('[QUERY_DB]SELECT 1[/QUERY_DB]')).toBe(false);
  });

  it('returns false for normal text', () => {
    expect(hasBareCloseTag('normal response text')).toBe(false);
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
