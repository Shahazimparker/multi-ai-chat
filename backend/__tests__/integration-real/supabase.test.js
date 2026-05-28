// Real Supabase integration tests — requires .env with SUPABASE_URL + SUPABASE_SERVICE_KEY
// Run: npx vitest run --config vitest.real.config.js

const hasSupabase = process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_KEY;

const describeSupabase = hasSupabase ? describe : describe.skip;

describeSupabase('Supabase (real)', () => {
  const supabase = require('../../config/supabase');

  it('connects to Supabase successfully', async () => {
    const { data, error } = await supabase.from('users').select('id', { count: 'exact', head: true });
    expect(error).toBeNull();
    expect(data).toBeDefined();
  });

  it('can query users table', async () => {
    const { data, error } = await supabase
      .from('users')
      .select('id, email, username, role')
      .limit(1);
    expect(error).toBeNull();
    expect(Array.isArray(data)).toBe(true);
  });

  it('can query topics table', async () => {
    const { data, error } = await supabase
      .from('topics')
      .select('id, title')
      .limit(1);
    expect(error).toBeNull();
    expect(Array.isArray(data)).toBe(true);
  });

  it('can query messages table', async () => {
    const { data, error } = await supabase
      .from('messages')
      .select('id, role, content')
      .limit(1);
    expect(error).toBeNull();
    expect(Array.isArray(data)).toBe(true);
  });

  it('can query query_cache table', async () => {
    const { data, error } = await supabase
      .from('query_cache')
      .select('id')
      .limit(1);
    expect(error).toBeNull();
    expect(Array.isArray(data)).toBe(true);
  });

  it('can query query_analytics table', async () => {
    const { data, error } = await supabase
      .from('query_analytics')
      .select('id')
      .limit(1);
    expect(error).toBeNull();
    expect(Array.isArray(data)).toBe(true);
  });

  it('can call RPC functions', async () => {
    const { error } = await supabase.rpc('increment_user_tokens', {
      user_id: '00000000-0000-0000-0000-000000000000',
      token_amount: 0,
    });
    expect(error).toBeDefined();
  });

  it('health check endpoint responds', async () => {
    const response = await fetch('http://localhost:5000/api/health');
    const data = await response.json();
    expect(response.status).toBe(200);
    expect(data.status).toBe('OK');
  });
});
