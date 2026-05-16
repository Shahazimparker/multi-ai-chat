// ============================================================
// FILE: backend/services/businessRagSync.service.js
// PURPOSE: Extracts business data into RAG chunks for
//          semantic search. Scheduled to run nightly.
// ============================================================

const supabase = require('../config/supabase');
const { embedText, clearEmbeddingCache } = require('./rag.service');
const { executeRawSQL } = require('./businessDb.service');

const CHUNK_SIZE = 500;   // characters per chunk
const MAX_RECORDS_PER_TABLE = 500; // max records to sync per table per run
const PAGE_SIZE = 1;      // fetch 1 record at a time — max memory safety

/**
 * Split text into overlapping chunks
 */
const chunkText = (text, maxSize = CHUNK_SIZE) => {
  if (!text || text.length === 0) return [];
  if (text.length <= maxSize) return [text];

  const chunks = [];
  let start = 0;
  while (start < text.length) {
    const end = Math.min(start + maxSize, text.length);
    // Try to break at a sentence boundary
    let breakPoint = end;
    if (end < text.length) {
      const lastPeriod = text.lastIndexOf('.', end);
      const lastNewline = text.lastIndexOf('\n', end);
      breakPoint = Math.max(lastPeriod, lastNewline) + 1;
      if (breakPoint <= start) breakPoint = end; // fallback
    }
    chunks.push(text.slice(start, breakPoint).trim());
    start = breakPoint;
    // Add overlap (10%)
    start = Math.max(0, start - Math.floor(maxSize * 0.1));
  }
  return chunks.filter(c => c.length > 0);
};

/**
 * Format a business record as readable text for RAG
 */
const formatRecord = (tableName, record) => {
  const lines = [`Source: ${tableName}`];
  for (const [key, value] of Object.entries(record)) {
    if (value !== null && value !== undefined && typeof value !== 'object') {
      lines.push(`${key}: ${value}`);
    }
  }
  return lines.join('\n');
};

/**
 * Sync a single table into RAG (memory-optimized: paginated fetch + one record at a time)
 * Extracts records in small pages, chunks them, embeds, and stores in rag_documents
 */
const syncTableToRAG = async (tableName, provider = 'openrouter', signal = null) => {
  console.log(`[BizRAG] Syncing table: ${tableName}`);

  // Debug: test basic connectivity with a count query first
  try {
    const countResult = await executeRawSQL(`SELECT COUNT(*) as cnt FROM "${tableName.replace(/"/g, '""')}"`);
    const rowCount = Array.isArray(countResult) ? (countResult[0]?.cnt || 0) : 0;
    console.log(`[BizRAG] ${tableName} has ${rowCount} rows`);
  } catch (err) {
    console.warn(`[BizRAG] Count query failed for ${tableName}: ${err.message}`);
  }

  let syncedCount = 0;
  let totalRecords = 0;
  let offset = 0;
  const escapedTable = tableName.replace(/"/g, '""');

  // Fetch records in small pages to avoid loading everything into memory
  while (offset < MAX_RECORDS_PER_TABLE) {
    if (signal?.aborted) break;

    let records;
    try {
      records = await executeRawSQL(
        `SELECT * FROM "${escapedTable}" ORDER BY created_at DESC NULLS LAST LIMIT ${PAGE_SIZE} OFFSET ${offset}`
      );
    } catch (err) {
      console.warn(`[BizRAG] Failed to fetch ${tableName} at offset ${offset}: ${err.message}`);
      if (offset === 0) return { table: tableName, synced: 0, error: err.message };
      break; // partial success — keep what we got
    }

    if (!records || (Array.isArray(records) && records.length === 0)) {
      if (offset === 0) {
        console.log(`[BizRAG] No records in ${tableName}`);
        return { table: tableName, synced: 0 };
      }
      break; // no more records
    }

    if (!Array.isArray(records)) records = [records];
    if (totalRecords === 0) totalRecords = records.length;

    // Process this page — one record at a time
    for (let i = 0; i < records.length; i++) {
      if (signal?.aborted) break;

      const record = records[i];

      try {
        const formatted = formatRecord(tableName, record);
        // Truncate huge records to prevent memory blowup
        const truncated = formatted.length > 2000 ? formatted.slice(0, 2000) + '\n...[truncated]' : formatted;
        const chunks = chunkText(truncated);

        for (const chunk of chunks) {
          const embedResult = await embedText(chunk, provider, 3, signal);
          if (!embedResult) continue;

          const title = `${tableName}: ${record.id || record[Object.keys(record)[0]]}`;

          const { error: insertErr } = await supabase
            .from('rag_documents')
            .insert({
              title: title.slice(0, 255),
              content: chunk.slice(0, 8000),
              provider,
              embedding: embedResult.vector,
              metadata: {
                source: 'business_db',
                table: tableName,
                record_id: record.id || null,
                synced_at: new Date().toISOString(),
              },
            });

          if (insertErr) {
            console.warn(`[BizRAG] Insert error for ${title}: ${insertErr.message}`);
          }
        }

        syncedCount++;
      } catch (err) {
        if (err.name === 'AbortError') throw err;
        console.warn(`[BizRAG] Failed to sync record: ${err.message}`);
      }

      // ── Aggressive memory cleanup after each record ──
      records[i] = null;
      clearEmbeddingCache();
      if (global.gc) global.gc();
    }

    // Free page memory before fetching next page
    records = null;
    clearEmbeddingCache();
    if (global.gc) global.gc();

    offset += PAGE_SIZE;

    // Delay between pages
    await new Promise(r => setTimeout(r, 500));
  }

  console.log(`[BizRAG] Synced ${syncedCount} records from ${tableName}`);
  return { table: tableName, synced: syncedCount };
};

/**
 * Full sync: introspect all business tables and sync each one
 */
const syncAllToRAG = async (provider = 'openrouter', signal = null) => {
  console.log('[BizRAG] Starting full business DB → RAG sync');

  // Get all tables via raw SQL RPC
  let tables;
  try {
    tables = await executeRawSQL(`
      SELECT table_name FROM information_schema.tables
      WHERE table_schema = 'public'
        AND table_type IN ('BASE TABLE', 'VIEW')
        AND table_name NOT LIKE '\\_%'
      ORDER BY table_name
    `);
  } catch (err) {
    console.error('[BizRAG] Failed to fetch tables:', err.message);
    return { success: false, error: err.message };
  }

  if (!Array.isArray(tables) || tables.length === 0) {
    console.log('[BizRAG] No business tables found');
    return { success: true, results: [] };
  }

  console.log(`[BizRAG] Found ${tables.length} business tables to sync`);

  const results = [];
  for (const table of tables) {
    if (signal?.aborted) break;
    const tableName = table.table_name || table;
    const result = await syncTableToRAG(tableName, provider, signal);
    results.push(result);
  }

  // Free table list memory
  tables = null;

  console.log(`[BizRAG] Sync complete: ${results.filter(r => r.synced > 0).length} tables synced`);
  return { success: true, results };
};

module.exports = {
  syncTableToRAG,
  syncAllToRAG,
  chunkText,
  formatRecord,
};
