// vitest globals: describe, it, expect, vi, afterEach
//
// deleteUploadedFile against a database that has not run
// migration_link_uploaded_files_to_rag.sql, plus the rows that predate it.
//
// Own file on purpose: the first 42703 latches "no rag_record_id column" for
// the whole module — the same one-shot probe a running process does — and
// vitest isolates the module registry per file, not per test. Sharing a file
// with the linked-path tests would silently disable the link for them.

const { installFileServiceStub, linkedTo, byName } = require('./helpers/fileDeleteStub');

afterEach(() => vi.restoreAllMocks());

describe('deleteUploadedFile — without the link column', () => {
  it('still clears the chunks of an unscoped file, which the old match skipped', async () => {
    // topic_id NULL: an upload made before its chat existed. The previous code
    // required a topic_id, so these chunks survived the delete and stayed
    // retrievable — a deleted file the model could still read.
    const { service, deletes } = installFileServiceStub({
      ragRow: { id: 'rag-2', file_name: 'notes.txt', topic_id: null, blob_url: null },
      linkFails: true,
    });

    await service.deleteUploadedFile('rag-2', 'user-1');

    // The link is tried first, and only falls back once the column 42703s.
    expect(linkedTo(deletes, 'rag-2')).toBeTruthy();

    const legacy = byName(deletes);
    expect(legacy).toBeTruthy();
    expect(legacy.filters.file_name).toBe('notes.txt');
    // Matched with .is(null) rather than skipped — this is the actual bug fix.
    expect(legacy.nullFilters).toContainEqual(['topic_id', null]);
  });

  it('pairs a scoped file by topic and name', async () => {
    const { service, deletes } = installFileServiceStub({
      ragRow: { id: 'rag-3', file_name: 'report.pdf', topic_id: 'topic-9', blob_url: null },
      linkFails: true,
    });

    await service.deleteUploadedFile('rag-3', 'user-1');

    expect(byName(deletes).filters).toMatchObject({
      user_id: 'user-1',
      topic_id: 'topic-9',
      file_name: 'report.pdf',
    });
  });

  it('stops probing the column once it is known to be missing', async () => {
    const first = installFileServiceStub({
      ragRow: { id: 'rag-a', file_name: 'a.txt', topic_id: 't', blob_url: null },
      linkFails: true,
    });
    await first.service.deleteUploadedFile('rag-a', 'user-1');

    // Same module instance, so the latch from the call above still stands.
    const second = installFileServiceStub({
      ragRow: { id: 'rag-b', file_name: 'b.txt', topic_id: 't', blob_url: null },
      linkFails: true,
    });
    await second.service.deleteUploadedFile('rag-b', 'user-1');

    expect(linkedTo(second.deletes, 'rag-b')).toBeUndefined();
    expect(byName(second.deletes)).toBeTruthy();
  });
});
