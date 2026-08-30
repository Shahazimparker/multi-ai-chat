// vitest globals: describe, it, expect, vi, beforeEach, afterEach
//
// Where a file came from — `uploaded_files_rag.source`.
//
// One table holds two unrelated things: documents and screenshots the user put
// into a chat, and files the model produced. The sidebar's Artifacts list and
// the chat's Attachments panel each want exactly one of them, so the row has to
// say which it is. The write paths that must tag themselves:
//   - saveGeneratedFile        (text artifacts: csv, html, json, md, svg)
//   - saveGeneratedBinaryFile  (binary artifacts: pdf, docx, xlsx, pptx, png)
//   - saveUserAttachment       (images pasted into the composer)
//
// Uploads have no tagging step of their own, and that is deliberate rather than
// an omission: all three upload routes (multer/DB, chunked/DB, and Vercel Blob)
// go through processUploadedFile, which has exactly one insert and names no
// source, so every one of them takes the column default 'upload'. What keeps
// that correct is that nothing on the generated path shares it — which is what
// these tests pin.

// A select chain records what it was asked for, then resolves empty.
const selectChain = (record) => {
  const chain = {
    select: (columns) => { record.columns = columns; return chain; },
    eq: (column, value) => { record.filters[column] = value; return chain; },
    order: () => chain,
    limit: () => chain,
    // The generated-file writers look for a same-name row before inserting;
    // null means "no duplicate, use the name as given".
    maybeSingle: async () => ({ data: null, error: null }),
    then: (resolve, reject) =>
      Promise.resolve({ data: [], error: null, count: 0 }).then(resolve, reject),
  };
  return chain;
};

let selects;
let inserts;
let updates;

// Loads a private copy of the service with a stub client wired into it.
//
// Re-requiring config/supabase in the same generation hands the service the
// very object the spies are installed on.
//
// The unapplied-migration case is NOT here: the service latches "this database
// has no source column" in a module-level flag, exactly as a running process
// does, and vitest's registry does not hand a CJS module back fresh within one
// file. It lives in fileSourceUnmigrated.test.js, which gets its own registry.
const loadService = () => {
  vi.resetModules();
  const supabase = require('../../config/supabase');
  const service = require('../../services/fileUpload.service');

  vi.spyOn(supabase, 'from').mockImplementation((table) => ({
    select: (columns, opts) => {
      const record = { table, filters: {}, columns: null };
      selects.push(record);
      return selectChain(record).select(columns, opts);
    },
    insert: (row) => {
      inserts.push({ table, row });
      return {
        select: () => ({ single: async () => ({ data: { id: 'new-row-id', ...row }, error: null }) }),
      };
    },
    update: (patch) => {
      updates.push({ table, patch });
      const chain = {
        eq: () => chain,
        then: (resolve, reject) => Promise.resolve({ data: null, error: null }).then(resolve, reject),
      };
      return chain;
    },
  }));

  vi.spyOn(supabase, 'rpc').mockResolvedValue({
    data: [{ insert_rag_document: 'rpc-row-id' }],
    error: null,
  });

  return { ...service, supabase };
};

beforeEach(() => {
  selects = [];
  inserts = [];
  updates = [];
});

afterEach(() => vi.restoreAllMocks());

describe('listAllUserFiles — scoping', () => {
  it('asks only for AI artifacts when source=generated', async () => {
    const { listAllUserFiles } = loadService();

    await listAllUserFiles('user-1', 200, { source: 'generated' });

    const [query] = selects;
    expect(query.columns).toContain('source');
    expect(query.filters).toMatchObject({ user_id: 'user-1', source: 'generated' });
    // Artifacts are a cross-chat list; no conversation filter belongs here.
    expect(query.filters.topic_id).toBeUndefined();
  });

  it('narrows attachments to one conversation when a topic is given', async () => {
    const { listAllUserFiles } = loadService();

    await listAllUserFiles('user-1', 200, { source: 'upload', topicId: 'topic-9' });

    expect(selects[0].filters).toMatchObject({
      user_id: 'user-1',
      source: 'upload',
      topic_id: 'topic-9',
    });
  });

});

describe('write paths — origin tagging', () => {
  it('tags a text artifact as generated', async () => {
    const { saveGeneratedFile } = loadService();

    await saveGeneratedFile('user-1', 'topic-9', 'summary.md', '# hi', 'md');

    const insert = inserts.find((entry) => entry.table === 'uploaded_files_rag');
    expect(insert.row.source).toBe('generated');
  });

  it('tags a binary artifact as generated, which its RPC insert cannot do itself', async () => {
    const { saveGeneratedBinaryFile } = loadService();

    await saveGeneratedBinaryFile(
      'user-1', 'topic-9', 'deck.pptx', 'text', 'pptx', Buffer.from('bytes'),
    );

    expect(updates).toContainEqual({ table: 'uploaded_files_rag', patch: { source: 'generated' } });
  });

  it('leaves a pasted image on the column default, so it reads as an attachment', async () => {
    const { saveUserAttachment, supabase } = loadService();

    const saved = await saveUserAttachment(
      'user-1', 'topic-9', 'pasted-image.png', Buffer.from('fake-png-bytes'), 'png',
    );

    expect(saved.file_id).toBe('rpc-row-id');
    // Nothing may retag this row: 'upload' is what makes it an attachment.
    expect(updates.some((entry) => entry.patch.source)).toBe(false);
    const [, params] = supabase.rpc.mock.calls[0];
    expect(params.p_user_id).toBe('user-1');
    expect(params.p_topic_id).toBe('topic-9');
    expect(params.p_original_file_b64).toBe(Buffer.from('fake-png-bytes').toString('base64'));
  });

  it('keeps the extension when it timestamps a pasted filename', async () => {
    const { saveUserAttachment } = loadService();

    const saved = await saveUserAttachment(
      'user-1', null, 'pasted-image.png', Buffer.from('bytes'), 'png',
    );

    expect(saved.file_name).toMatch(/^pasted-image_\d{8}T\d{6}\.png$/);
  });
});
