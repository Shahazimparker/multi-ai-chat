// ============================================================
// FILE: backend/__tests__/unit/fileTools.test.js
// PURPOSE: End-to-end wiring for the file investigation tools —
//          ANALYZE_TABLE (with filters), READ_ROWS and COMPARE_FILES.
//
//   The underlying functions are covered elsewhere. What these tests cover is
//   the wiring: that the model's bracket syntax is matched, that arguments are
//   parsed off it correctly, that the right file is loaded, and that a usable
//   result comes back rather than an exception.
//
//   The coordinate test matters most. These tools compose — one reports a line
//   number and the next reads it — so a line number that is off by even one
//   sends the model to the wrong row while looking entirely plausible.
// ============================================================

// toolProcessor holds fileUpload.service as a namespace, so spying on the
// service object replaces what it actually calls. vi.mock does not
// intercept this CommonJS module, which is why the namespace import exists.

const fileUploadService = require('../../services/fileUpload.service');
const {
  findAnalyzeTableMatch,
  findReadRowsMatch,
  findCompareFilesMatch,
  processToolCall,
} = require('../../services/toolProcessor.service');

const USER = { id: '33333333-3333-3333-3333-333333333333' };

const baseArgs = (overrides = {}) => ({
  reply: '',
  aiResponse: null,
  aiMessages: [],
  user: USER,
  topicId: 'topic-1',
  abortController: new AbortController(),
  collectionIds: [],
  embedProvider: 'openrouter',
  ...overrides,
});

/** A trace with a clear slow tail and a status column to filter on. */
const traceCsv = () => {
  const rows = ['Timestamp,Statement,Duration ms,Status'];
  for (let i = 0; i < 100; i++) {
    rows.push(`2026-08-01T10:00:00Z,SELECT a FROM t WHERE id = ${i},3,OK`);
  }
  for (let i = 0; i < 5; i++) {
    rows.push(`2026-08-01T11:00:0${i}Z,SELECT * FROM big WHERE x = ${i},${5000 + i},TIMEOUT`);
  }
  return rows.join('\n');
};

const mockFile = (content, fileName = 'trace.csv') => {
  vi.spyOn(fileUploadService, 'getFileContent').mockResolvedValue({
    id: 'file-1',
    file_name: fileName,
    original_content: content,
  });
};

const resultText = (res) => res.newMessages.find((m) => m.role === 'user').content;

beforeEach(() => {
  vi.restoreAllMocks();
});

describe('matchers', () => {
  it('recognises ANALYZE_TABLE with filters', () => {
    expect(findAnalyzeTableMatch('[ANALYZE_TABLE:file=abc value=3 group=2 where=4:TIMEOUT]')).not.toBeNull();
  });

  it('recognises READ_ROWS in both forms', () => {
    expect(findReadRowsMatch('[READ_ROWS:file=abc from=10 to=20]')).not.toBeNull();
    expect(findReadRowsMatch('[READ_ROWS:file=abc around=2026-08-01T10:06:39Z window=60]')).not.toBeNull();
  });

  it('recognises COMPARE_FILES', () => {
    expect(findCompareFilesMatch('[COMPARE_FILES:baseline=a current=b]')).not.toBeNull();
  });

  it('does not fire on ordinary prose', () => {
    expect(findAnalyzeTableMatch('I will analyse the table now.')).toBeNull();
    expect(findReadRowsMatch('Let me read some rows.')).toBeNull();
    expect(findCompareFilesMatch('I will compare the files.')).toBeNull();
  });
});

describe('ANALYZE_TABLE wiring', () => {
  it('computes over every row and reports exact figures', async () => {
    mockFile(traceCsv());
    const res = await processToolCall(baseArgs({
      reply: '[ANALYZE_TABLE:file=file-1 value=3 group=2]',
    }));

    expect(res.handled).toBe(true);
    const text = resultText(res);
    expect(text).toContain('ANALYZE_TABLE RESULT');
    expect(text).toContain('n=105');
    expect(text).toContain('max=5,004');
  });

  it('applies a where filter and reports how many rows matched', async () => {
    mockFile(traceCsv());
    const res = await processToolCall(baseArgs({
      reply: '[ANALYZE_TABLE:file=file-1 value=3 group=2 where=4:TIMEOUT]',
    }));

    const text = resultText(res);
    expect(text).toContain('5 of 105 rows match');
    expect(text).toContain('n=5');
  });

  it('applies a numeric min filter', async () => {
    mockFile(traceCsv());
    const res = await processToolCall(baseArgs({
      reply: '[ANALYZE_TABLE:file=file-1 value=3 min=1000]',
    }));

    expect(resultText(res)).toContain('5 of 105 rows match');
  });

  it('says plainly when a filter matches nothing', async () => {
    mockFile(traceCsv());
    const res = await processToolCall(baseArgs({
      reply: '[ANALYZE_TABLE:file=file-1 value=3 where=4:NOSUCHSTATUS]',
    }));

    expect(resultText(res)).toContain('No rows matched');
  });

  it('reports a missing file rather than throwing', async () => {
    vi.spyOn(fileUploadService, 'getFileContent').mockResolvedValue(null);
    const res = await processToolCall(baseArgs({
      reply: '[ANALYZE_TABLE:file=nope value=1]',
    }));

    expect(res.handled).toBe(true);
    expect(resultText(res)).toContain('not found');
  });
});

