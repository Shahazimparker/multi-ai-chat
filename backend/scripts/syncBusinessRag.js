// ============================================================
// FILE: backend/scripts/syncBusinessRag.js
// PURPOSE: Nightly sync of business DB data into RAG.
// Run via cron: node backend/scripts/syncBusinessRag.js
// ============================================================

require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });

const { syncAllToRAG } = require('../services/businessRagSync.service');

(async () => {
  console.log('==============================');
  console.log('[SyncBizRAG] Nightly sync started:', new Date().toISOString());
  console.log('==============================');

  try {
    const result = await syncAllToRAG('openrouter');
    
    if (result.success) {
      const totalSynced = result.results.reduce((sum, r) => sum + (r.synced || 0), 0);
      const totalTables = result.results.length;
      console.log(`[SyncBizRAG] ✅ Sync complete: ${totalSynced} records across ${totalTables} tables`);
    } else {
      console.error('[SyncBizRAG] ❌ Sync failed:', result.error);
      process.exit(1);
    }
  } catch (err) {
    console.error('[SyncBizRAG] ❌ Fatal error:', err.message);
    process.exit(1);
  }

  console.log('==============================');
  console.log('[SyncBizRAG] Finished:', new Date().toISOString());
  console.log('==============================');
  process.exit(0);
})();
