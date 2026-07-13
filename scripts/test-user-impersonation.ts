import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import {
  decodeImpersonationMarker,
  encodeImpersonationMarker,
  getImpersonationBackupCookieName,
  getSupabaseAuthCookieBaseName,
  isSupabaseAuthCookieName,
  type ImpersonationMarker,
} from '../src/lib/auth/impersonation-state'

const baseName = getSupabaseAuthCookieBaseName('https://project-ref.supabase.co')
assert.equal(baseName, 'sb-project-ref-auth-token')
assert.equal(isSupabaseAuthCookieName(baseName, baseName), true)
assert.equal(isSupabaseAuthCookieName(`${baseName}.0`, baseName), true)
assert.equal(isSupabaseAuthCookieName(`${baseName}.12`, baseName), true)
assert.equal(isSupabaseAuthCookieName(`${baseName}.invalid`, baseName), false)
assert.equal(isSupabaseAuthCookieName(`${baseName}-code-verifier`, baseName), false)

const marker: ImpersonationMarker = {
  version: 1,
  auditId: 'audit-id',
  adminUserId: 'admin-id',
  adminName: 'Администратор',
  targetUserId: 'target-id',
  targetName: 'Сотрудник',
  startedAt: '2026-07-13T12:00:00.000Z',
  savedCookies: [
    { originalName: `${baseName}.0`, backupName: getImpersonationBackupCookieName(0) },
    { originalName: `${baseName}.1`, backupName: getImpersonationBackupCookieName(1) },
  ],
}

assert.deepEqual(decodeImpersonationMarker(encodeImpersonationMarker(marker), baseName), marker)

const invalidBackup = {
  ...marker,
  savedCookies: [{ originalName: `${baseName}.0`, backupName: 'unexpected-cookie' }],
}
assert.equal(decodeImpersonationMarker(encodeImpersonationMarker(invalidBackup), baseName), null)

const invalidOriginal = {
  ...marker,
  savedCookies: [{ originalName: 'another-cookie', backupName: getImpersonationBackupCookieName(0) }],
}
assert.equal(decodeImpersonationMarker(encodeImpersonationMarker(invalidOriginal), baseName), null)

const migration = readFileSync(
  path.resolve('supabase/migrations/20260713132437_add_user_impersonation_audit.sql'),
  'utf8',
)
assert.match(migration, /ENABLE ROW LEVEL SECURITY/i)
assert.match(migration, /REVOKE ALL[^;]+FROM anon, authenticated/i)
assert.match(migration, /GRANT SELECT, INSERT, UPDATE[^;]+TO service_role/i)
assert.doesNotMatch(migration, /GRANT DELETE[^;]+TO service_role/i)
assert.doesNotMatch(migration, /access_token|refresh_token/i)

const banner = readFileSync(
  path.resolve('src/components/layout/ImpersonationBanner.tsx'),
  'utf8',
)
assert.doesNotMatch(banner, /['"]use client['"]/)
assert.match(banner, /const returnHref = `\/api\/impersonation\/stop\?audit=\$\{encodeURIComponent\(auditId\)\}`/)
assert.match(banner, /<a[\s\S]*href=\{returnHref\}/)
assert.doesNotMatch(banner, /<form/)
assert.doesNotMatch(banner, /onClick=/)

const stopRoute = readFileSync(
  path.resolve('src/app/api/impersonation/stop/route.ts'),
  'utf8',
)
assert.match(stopRoute, /export async function POST\(request: Request\)/)
assert.match(stopRoute, /if \(!isSameOrigin\(request\)\)/)
assert.match(stopRoute, /new Response\('Forbidden', \{ status: 403 \}\)/)
assert.match(stopRoute, /redirect\(result\.redirectTo \|\| ROUTES\.LOGIN\)/)
assert.match(stopRoute, /export async function GET\(request: Request\)/)
assert.match(stopRoute, /auditId !== marker\.auditId/)
assert.match(stopRoute, /isSameOriginNavigation\(request\)/)
assert.match(stopRoute, /new URL\(referer\)\.origin !== new URL\(request\.url\)\.origin/)
assert.match(stopRoute, /fetchSite === 'same-origin'/)

console.log('User impersonation session helpers: OK')