describe('READ_ROWS wiring', () => {
  it('returns the requested line range verbatim', async () => {
    mockFile(traceCsv());
    const res = await processToolCall(baseArgs({
      reply: '[READ_ROWS:file=file-1 from=102 to=104]',
    }));

    const text = resultText(res);
    expect(text).toContain('READ_ROWS RESULT');
    expect(text).toContain('TIMEOUT');
    expect(text).toContain('102 |');
  });

  it('returns a time window', async () => {
    mockFile(traceCsv());
    const res = await processToolCall(baseArgs({
      reply: '[READ_ROWS:file=file-1 around=2026-08-01T11:00:02Z window=2]',
    }));

    expect(resultText(res)).toContain('SELECT * FROM big');
  });

  it('explains an unusable timestamp instead of failing silently', async () => {
    mockFile(traceCsv());
    const res = await processToolCall(baseArgs({
      reply: '[READ_ROWS:file=file-1 around=yesterday]',
    }));

    expect(resultText(res)).toContain('Could not read around');
  });
});

describe('tool composition — a coordinate from one tool must work in the next', () => {
  it('reads back exactly the row ANALYZE_TABLE pointed at', async () => {
    const csv = traceCsv();
    mockFile(csv);

    const analyse = await processToolCall(baseArgs({
      reply: '[ANALYZE_TABLE:file=file-1 value=3]',
    }));
    const line = Number(resultText(analyse).match(/\[line (\d+)\]/)[1]);

    mockFile(csv);
    const read = await processToolCall(baseArgs({
      reply: `[READ_ROWS:file=file-1 from=${line} to=${line}]`,
    }));

    // The slowest row is the last TIMEOUT; reading its reported line must show it.
    expect(resultText(read)).toContain('5004');
    expect(resultText(read)).toContain('TIMEOUT');
  });
});

describe('COMPARE_FILES wiring', () => {
  const healthy = () => {
    const lines = [];
    for (let i = 0; i < 60; i++) {
      lines.push(`2026-08-01T10:00:00Z INFO [hb] worker-${i % 4} heartbeat ok`);
      lines.push(`2026-08-01T10:00:00Z INFO [http] GET /api/x/${i} 200`);
    }
    return lines.join('\n');
  };
  const broken = () => {
    const lines = [];
    for (let i = 0; i < 60; i++) {
      lines.push(`2026-08-01T12:00:00Z INFO [http] GET /api/x/${i} 200`);
      lines.push(`2026-08-01T12:00:00Z ERROR [db] connection pool exhausted after ${3000 + i}ms`);
    }
    return lines.join('\n');
  };

  it('reports what appeared and what stopped appearing', async () => {
    vi.spyOn(fileUploadService, 'getFileContent').mockImplementation(async (target) => ({
      id: target,
      file_name: target === 'base-1' ? 'friday.log' : 'today.log',
      original_content: target === 'base-1' ? healthy() : broken(),
    }));

    const res = await processToolCall(baseArgs({
      reply: '[COMPARE_FILES:baseline=base-1 current=curr-1]',
    }));

    const text = resultText(res);
    expect(text).toContain('LOG COMPARISON');
    expect(text).toContain('connection pool exhausted');
    expect(text).toContain('heartbeat');
    expect(text).toContain('GONE FROM');
  });

  it('reports which side could not be loaded', async () => {
    vi.spyOn(fileUploadService, 'getFileContent').mockResolvedValue(null);
    const res = await processToolCall(baseArgs({
      reply: '[COMPARE_FILES:baseline=a current=b]',
    }));

    expect(resultText(res)).toContain('Could not load');
  });
});

describe('tool advertisement', () => {
  const { buildFileContext } = require('../../services/toolProcessor.service');

  it('tells the model every tool exists, numbered without collision', () => {
    const ctx = buildFileContext([{ file_name: 'a.log', file_id: 'x' }], 1, true);
    for (const name of ['SEARCH_FILES', 'GET_FILE', 'ANALYZE_TABLE', 'READ_ROWS', 'COMPARE_FILES', 'WEB_SEARCH']) {
      expect(ctx).toContain(name);
    }
    for (const n of [1, 2, 3, 4, 5, 6]) {
      expect(ctx).toContain(`${n}. `);
    }
  });
});
