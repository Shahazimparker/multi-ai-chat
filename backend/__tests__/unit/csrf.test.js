// Double-submit CSRF: the header must match a cookie the browser sent back.
// The old middleware accepted any well-formed string, so these tests exist
// mainly to stop that regressing.

// vitest globals: describe, it, expect

const { csrfProtection, generateCsrfToken } = require('../../middleware/csrf');

const TOKEN = 'a'.repeat(64);
const OTHER = 'b'.repeat(64);

const makeReq = ({ method = 'POST', path = '/api/chat/stream', cookie, header, authorization } = {}) => ({
  method,
  path,
  headers: {
    ...(cookie ? { cookie } : {}),
    ...(header ? { 'x-csrf-token': header } : {}),
    ...(authorization ? { authorization } : {}),
  },
});

const makeRes = () => {
  const res = { statusCode: null, body: null, cookies: [] };
  res.status = (code) => { res.statusCode = code; return res; };
  res.json = (payload) => { res.body = payload; return res; };
  res.cookie = (name, value, options) => { res.cookies.push({ name, value, options }); return res; };
  return res;
};

const run = (req) => {
  const res = makeRes();
  let nexted = false;
  csrfProtection(req, res, () => { nexted = true; });
  return { res, nexted };
};

// A session cookie plus a matching CSRF cookie, as the browser would send them.
const sessionCookie = (csrf = TOKEN) => `auth_token=jwt.value.here; csrf_token=${csrf}`;

describe('csrfProtection', () => {
  it('accepts a request whose header matches the cookie', () => {
    const { nexted, res } = run(makeReq({ cookie: sessionCookie(), header: TOKEN }));
    expect(nexted).toBe(true);
    expect(res.statusCode).toBeNull();
  });

  it('rejects a mismatched token', () => {
    const { nexted, res } = run(makeReq({ cookie: sessionCookie(TOKEN), header: OTHER }));
    expect(nexted).toBe(false);
    expect(res.statusCode).toBe(403);
    expect(res.body.error).toMatch(/mismatch/i);
  });

  // The forged-header case the old implementation waved through.
  it('rejects a well-formed header when no CSRF cookie is present', () => {
    const { nexted, res } = run(makeReq({ cookie: 'auth_token=jwt.value.here', header: TOKEN }));
    expect(nexted).toBe(false);
    expect(res.statusCode).toBe(403);
    expect(res.body.error).toMatch(/cookie missing/i);
  });

  it('rejects a missing header', () => {
    const { nexted, res } = run(makeReq({ cookie: sessionCookie() }));
    expect(nexted).toBe(false);
    expect(res.statusCode).toBe(403);
    expect(res.body.error).toMatch(/missing/i);
  });

  it('rejects a malformed header before comparing', () => {
    const { nexted, res } = run(makeReq({ cookie: sessionCookie(), header: 'has spaces!' }));
    expect(nexted).toBe(false);
    expect(res.statusCode).toBe(403);
    expect(res.body.error).toMatch(/format/i);
  });

  it('rejects a token of the wrong length without throwing', () => {
    // timingSafeEqual throws on length mismatch, so this must be guarded.
    const { nexted, res } = run(makeReq({ cookie: sessionCookie(TOKEN), header: 'a'.repeat(32) }));
    expect(nexted).toBe(false);
    expect(res.statusCode).toBe(403);
  });

  it('skips non-mutating methods', () => {
    const { nexted } = run(makeReq({ method: 'GET', cookie: sessionCookie() }));
    expect(nexted).toBe(true);
  });

  it('skips login and health, which cannot yet hold a token', () => {
    expect(run(makeReq({ path: '/api/auth/login' })).nexted).toBe(true);
    expect(run(makeReq({ path: '/api/health' })).nexted).toBe(true);
  });

  it('skips unauthenticated requests, which carry no ambient authority', () => {
    const { nexted } = run(makeReq({}));
    expect(nexted).toBe(true);
  });

  // A Bearer caller has no cookie jar, so there is no cross-site request to
  // forge and requiring a cookie would only break API clients.
  it('allows a Bearer caller with a header but no cookie', () => {
    const { nexted } = run(makeReq({ authorization: 'Bearer sometoken', header: TOKEN }));
    expect(nexted).toBe(true);
  });

  it('still enforces the match for a Bearer caller that does send a cookie', () => {
    const req = makeReq({ authorization: 'Bearer sometoken', cookie: sessionCookie(TOKEN), header: OTHER });
    const { nexted, res } = run(req);
    expect(nexted).toBe(false);
    expect(res.statusCode).toBe(403);
  });
});

// A session that holds a valid auth cookie but no CSRF cookie — every session
// alive at the moment this shipped, plus anyone whose non-httpOnly CSRF cookie
// got wiped. Without a backfill those users 403 on every write, forever.
describe('csrfProtection — recovery for a session with no CSRF cookie', () => {
  const legacyReq = () => makeReq({ cookie: 'auth_token=jwt.value.here' });

  it('rejects the request but mints a CSRF cookie so the retry can work', () => {
    const { nexted, res } = run(legacyReq());
    expect(nexted).toBe(false);
    expect(res.statusCode).toBe(403);
    expect(res.cookies).toHaveLength(1);
    expect(res.cookies[0].name).toBe('csrf_token');
    expect(res.cookies[0].value).toMatch(/^[a-f0-9]{64}$/);
  });

  it('mints it readable by JS, or the client could never echo it back', () => {
    const { res } = run(legacyReq());
    expect(res.cookies[0].options.httpOnly).toBe(false);
  });

  it('backfills for a request that does send a (necessarily bogus) header too', () => {
    const { nexted, res } = run(makeReq({ cookie: 'auth_token=jwt.value.here', header: TOKEN }));
    expect(nexted).toBe(false);
    expect(res.statusCode).toBe(403);
    expect(res.cookies).toHaveLength(1);
  });

  it('lets the retry through once the browser sends the minted cookie back', () => {
    const first = run(legacyReq());
    const minted = first.res.cookies[0].value;
    const retry = run(makeReq({ cookie: `auth_token=jwt.value.here; csrf_token=${minted}`, header: minted }));
    expect(retry.nexted).toBe(true);
    expect(retry.res.statusCode).toBeNull();
  });

  // Otherwise an attacker could rotate the victim's token from another origin
  // and break every request already in flight.
  it('never overwrites a CSRF cookie that is already present', () => {
    const { res } = run(makeReq({ cookie: sessionCookie(TOKEN), header: OTHER }));
    expect(res.statusCode).toBe(403);
    expect(res.cookies).toHaveLength(0);
  });

  it('does not push a cookie at a Bearer caller, which has no cookie jar', () => {
    const { nexted, res } = run(makeReq({ authorization: 'Bearer sometoken', header: TOKEN }));
    expect(nexted).toBe(true);
    expect(res.cookies).toHaveLength(0);
  });

  it('does not mint on a non-mutating request', () => {
    const { nexted, res } = run(makeReq({ method: 'GET', cookie: 'auth_token=jwt.value.here' }));
    expect(nexted).toBe(true);
    expect(res.cookies).toHaveLength(0);
  });
});

describe('generateCsrfToken', () => {
  it('produces a 64-char hex token that passes the format check', () => {
    const token = generateCsrfToken();
    expect(token).toMatch(/^[a-f0-9]{64}$/);
    expect(generateCsrfToken()).not.toBe(token);
  });
});
