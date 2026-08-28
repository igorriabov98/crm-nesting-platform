import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { verifyCrmRelease } from './prod-crm-smoke.mjs';

const sha = 'a'.repeat(40);
function fixture({ actualSha = sha, loginStatus = 200, loginHtml = '<html>CRM</html>' } = {}) {
  const calls = [];
  return { calls, options: {
    crmUrl: 'https://crm.example', expectedSha: sha,
    fetcher: async (url, options) => {
      calls.push({ url: url.href, options });
      if (url.pathname === '/api/version') return Response.json({ sha: actualSha });
      assert.equal(url.pathname, '/login', 'No other endpoints may be called');
      return new Response(loginHtml, { status: loginStatus, headers: { 'content-type': 'text/html' } });
    },
  } };
}

test('CRM-only smoke makes exactly two same-origin GETs without redirects or bodies', async () => {
  const f = fixture();
  assert.deepEqual(await verifyCrmRelease(f.options), { sha, checked: ['/api/version', '/login'] });
  assert.deepEqual(f.calls.map((call) => call.url), ['https://crm.example/api/version', 'https://crm.example/login']);
  for (const { options } of f.calls) {
    assert.equal(options.method, 'GET');
    assert.equal(options.redirect, 'error');
    assert.equal(options.body, undefined);
    assert.ok(options.signal instanceof AbortSignal);
  }
});

test('wrong release SHA fails before the page check', async () => {
  const f = fixture({ actualSha: 'b'.repeat(40) });
  await assert.rejects(() => verifyCrmRelease(f.options), /requested release/);
  assert.equal(f.calls.length, 1);
});

test('missing release SHA prevents network access', async () => {
  const f = fixture();
  await assert.rejects(() => verifyCrmRelease({ ...f.options, expectedSha: undefined }), /SHA is required/);
  assert.equal(f.calls.length, 0);
});

test('unavailable or non-rendered login page fails verification', async () => {
  for (const overrides of [{ loginStatus: 500 }, { loginStatus: 302 }, { loginHtml: 'server error' }]) {
    await assert.rejects(() => verifyCrmRelease(fixture(overrides).options));
  }
});

test('workflow chooses the read-only smoke exclusively when Railway is disabled', () => {
  const workflow = readFileSync(new URL('../.github/workflows/deploy.yml', import.meta.url), 'utf8');
  assert.match(workflow, /- name: Run read-only CRM smoke\n\s+if: \$\{\{ inputs\.deploy_railway == false \}\}[\s\S]*?run: node scripts\/prod-crm-smoke\.mjs/);
  assert.match(workflow, /- name: Run full production smoke\n\s+if: \$\{\{ inputs\.deploy_railway == true \}\}\n\s+run: npm run smoke:prod/);
});
