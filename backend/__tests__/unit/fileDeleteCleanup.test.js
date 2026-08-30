// vitest globals: describe, it, expect, vi, afterEach
//
// Deleting a file has to delete all of it.
//
// A chunked upload lands in four places: uploaded_files_rag (the row the UI
// lists and deletes), uploaded_files (the parent of its chunks), rag_chunks
// (what retrieval actually reads, cascaded from uploaded_files) and possibly
// Vercel Blob. The delete used to pair the first two by
// (user_id, topic_id, file_name), which skipped rows whose topic_id was NULL —
// their chunks survived, so a file the user deleted stayed readable by the
// model. That is the exact thing the confirm dialog promises will not happen.
//
// The fix is an explicit rag_record_id link with ON DELETE CASCADE. This file
// covers the linked path; the fallback for rows predating it lives in
// fileDeleteCleanupLegacy.test.js, because reaching it latches "no such column"
// for the whole module and vitest does not hand a CJS module back fresh within
// one file.

const { installFileServiceStub, linkedTo, byName } = require('./helpers/fileDeleteStub');

afterEach(() => vi.restoreAllMocks());

describe('deleteUploadedFile — with the link column', () => {
  it('deletes the chunk parent through the link, so rag_chunks cascade', async () => {
    const { service, deletes } = installFileServiceStub({
      ragRow: { id: 'rag-1', file_name: 'trace.log', topic_id: 'topic-9', blob_url: null },
    });

    await service.deleteUploadedFile('rag-1', 'user-1');

    const linked = linkedTo(deletes, 'rag-1');
    expect(linked).toBeTruthy();
    expect(linked.filters.user_id).toBe('user-1');
    // The link is exact, so guessing by name must not also run — that is what
    // took a same-named sibling's chunks with it.
    expect(byName(deletes)).toBeUndefined();
    // And the row the UI lists goes too.
    expect(deletes.some((d) => d.table === 'uploaded_files_rag')).toBe(true);
  });

  it('removes the stored bytes as well as the rows', async () => {
    const { service, blobStorage } = installFileServiceStub({
      ragRow: { id: 'rag-4', file_name: 'big.xlsx', topic_id: 't', blob_url: 'https://blob/x' },
    });
    const deleteBlob = vi.spyOn(blobStorage, 'deleteBlobFromStorage').mockResolvedValue(undefined);

    await service.deleteUploadedFile('rag-4', 'user-1');

    expect(deleteBlob).toHaveBeenCalledWith('https://blob/x');
  });

  it('deletes the listed row even when the file has no chunk parent', async () => {
    // Small files never get an uploaded_files row; the delete must not depend
    // on one existing.
    const { service, deletes } = installFileServiceStub({ ragRow: null });

    await expect(service.deleteUploadedFile('rag-5', 'user-1')).resolves.toBeUndefined();

    const listed = deletes.find((d) => d.table === 'uploaded_files_rag');
    expect(listed.filters).toMatchObject({ id: 'rag-5', user_id: 'user-1' });
  });
});
