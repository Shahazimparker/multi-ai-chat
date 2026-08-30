// Shared stub for the deleteUploadedFile tests.
//
// Lives here because the same harness is needed by two test FILES: the delete
// path latches "uploaded_files has no rag_record_id" in module state the first
// time it sees that error, exactly as a running process does, and vitest gives
// a fresh CJS module per file but not per test. So the migrated and unmigrated
// cases have to be separate files sharing one stub.

const missingColumn = {
  code: '42703',
  message: 'column uploaded_files.rag_record_id does not exist',
};

/**
 * Loads fileUpload.service with a recording stub wired into it.
 *
 * @param {object} opts
 * @param {object|null} opts.ragRow   the uploaded_files_rag row the lookup finds
 * @param {boolean} [opts.linkFails]  answer the linked delete as an unmigrated DB
 * @returns {{service, blobStorage, deletes: Array}}
 */
const installFileServiceStub = ({ ragRow, linkFails = false }) => {
  vi.resetModules();
  const client = require('../../../config/supabase');
  // Required after the reset so the spy lands on the very instance the service
  // will lazily require at call time.
  const blobStorage = require('../../../services/blobStorage.service');
  const service = require('../../../services/fileUpload.service');
  const deletes = [];

  vi.spyOn(client, 'from').mockImplementation((table) => ({
    select: () => ({
      eq: () => ({
        eq: () => ({ maybeSingle: async () => ({ data: ragRow, error: null }) }),
      }),
    }),
    delete: () => {
      const record = { table, filters: {}, nullFilters: [] };
      deletes.push(record);
      const chain = {
        eq: (column, value) => { record.filters[column] = value; return chain; },
        is: (column, value) => { record.nullFilters.push([column, value]); return chain; },
        then: (resolve, reject) => {
          const failing = linkFails && 'rag_record_id' in record.filters;
          return Promise.resolve({ error: failing ? missingColumn : null }).then(resolve, reject);
        },
      };
      return chain;
    },
  }));

  return { service, blobStorage, deletes };
};

const linkedTo = (deletes, id) =>
  deletes.find((d) => d.table === 'uploaded_files' && d.filters.rag_record_id === id);

const byName = (deletes) =>
  deletes.find((d) => d.table === 'uploaded_files' && d.filters.file_name);

module.exports = { installFileServiceStub, linkedTo, byName, missingColumn };
