// vitest globals: describe, it, expect, beforeEach, afterEach
//
// ZIP safety limits (entry count, total uncompressed size, per-entry
// uncompressed size) and the file-type filter inside processZipFile.
// Archives are built with a real JSZip round-trip (generateAsync then
// written to disk) so processZipFile parses genuine central-directory
// metadata, rather than a mocked JSZip standing in for it.

const fs = require('fs');
const os = require('os');
const path = require('path');
const JSZip = require('jszip');

const MODULE_PATH = require.resolve('../../services/fileUpload.service');

// The ZIP limits are read from env at module-load time, so each test that
// overrides one must force a fresh require — same technique as
// chatRuntime.config.test.js.
const loadFileUploadService = () => {
  delete require.cache[MODULE_PATH];
  return require('../../services/fileUpload.service');
};

const buildZipFile = async (entries) => {
  const zip = new JSZip();
  for (const [name, content] of entries) zip.file(name, content);
  const buffer = await zip.generateAsync({ type: 'nodebuffer' });
  const tmpPath = path.join(os.tmpdir(), `zip-limit-test-${Date.now()}-${Math.random().toString(36).slice(2)}.zip`);
  fs.writeFileSync(tmpPath, buffer);
  return tmpPath;
};

describe('processZipFile — safety limits', () => {
  let originalEnv;
  let tmpFiles;

  beforeEach(() => {
    originalEnv = { ...process.env };
    tmpFiles = [];
  });

  afterEach(() => {
    process.env = originalEnv;
    delete require.cache[MODULE_PATH];
    for (const f of tmpFiles) {
      try { fs.unlinkSync(f); } catch { /* already gone */ }
    }
  });

  it('rejects a ZIP with more entries than ZIP_MAX_ENTRIES', async () => {
    process.env.ZIP_MAX_ENTRIES = '2';
    const service = loadFileUploadService();
    const zipPath = await buildZipFile([
      ['a.txt', 'aaaaaaaaaa'],
      ['b.txt', 'bbbbbbbbbb'],
      ['c.txt', 'cccccccccc'],
    ]);
    tmpFiles.push(zipPath);

    await expect(
      service.processZipFile(zipPath, 'archive.zip', 'user-1', null, 'model', null, false, null)
    ).rejects.toThrow(/2-file limit/);
  });

  it('rejects a ZIP whose combined uncompressed size exceeds ZIP_MAX_TOTAL_UNCOMPRESSED_BYTES', async () => {
    process.env.ZIP_MAX_TOTAL_UNCOMPRESSED_BYTES = '50';
    const service = loadFileUploadService();
    const zipPath = await buildZipFile([
      ['a.txt', 'x'.repeat(40)],
      ['b.txt', 'y'.repeat(40)],
    ]);
    tmpFiles.push(zipPath);

    await expect(
      service.processZipFile(zipPath, 'archive.zip', 'user-1', null, 'model', null, false, null)
    ).rejects.toThrow(/total limit/);
  });

  it('rejects a single ZIP entry larger than ZIP_MAX_ENTRY_UNCOMPRESSED_BYTES', async () => {
    process.env.ZIP_MAX_ENTRY_UNCOMPRESSED_BYTES = '10';
    const service = loadFileUploadService();
    const zipPath = await buildZipFile([
      ['big.txt', 'z'.repeat(100)],
    ]);
    tmpFiles.push(zipPath);

    await expect(
      service.processZipFile(zipPath, 'archive.zip', 'user-1', null, 'model', null, false, null)
    ).rejects.toThrow(/per-file limit/);
  });

  it('accepts a ZIP within all three limits', async () => {
    process.env.ZIP_MAX_ENTRIES = '5';
    process.env.ZIP_MAX_ENTRY_UNCOMPRESSED_BYTES = '1000';
    process.env.ZIP_MAX_TOTAL_UNCOMPRESSED_BYTES = '2000';
    const service = loadFileUploadService();
    const zipPath = await buildZipFile([
      ['notes.txt', 'well within every configured limit for this test'],
    ]);
    tmpFiles.push(zipPath);

    const result = await service.processZipFile(zipPath, 'archive.zip', 'user-1', null, 'model', null, false, null);
    expect(result.processedFiles).toBe(1);
  });
});

