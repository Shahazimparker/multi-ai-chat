const BASE = 'http://localhost:5000/api';

const USERNAME = process.env.REAL_TEST_USERNAME || process.env.TEST_USERNAME || '';
const PASSWORD = process.env.REAL_TEST_PASSWORD || process.env.TEST_PASSWORD || '';

const describeWithCreds = USERNAME && PASSWORD ? describe : describe.skip;

const getCookie = (setCookieHeader) => {
  if (!setCookieHeader) return '';
  const first = Array.isArray(setCookieHeader) ? setCookieHeader[0] : setCookieHeader;
  return String(first).split(';')[0];
};

describeWithCreds('CSRF + cookie auth (real)', () => {
  it('blocks authenticated mutating request without CSRF token', async () => {
    const loginRes = await fetch(`${BASE}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: USERNAME, password: PASSWORD, rememberMe: false }),
    });
    expect(loginRes.status).toBe(200);

    const loginData = await loginRes.json();
    const cookie = getCookie(loginRes.headers.get('set-cookie'));
    expect(cookie).toContain('auth_token=');

    const logoutNoCsrf = await fetch(`${BASE}/auth/logout`, {
      method: 'POST',
      headers: { Cookie: cookie },
    });
    expect(logoutNoCsrf.status).toBe(403);

    const logoutWithPrivateOriginNoCsrf = await fetch(`${BASE}/auth/logout`, {
      method: 'POST',
      headers: {
        Cookie: cookie,
        Origin: 'http://192.168.1.10',
      },
    });
    expect(logoutWithPrivateOriginNoCsrf.status).toBe(403);

    const logoutWithCsrf = await fetch(`${BASE}/auth/logout`, {
      method: 'POST',
      headers: {
        Cookie: cookie,
        'X-CSRF-Token': loginData.csrfToken,
      },
    });
    expect(logoutWithCsrf.status).toBe(200);
  }, 30000);
});
