import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import test from 'node:test'
import ts from 'typescript'

const root = new URL('../', import.meta.url)
const compiled = new Map()
function loadPermissions(db) {
  const modules = new Map()
  function load(name) {
    if (name === 'server-only') return {}
    if (name === 'react') return { cache: (fn) => fn }
    if (name === '@/lib/supabase/server') return { createServerSupabaseClient: async () => db }
    if (name === '@/lib/auth/current-user') return {
      AuthRequiredError: class AuthRequiredError extends Error {},
      getCurrentUserContext: () => { throw new Error('Lookup must not load the UI/factory context') },
    }
    assert.ok(name.startsWith('@/'), `Unexpected import: ${name}`)
    if (modules.has(name)) return modules.get(name).exports
    if (!compiled.has(name)) {
      const source = readFileSync(new URL(`src/${name.slice(2)}.ts`, root), 'utf8')
      compiled.set(name, ts.transpileModule(source, {
        compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
      }).outputText)
    }
    const loadedModule = { exports: {} }
    modules.set(name, loadedModule)
    vm.runInNewContext(compiled.get(name), { module: loadedModule, exports: loadedModule.exports, require: load, console })
    return loadedModule.exports
  }
  return load('@/lib/permissions/server')
}

function fixture({ session = true, active = true, admin = false, allow = false, roleOnly = false, membershipError = null } = {}) {
  const calls = []
  let authCalls = 0
  const db = {
    auth: { getUser: async () => {
      authCalls++
      return { data: { user: session ? { id: 'user-1' } : null }, error: null }
    } },
    async rpc(name, args) {
      calls.push({ name, args })
      assert.equal(name, 'crm_access_snapshot')
      assert.equal(args.p_user_id, 'user-1')
      return { data: membershipError ? null : {
        userId: 'user-1', version: '1', isActive: active, isAdmin: admin,
        memberships: [{ departmentId: 'department-1', departmentName: 'Production',
          positionId: 'position-1', positionName: roleOnly ? 'Администратор CRM' : 'Technologist',
          positionLevel: 1, isDepartmentHead: false }],
        accessRows: [{ department_id: 'department-1', subject_scope: 'member',
          resource_key: 'materials', can_view: allow, can_manage: false }],
      }, error: membershipError }
    },
  }
  return { db, calls, permissions: loadPermissions(db), get authCalls() { return authCalls } }
}

test('missing or revoked session is rejected before database access', async () => {
  const f = fixture({ session: false })
  await assert.rejects(() => f.permissions.requireReadPermissionDataClient('materials'))
  assert.equal(f.authCalls, 1)
  assert.equal(f.calls.length, 0)
})

test('blocked CRM administrator cannot read materials', async () => {
  const f = fixture({ active: false, admin: true })
  await assert.rejects(() => f.permissions.requireReadPermissionDataClient('materials'), /Недостаточно прав/)
})

test('Protected CRM administrator keeps access with one atomic snapshot', async () => {
  const f = fixture({ admin: true })
  const result = await f.permissions.requireReadPermissionDataClient('materials')
  assert.equal(result.supabase, f.db)
  assert.equal(result.userId, 'user-1')
  assert.equal(f.authCalls, 1)
  assert.equal(f.calls.length, 1)
  assert.equal(f.calls[0].name, 'crm_access_snapshot')
})

test('ordinary employee uses the existing department matrix', async () => {
  for (const allow of [false, true]) {
    const f = fixture({ allow })
    if (allow) await f.permissions.requireReadPermissionDataClient('materials')
    else await assert.rejects(() => f.permissions.requireReadPermissionDataClient('materials'), /Недостаточно прав/)
    assert.equal(f.calls.length, 1)
  }
})

test('administrator position name alone does not bypass an explicit department denial', async () => {
  const f = fixture({ roleOnly: true })
  await assert.rejects(() => f.permissions.requireReadPermissionDataClient('materials'), /Недостаточно прав/)
})

test('membership query errors fail closed even for an administrator', async () => {
  const f = fixture({ admin: true, membershipError: { message: 'membership unavailable' } })
  await assert.rejects(() => f.permissions.requireReadPermissionDataClient('materials'), /membership unavailable/)
})

function loadSearchRoute(search) {
  const source = readFileSync(new URL('src/app/api/materials/search/route.ts', root), 'utf8')
  const output = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText
  const loadedModule = { exports: {} }
  vm.runInNewContext(output, {
    module: loadedModule, exports: loadedModule.exports, URL,
    require(name) {
      if (name === 'next/server') return { NextResponse: { json: Response.json } }
      if (name === '@/lib/actions/materials') return { searchMaterialsWithVariants: search }
      if (name === '@/lib/constants/procurement') return { MATERIAL_CATEGORY_LABELS: { sheet_metal: 'Листовой металл' } }
      throw new Error(`Unexpected route import ${name}`)
    },
  })
  return loadedModule.exports
}

test('search route rejects invalid parameters before running the lookup', async () => {
  let calls = 0
  const route = loadSearchRoute(async () => { calls++; return { data: null, error: null } })
  for (const query of ['q=x', 'q=лист&category=bogus', 'q=лист&category=constructor', `q=${'x'.repeat(161)}`]) {
    const response = await route.GET(new Request(`https://crm.test/api/materials/search?${query}`))
    assert.equal(response.status, 400)
  }
  assert.equal(calls, 0)
})

test('search route preserves scope and cannot be cached publicly', async () => {
  const calls = []
  const bundle = { materials: [{ id: 'material-1' }], variantsByMaterialId: { 'material-1': [] } }
  const route = loadSearchRoute(async (...args) => { calls.push(args); return { data: bundle, error: null } })
  const response = await route.GET(new Request('https://crm.test/api/materials/search?q=лист&category=sheet_metal&fallback=1'))
  assert.equal(response.status, 200)
  assert.deepEqual(calls[0], ['лист', 'sheet_metal', true])
  assert.equal(response.headers.get('cache-control'), 'private, no-store')
  assert.deepEqual((await response.json()).data, bundle)
})

test('search route returns no catalogue when shared authorization denies access', async () => {
  const route = loadSearchRoute(async () => ({ data: null, error: 'Недостаточно прав' }))
  const response = await route.GET(new Request('https://crm.test/api/materials/search?q=лист'))
  assert.equal(response.ok, false)
  assert.equal((await response.json()).data, null)
  assert.equal(response.headers.get('cache-control'), 'private, no-store')
})