describe('processZipFile — file type filtering', () => {
  afterEach(() => {
    delete require.cache[MODULE_PATH];
  });

  it('processes supported extensions and skips unsupported ones', async () => {
    const service = loadFileUploadService();
    const zipPath = await buildZipFile([
      ['notes.txt', 'hello world, this is plenty of text content for the ten char minimum'],
      ['payload.exe', Buffer.from([0, 1, 2, 3, 4, 5, 6, 7, 8, 9])],
    ]);

    try {
      const result = await service.processZipFile(zipPath, 'archive.zip', 'user-1', null, 'model', null, false, null);
      expect(result.processedFiles).toBe(1);
      expect(result.skippedFiles).toBe(1);
      expect(result.extractedText).toContain('notes.txt');
      expect(result.extractedText).not.toContain('payload.exe');
    } finally {
      fs.unlinkSync(zipPath);
    }
  });
});

describe('getSupportedFileType', () => {
  const { getSupportedFileType } = require('../../services/fileUpload.service');

  it('returns "other" for unrecognized extensions', () => {
    expect(getSupportedFileType('payload.exe')).toBe('other');
    expect(getSupportedFileType('lib.dll')).toBe('other');
  });

  it('returns the mapped type for supported extensions', () => {
    expect(getSupportedFileType('notes.txt')).toBe('txt');
    expect(getSupportedFileType('archive.zip')).toBe('zip');
    expect(getSupportedFileType('main.py')).toBe('code');
  });
});

// The upload route rejects anything resolving to 'other', so a type the
// document loader can handle but this map omits is silently unuploadable —
// that gap once blocked tsx, jsx, c, scss, xls, gif and webp. Pinning both
// directions because the reverse (accepting what the loader cannot read)
// stores placeholder text as if it were real content.
describe('upload type map matches the document loader', () => {
  const fs = require('fs');
  const path = require('path');

  // Slices the object literal out of the source rather than importing it, so
  // the test still sees the full map even though neither module exports it.
  const extensionsOf = (file, constName) => {
    const src = fs.readFileSync(path.join(__dirname, '../../services', file), 'utf8');
    const start = src.indexOf(`const ${constName} = {`);
    expect(start, `${constName} not found in ${file}`).toBeGreaterThan(-1);
    const end = src.indexOf('\n};', start);
    expect(end, `${constName} not terminated in ${file}`).toBeGreaterThan(start);
    const body = src.slice(start, end);
    return [...body.matchAll(/^\s{2}([a-z0-9]+):/gm)].map((m) => m[1]).sort();
  };

  it('supports exactly the extensions documentLoader can load', () => {
    const loader = extensionsOf('documentLoader.service.js', 'SUPPORTED_FORMATS');
    const upload = extensionsOf('fileUpload.service.js', 'SUPPORTED_FILE_TYPES');

    expect(loader.length).toBeGreaterThan(30);
    expect(upload.filter((e) => !loader.includes(e))).toEqual([]);
    expect(loader.filter((e) => !upload.includes(e))).toEqual([]);
  });

  it('classifies the extensions that regressed', () => {
    const { getSupportedFileType } = require('../../services/fileUpload.service');
    for (const ext of ['tsx', 'jsx', 'c', 'scss']) {
      expect(getSupportedFileType(`a.${ext}`), ext).toBe('code');
    }
    for (const ext of ['gif', 'webp']) {
      expect(getSupportedFileType(`a.${ext}`), ext).toBe('image');
    }
    expect(getSupportedFileType('a.xls')).toBe('xlsx');
    expect(getSupportedFileType('a.exe')).toBe('other');
  });
});
