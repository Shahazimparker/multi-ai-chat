// Storage-route parity.
//
// A file reaches analysis by one of three routes depending only on its size and
// on whether Vercel Blob is configured:
//   - small  -> extracted text sits in `original_content`
//   - medium -> ORIGINAL bytes base64'd into `original_file_data`
//   - large  -> ORIGINAL bytes in Vercel Blob, `original_content` stubbed
//
// The last two store the original file, not the extracted text, so they must be
// run back through the loader. Decoding them with toString('utf-8') hands the
// analyser a ZIP container ("PK\x03\x04...") and every downstream reader then
// reports nothing — meaning the same spreadsheet analysed correctly under one
// route and not at all under another.

const ExcelJS = require('exceljs');

const { textFromStoredBuffer } = require('../../services/fileUpload.service');
const { profileTabularContent } = require('../../services/tabularProfiler.service');

const buildTraceWorkbook = async () => {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Trace');
  ws.addRow(['Timestamp', 'SQL Statement', 'Duration (ms)', 'Result']);
  for (let i = 0; i < 50; i++) {
    ws.addRow([new Date(), `SELECT SINGLE a FROM t WHERE id = ${i}`, 2, 'OK']);
  }
  ws.addRow([new Date(), 'SELECT * FROM BSEG ORDER BY BELNR', 67320, 'TIMEOUT']);
  return Buffer.from(await wb.xlsx.writeBuffer());
};

describe('textFromStoredBuffer — binary formats', () => {
  it('extracts a spreadsheet rather than decoding its container bytes', async () => {
    const buffer = await buildTraceWorkbook();
    const text = await textFromStoredBuffer(buffer, 'trace.xlsx');

    expect(text).toContain('[Sheet: Trace]');
    expect(text).toContain('SQL Statement');
    // The ZIP local-file-header signature must not survive into the text.
    expect(text.startsWith('PK')).toBe(false);
  });

  it('yields identical text whether the bytes came from Blob or the base64 column', async () => {
    const buffer = await buildTraceWorkbook();

    const viaBlob = await textFromStoredBuffer(buffer, 'trace.xlsx');
    const viaBase64 = await textFromStoredBuffer(
      Buffer.from(buffer.toString('base64'), 'base64'),
      'trace.xlsx'
    );

    expect(viaBlob).toBe(viaBase64);
  });

  it('produces a usable profile from both routes, not just one', async () => {
    const buffer = await buildTraceWorkbook();

    const viaBlob = await textFromStoredBuffer(buffer, 'trace.xlsx');
    const viaBase64 = await textFromStoredBuffer(
      Buffer.from(buffer.toString('base64'), 'base64'),
      'trace.xlsx'
    );

    const blobProfile = profileTabularContent(viaBlob, 'trace.xlsx');
    const dbProfile = profileTabularContent(viaBase64, 'trace.xlsx');

    expect(blobProfile).toBeTruthy();
    expect(dbProfile).toBeTruthy();
    expect(blobProfile).toContain('67,320 ms');
    expect(dbProfile).toContain('67,320 ms');
  });
});

describe('textFromStoredBuffer — text formats', () => {
  it('decodes a plain log directly without invoking a loader', async () => {
    const log = '2026-08-01 INFO up\n2026-08-01 ERROR down';
    expect(await textFromStoredBuffer(Buffer.from(log, 'utf8'), 'app.log')).toBe(log);
  });

  it('decodes a csv directly', async () => {
    const csv = 'a,b,c\n1,2,3';
    expect(await textFromStoredBuffer(Buffer.from(csv, 'utf8'), 'data.csv')).toContain('a,b,c');
  });
});

describe('textFromStoredBuffer — failure handling', () => {
  it('returns null rather than garbage when extraction fails', async () => {
    // Claims to be a spreadsheet but is not one; the caller must be free to
    // fall through to rag_chunks instead of storing and citing mojibake.
    const notASpreadsheet = Buffer.from([0x00, 0x01, 0x02, 0x03, 0xff, 0xfe]);
    expect(await textFromStoredBuffer(notASpreadsheet, 'broken.xlsx')).toBeNull();
  });

  it('returns null for an empty or missing buffer', async () => {
    expect(await textFromStoredBuffer(Buffer.alloc(0), 'x.xlsx')).toBeNull();
    expect(await textFromStoredBuffer(null, 'x.xlsx')).toBeNull();
  });
});

