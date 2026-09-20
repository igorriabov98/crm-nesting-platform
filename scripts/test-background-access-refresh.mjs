import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'
import test from 'node:test'
import vm from 'node:vm'
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { createPortal } from 'react-dom'
import { JSDOM } from 'jsdom'
import ts from 'typescript'

const require = createRequire(import.meta.url)
const h = React.createElement

test('verified access refreshes without hiding pages, drafts or portals; errors and revocation close access', async () => {
  const dom = new JSDOM('<div id="root"></div><div id="portal"></div>', { url: 'https://crm.test/inventory' })
  globalThis.window = dom.window
  globalThis.document = dom.window.document
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  let pathname = '/inventory'
  let reloads = 0
  const requests = []
  const modules = new Map()
  function load(file) {
    const absolute = path.resolve(file)
    if (modules.has(absolute)) return modules.get(absolute).exports
    const module = { exports: {} }
    modules.set(absolute, module)
    const source = ts.transpileModule(readFileSync(absolute, 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
    }).outputText
    vm.runInNewContext(source, {
      module, exports: module.exports, AbortController, document: dom.window.document,
      window: { location: { reload() { reloads++ } }, addEventListener: dom.window.addEventListener.bind(dom.window), removeEventListener: dom.window.removeEventListener.bind(dom.window) },
      fetch(url, options) {
        assert.equal(url, '/api/access/snapshot')
        assert.equal(options.cache, 'no-store')
        return new Promise((resolve, reject) => requests.push({ resolve, reject, options }))
      },
      require(name) {
        if (name === 'next/navigation') return { usePathname: () => pathname }
        if (name === '@/components/ui/AccessDenied') return { AccessDenied: () => h('div', { 'data-denied': true }, 'Access denied') }
        if (name === '@/components/ui/button') return { Button: props => h('button', props) }
        if (name === '@/lib/permissions/resources') return load('src/lib/permissions/resources.ts')
        if (name === '@/lib/constants/routes') return load('src/lib/constants/routes.ts')
        if (name === './access-visibility') return load('src/components/providers/access-visibility.ts')
        return require(name)
      },
    })
    return module.exports
  }
  const { PermissionProvider, RouteAccessBoundary, usePermissions, ACCESS_REFRESH_EVENT } = load('src/components/providers/PermissionProvider.tsx')
  const { AccessVisibilityContext } = load('src/components/providers/access-visibility.ts')
  const root = createRoot(document.getElementById('root'))
  const rights = { inventory: { canView: true, canManage: true }, tasks: { canView: true, canManage: true } }
  const snapshot = (userId = 'alice', permissions = rights) => ({ userId, permissions, isAdminPosition: false, version: '1' })
  let props = snapshot()
  function Editor() {
    const visible = React.useContext(AccessVisibilityContext)
    const access = usePermissions()
    return h(React.Fragment, null,
      h('input', { 'data-draft': true, defaultValue: 'Unsaved matrix draft' }),
      h('button', { 'data-manage': true, disabled: !access.can('inventory', 'manage') }, 'Manage'),
      createPortal(h('div', { 'data-editor-portal': true, hidden: !visible }, 'Open editor'), document.getElementById('portal')))
  }
  const render = () => root.render(h(PermissionProvider, props, h(RouteAccessBoundary, null, h(Editor))))
  const answer = async (index, status, data = snapshot()) => act(async () => { requests[index].resolve(new Response(JSON.stringify(data), { status })) })
  const isVisible = () => {
    const input = document.querySelector('[data-draft]')
    return Boolean(input && !input.closest('[hidden], [inert]'))
  }
  const assertReady = () => {
    assert.ok(isVisible(), 'An authorized page must remain visible while refreshing')
    assert.equal(document.querySelector('[role="status"]'), null, 'No blocking access spinner')
    assert.equal(document.querySelector('[data-editor-portal]').hidden, false, 'Open portals stay visible')
  }
  try {
    await act(async () => render())
    assertReady()
    const originalInput = document.querySelector('[data-draft]')
    originalInput.value = 'Draft in progress'
    await act(async () => window.dispatchEvent(new window.Event('focus')))
    assertReady()
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' })
    await act(async () => document.dispatchEvent(new window.Event('visibilitychange')))
    assertReady()
    pathname = '/tasks'
    await act(async () => render())
    assertReady()
    await act(async () => window.dispatchEvent(new window.Event(ACCESS_REFRESH_EVENT)))
    assertReady()
    assert.equal(document.querySelector('[data-draft]'), originalInput, 'Background checks preserve editor identity')
    assert.equal(originalInput.value, 'Draft in progress')
    assert.ok(requests.slice(0, -1).every(r => r.options.signal.aborted), 'Superseded requests are cancelled')
    await answer(requests.length - 1, 200)
    await answer(0, 403)
    assertReady()

    await act(async () => window.dispatchEvent(new window.Event('focus')))
    assertReady()
    await answer(requests.length - 1, 503)
    assert.equal(isVisible(), false, 'Read errors fail closed')
    assert.ok(document.querySelector('[role="alert"]'))
    assert.equal(document.querySelector('[data-denied]'), null, 'An error is not a confirmed denial')
    assert.equal(document.querySelector('[data-editor-portal]').hidden, true)
    await act(async () => document.querySelector('[role="alert"] button').click())
    await answer(requests.length - 1, 200)
    assertReady()
    assert.equal(document.querySelector('[data-draft]').value, 'Draft in progress', 'Retry preserves unsaved work')

    await act(async () => window.dispatchEvent(new window.Event('focus')))
    await answer(requests.length - 1, 200, snapshot('alice', {}))
    assert.ok(document.querySelector('[data-denied]'), 'A fresh permission revocation closes the page')
    assert.equal(document.querySelector('[data-draft]'), null)
    await act(async () => window.dispatchEvent(new window.Event('focus')))
    await answer(requests.length - 1, 200)
    assertReady()

    await act(async () => window.dispatchEvent(new window.Event('focus')))
    const oldSessionRequest = requests.length - 1
    props = snapshot('bob', {})
    await act(async () => render())
    assert.equal(isVisible(), false, 'A new identity cannot inherit the old snapshot')
    assert.equal(document.querySelector('[data-manage]').disabled, true)
    await answer(oldSessionRequest, 200)
    assert.equal(isVisible(), false, 'A late old-session response cannot reopen the page')
    await answer(requests.length - 1, 403)
    assert.ok(document.querySelector('[data-denied]'))

    await act(async () => window.dispatchEvent(new window.Event('focus')))
    await answer(requests.length - 1, 200, snapshot('different-session'))
    assert.equal(reloads, 1)
    assert.equal(isVisible(), false, 'Session mismatch closes content before reloading')
  } finally {
    await act(async () => root.unmount())
    dom.window.close()
    delete globalThis.window
    delete globalThis.document
    delete globalThis.IS_REACT_ACT_ENVIRONMENT
  }
})
