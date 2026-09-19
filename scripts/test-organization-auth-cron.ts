import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import vm from 'node:vm'
import ts from 'typescript'

test('Auth retry cron requires its secret and reports unfinished synchronization', async () => {
  let calls = 0
  let pending = 0
  let fail = false
  const env: { CRON_SECRET?: string } = {}
  const loaded = { exports: {} as { GET: (request: Request) => Promise<Response> } }
  const source = ts.transpileModule(readFileSync('src/app/api/organization/auth-sync/route.ts', 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText
  vm.runInNewContext(source, {
    module: loaded, exports: loaded.exports, Response, process: { env },
    require(name: string) {
      assert.equal(name, '@/lib/organization/auth-sync')
      return { synchronizeUserAuth: async () => { calls++; if (fail) throw new Error('private service details'); return { pending } } }
    },
  })
  const invoke = (authorization?: string) => loaded.exports.GET(new Request('https://crm.test/api/organization/auth-sync', {
    headers: authorization ? { authorization } : {},
  }))
  assert.equal((await invoke()).status, 503)
  env.CRON_SECRET = 'test-cron-secret'
  for (const header of [undefined, 'Bearer wrong', 'test-cron-secret']) assert.equal((await invoke(header)).status, 401)
  assert.equal(calls, 0, 'Unauthorized requests must never reach the privileged Auth client')
  assert.equal((await invoke('Bearer test-cron-secret')).status, 200)
  pending = 1
  assert.equal((await invoke('Bearer test-cron-secret')).status, 503)
  fail = true
  const response = await invoke('Bearer test-cron-secret')
  assert.equal(response.status, 503)
  assert.ok(!(await response.text()).includes('private service details'))
  const config = JSON.parse(readFileSync('vercel.json', 'utf8'))
  assert.ok(config.crons.some((cron: { path: string; schedule: string }) => cron.path === '/api/organization/auth-sync' && cron.schedule === '*/5 * * * *'))
})