// ── End-to-end: every tool must behave identically on both storage routes ──
//
// resolveFullFileContent is the single funnel every file tool reads through
// (SEARCH_FILES via searchUserFilesRAG; ANALYZE_TABLE, READ_ROWS,
// COMPARE_FILES and GET_FILE via getFileContent). If it returns the same text
// for a DB-stored and a Blob-stored file, every tool above it agrees too —
// which is the property that was broken.

const blobStorage = require('../../services/blobStorage.service');
const { resolveFullFileContent } = require('../../services/fileUpload.service');
const { describeTable, analyzeTable } = require('../../services/tabularProfiler.service');
const { readRows } = require('../../services/logTemplateMiner.service');

describe('storage routes converge before any tool sees the file', () => {
  const USER = '33333333-3333-3333-3333-333333333333';

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('resolves a Blob-stored spreadsheet to the same text as a DB-stored one', async () => {
    const buffer = await buildTraceWorkbook();

    // DB route: the extracted text is already in the column.
    const dbText = await textFromStoredBuffer(buffer, 'trace.xlsx');
    const viaDb = await resolveFullFileContent(
      { file_name: 'trace.xlsx', original_content: dbText },
      USER
    );

    // Blob route: the column holds only a stub, so the bytes come from Blob.
    vi.spyOn(blobStorage, 'fetchPrivateBlobBuffer').mockResolvedValue(buffer);
    const viaBlob = await resolveFullFileContent(
      {
        file_name: 'trace.xlsx',
        original_content: 'File ready for queries.',
        blob_url: 'https://blob.example/trace.xlsx',
      },
      USER
    );

    expect(viaBlob).toBe(viaDb);
    expect(viaBlob).toContain('[Sheet: Trace]');
    expect(viaBlob.startsWith('PK')).toBe(false);
  });

  it('resolves a base64 DB-stored spreadsheet to the same text', async () => {
    const buffer = await buildTraceWorkbook();
    const dbText = await textFromStoredBuffer(buffer, 'trace.xlsx');

    const viaBase64 = await resolveFullFileContent(
      {
        file_name: 'trace.xlsx',
        original_content: 'File ready for queries.',
        original_file_data: buffer.toString('base64'),
      },
      USER
    );

    expect(viaBase64).toBe(dbText);
  });

  it('gives every tool identical output on both routes', async () => {
    const buffer = await buildTraceWorkbook();

    const viaDb = await textFromStoredBuffer(buffer, 'trace.xlsx');
    vi.spyOn(blobStorage, 'fetchPrivateBlobBuffer').mockResolvedValue(buffer);
    const viaBlob = await resolveFullFileContent(
      {
        file_name: 'trace.xlsx',
        original_content: 'File ready for queries.',
        blob_url: 'https://blob.example/trace.xlsx',
      },
      USER
    );

    // Census, computation and row-reading must all agree, or the same question
    // would get different answers depending on how big the upload happened to be.
    expect(describeTable(viaBlob, 'trace.xlsx')).toBe(describeTable(viaDb, 'trace.xlsx'));
    expect(analyzeTable(viaBlob, { valueCol: 3, groupCol: 2 }))
      .toBe(analyzeTable(viaDb, { valueCol: 3, groupCol: 2 }));
    expect(readRows(viaBlob, { from: 1, to: 5 })).toBe(readRows(viaDb, { from: 1, to: 5 }));

    // And the analysis must be real, not two matching empties.
    expect(describeTable(viaBlob, 'trace.xlsx')).toContain('TABLE SCHEMA');
    expect(analyzeTable(viaBlob, { valueCol: 3 })).toContain('max=67,320');
  });

  it('falls through instead of returning binary when Blob holds something unreadable', async () => {
    vi.spyOn(blobStorage, 'fetchPrivateBlobBuffer').mockResolvedValue(Buffer.from([0, 1, 2, 3]));
    const resolved = await resolveFullFileContent(
      {
        file_name: 'broken.xlsx',
        original_content: 'File ready for queries.',
        blob_url: 'https://blob.example/broken.xlsx',
        llm_analysis: 'fallback summary',
      },
      USER
    );

    // Never the raw bytes.
    expect(resolved).not.toMatch(/[\x00-\x08]/);
  });
});
