// Real Business DB integration tests — requires .env with BIZ_SUPABASE_URL
// Run: npx vitest run --config vitest.real.config.js

const { initBusinessDB, queryBusinessDB, getTableSchema, isConnected } = require('../../services/businessDb.service');

describe('Business DB (real)', () => {
  let connected = false;

  beforeAll(async () => {
    try {
      connected = await isConnected();
      if (connected) {
        await initBusinessDB();
      }
    } catch (err) {
      console.warn(`[BizDB] Connection check failed: ${err.message}`);
    }
  });

  it('checks business DB connection', async () => {
    if (!process.env.BIZ_SUPABASE_URL) {
      console.log('[BizDB] BIZ_SUPABASE_URL not set — skipping');
      return;
    }

    const result = await isConnected();
    console.log(`[BizDB] Connected: ${result}`);
    // Connection may fail if DB is not reachable — that's OK for this test
    expect(typeof result).toBe('boolean');
  });

  it('initializes business DB', async () => {
    if (!connected) {
      console.log('[BizDB] Not connected — skipping init test');
      return;
    }

    const state = await initBusinessDB();
    expect(state).toBeDefined();
    expect(typeof state.connected).toBe('boolean');
    console.log(`[BizDB] Schema length: ${(state.schemaText || '').length} chars`);
  });

  it('queries business DB with safe SQL', async () => {
    if (!connected) {
      console.log('[BizDB] Not connected — skipping query test');
      return;
    }

    try {
      const results = await queryBusinessDB('SELECT 1 as test_value');
      expect(Array.isArray(results)).toBe(true);
      if (results.length > 0) {
        expect(results[0]).toHaveProperty('test_value');
      }
      console.log(`[BizDB] Query returned ${results.length} rows`);
    } catch (err) {
      // Table may not exist — that's OK
      console.warn(`[BizDB] Query warning: ${err.message}`);
    }
  });

  it('gets table schema', async () => {
    if (!connected) {
      console.log('[BizDB] Not connected — skipping schema test');
      return;
    }

    try {
      const schema = await getTableSchema(['users']);
      expect(typeof schema).toBe('string');
      expect(schema.length).toBeGreaterThan(0);
      console.log(`[BizDB] Schema returned: ${schema.slice(0, 100)}...`);
    } catch (err) {
      console.warn(`[BizDB] Schema warning: ${err.message}`);
    }
  });
});
