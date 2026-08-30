// vitest globals: describe, it, expect, vi, afterEach
//
// `uploaded_files_rag.source` ships as an opt-in migration
// (database/migration_add_file_source.sql). Until it is applied, PostgREST
// rejects any query naming the column — and the file list is not something that
// may go blank because a migration is pending. The service retries once without
// the column and remembers, so an unmigrated database loses the
// artifact/attachment split and nothing else.
//
// Its own file on purpose: that "remembers" is a module-level latch, and vitest
// isolates the module registry per file but not per test within one. Kept
// alongside a peer that asserts the tagging (fileSource.test.js), this test
// cannot poison it.

const supabase = require('../../config/supabase');
const { listAllUserFiles } = require('../../services/fileUpload.service');

const selects = [];

const stubClient = () => {
  vi.spyOn(supabase, 'from').mockImplementation(() => ({
    select: (columns) => {
      const record = { columns, filters: {} };
      selects.push(record);
      const chain = {
        eq: (column, value) => { record.filters[column] = value; return chain; },
        order: () => chain,
        limit: () => chain,
        then: (resolve, reject) => {
          const namesSource = String(columns || '').includes('source') || 'source' in record.filters;
          return Promise.resolve(namesSource
            ? {
              data: null,
              count: null,
              error: { code: '42703', message: 'column uploaded_files_rag.source does not exist' },
            }
            : { data: [{ id: 'f1', file_name: 'notes.pdf', file_type: 'pdf', created_at: '2026-01-01' }], count: 1, error: null })
            .then(resolve, reject);
        },
      };
      return chain;
    },
  }));
};

afterEach(() => vi.restoreAllMocks());

describe('listAllUserFiles without the source migration', () => {
  // Both halves in one test: the second asserts the effect the first leaves
  // behind, and splitting them would make the pair silently order-dependent.
  it('retries without the column, then stops probing for it', async () => {
    stubClient();

    const result = await listAllUserFiles('user-1', 200, { source: 'upload' });

    // A failed probe, then the retry that answers.
    expect(selects).toHaveLength(2);
    expect(selects[0].columns).toContain('source');
    expect(selects[1].columns).not.toContain('source');
    expect(selects[1].filters.source).toBeUndefined();
    expect(result.files).toHaveLength(1);
    // Unknown origin reads as 'upload' — the value the column defaults to.
    expect(result.files[0].source).toBe('upload');

    selects.length = 0;
    await listAllUserFiles('user-1', 200, { source: 'generated' });

    // One query this time: the first call latched the column as missing.
    expect(selects).toHaveLength(1);
    expect(selects[0].columns).not.toContain('source');
  });
});
