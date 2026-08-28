import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';

// The CRM-only release must not upload files, create projects, or call Railway.
export async function verifyCrmRelease({ crmUrl, expectedSha, fetcher = fetch }) {
  const origin = new URL(crmUrl);
  assert(['http:', 'https:'].includes(origin.protocol), 'CRM URL must use HTTP(S)');
  assert(!origin.username && !origin.password, 'CRM URL must not contain credentials');
  assert.match(expectedSha ?? '', /^[a-f0-9]{40}$/, 'Expected release SHA is required');

  async function get(path) {
    const response = await fetcher(new URL(path, origin.origin), {
      method: 'GET',
      redirect: 'error',
      signal: AbortSignal.timeout(15000),
      headers: { 'cache-control': 'no-cache' },
    });
    assert.equal(response.status, 200, `${path} must return HTTP 200`);
    return response;
  }

  const version = await (await get('/api/version')).json();
  assert.equal(version.sha, expectedSha, 'CRM must serve the requested release');
  const login = await get('/login');
  assert.match(login.headers.get('content-type') ?? '', /text\/html/i, 'Login must serve HTML');
  assert.match(await login.text(), /<html\b/i, 'Login page must render');
  return { sha: version.sha, checked: ['/api/version', '/login'] };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  verifyCrmRelease({ crmUrl: process.env.PROD_CRM_URL, expectedSha: process.env.DEPLOY_SHA })
    .then((result) => console.log('[smoke] read-only CRM verification passed', result))
    .catch((error) => { console.error('[smoke]', error.message); process.exitCode = 1; });
}
