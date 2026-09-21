import assert from 'node:assert/strict'
import test from 'node:test'
import { createRecoveryClient, openPasswordRecovery } from './password-recovery'

const token = (sub: string, expiry = Date.now() / 1000 + 3600) => [
  { alg: 'HS256', typ: 'JWT' }, { sub, exp: expiry },
].map(value => Buffer.from(JSON.stringify(value)).toString('base64url')).concat('test-signature').join('.')
const link = (id = 'recipient') => `#type=recovery&access_token=${token(id)}&refresh_token=refresh-${id}`
const user = (id: string) => ({ id, email: `${id}@example.test`, aud: 'authenticated', role: 'authenticated', app_metadata: {}, user_metadata: {}, created_at: new Date().toISOString() })
function setup() {
  const updates: string[] = []
  let rejectUpdate = false, rejectUser = false, overrideUser: string | undefined
  const client = createRecoveryClient('https://auth.example.test', 'test-anon-key', async (input, init) => {
    const url = String(input)
    const headers = new Headers(init?.headers)
    const jwt = headers.get('authorization')?.replace('Bearer ', '') || ''
    const id = jwt.includes('.') ? JSON.parse(Buffer.from(jwt.split('.')[1], 'base64url').toString()).sub : undefined
    if (url.includes('/logout')) return new Response('{}', { status: 200 })
    if (url.endsWith('/user') && init?.method === 'PUT') {
      if (rejectUpdate) return Response.json({ code: 'weak_password', msg: 'weak password' }, { status: 422, headers: { 'x-supabase-api-version': '2024-01-01' } })
      updates.push(id)
      return Response.json(user(id))
    }
    if (url.endsWith('/user')) {
      if (rejectUser) return Response.json({ code: 'bad_jwt', msg: 'expired' }, { status: 401 })
      return Response.json(user(overrideUser || id))
    }
    throw new Error(`Unexpected request ${url}`)
  })
  return { client, updates, failUpdate: (value: boolean) => { rejectUpdate = value }, failUser: () => { rejectUser = true }, changeUser: () => { overrideUser = 'other' } }
}

test('emailed recovery establishes its own session and only updates its recipient', async () => {
  const { client, updates } = setup()
  const other = setup()
  await other.client.auth.setSession({ access_token: token('admin'), refresh_token: 'admin-refresh' })
  const recovery = await openPasswordRecovery(link(), client)
  assert.equal(recovery.email, 'recipient@example.test')
  await recovery.save('new-test-password', 'new-test-password')
  assert.deepEqual(updates, ['recipient'])
  assert.equal((await other.client.auth.getUser()).data.user?.id, 'admin')
  assert.deepEqual(other.updates, [])
  assert.equal((await client.auth.getSession()).data.session, null)
  await assert.rejects(recovery.save('new-test-password', 'new-test-password'), /уже изменён/)
})

test('missing, incomplete, expired and non-recovery links never use an existing session', async () => {
  for (const hash of ['', '#type=recovery', '#type=recovery&access_token=bad', link().replace('recovery', 'signup'), link() + '&error_code=otp_expired']) {
    const { client, updates } = setup()
    await client.auth.setSession({ access_token: token('admin'), refresh_token: 'admin-refresh' })
    await assert.rejects(openPasswordRecovery(hash, client), /Ссылка недействительна/)
    assert.deepEqual(updates, [])
  }
  const failed = setup(); failed.failUser()
  await assert.rejects(openPasswordRecovery(link(), failed.client), /Ссылка недействительна/)
})

test('short and mismatching passwords are not sent; server rejection allows retry', async () => {
  const s = setup(), recovery = await openPasswordRecovery(link(), s.client)
  await assert.rejects(recovery.save('short', 'short'), /12 символов/)
  await assert.rejects(recovery.save('new-test-password', 'different'), /не совпадают/)
  assert.deepEqual(s.updates, [])
  s.failUpdate(true)
  await assert.rejects(recovery.save('new-test-password', 'new-test-password'), /безопасности/)
  s.failUpdate(false)
  await recovery.save('new-test-password', 'new-test-password')
  assert.deepEqual(s.updates, ['recipient'])
})

test('changed or revoked identity blocks the password update', async () => {
  for (const mutation of ['changeUser', 'failUser'] as const) {
    const s = setup(), recovery = await openPasswordRecovery(link(), s.client)
    s[mutation]()
    await assert.rejects(recovery.save('new-test-password', 'new-test-password'), /Ссылка недействительна/)
    assert.deepEqual(s.updates, [])
  }
})

test('sign-in reports service failures separately from invalid credentials', async () => {
  const { loginErrorMessage } = await import('./login-error')
  assert.match(loginErrorMessage({ status: 400, code: 'invalid_credentials' }), /Неверный email/)
  assert.match(loginErrorMessage({ status: 503 }), /временно недоступен/)
  assert.match(loginErrorMessage({ status: 429 }), /много попыток/)
  assert.match(loginErrorMessage({ status: 403, code: 'user_banned' }), /заблокирован/)
  assert.match(loginErrorMessage({ status: 400, code: 'email_not_confirmed' }), /Подтвердите email/)
})
