import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import test from 'node:test'
import vm from 'node:vm'
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { JSDOM } from 'jsdom'
import ts from 'typescript'

const require = createRequire(import.meta.url), h = React.createElement

test('recovery UI initializes once in StrictMode, keeps errors and displays persistent account-specific success', async () => {
  const dom = new JSDOM('<div id="root"></div>', { url: 'https://crm.test/reset-password#type=recovery&access_token=test&refresh_token=test' })
  globalThis.window = dom.window; globalThis.document = dom.window.document; globalThis.IS_REACT_ACT_ENVIRONMENT = true
  let opened = 0, fail = true, saved = 0
  const ui = tag => ({children, ...props}) => h(tag, props, children)
  const loaded = { exports: {} }
  vm.runInNewContext(ts.transpileModule(readFileSync('src/components/features/auth/ResetPasswordForm.tsx', 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  }).outputText, {
    module: loaded, exports: loaded.exports, window: dom.window, process, Error,
    require(name) {
      if (name === '@/lib/auth/password-recovery') return {
        createRecoveryClient: () => ({}),
        openPasswordRecovery: async hash => {
          opened++; assert.match(hash, /type=recovery/)
          return { email: 'recipient@example.test', save: async () => { saved++; if (fail) throw new Error('Сохранение не выполнено') } }
        },
      }
      if (name === 'next/link') return { default: ui('a') }
      if (name === '@/components/ui/button') return { Button: ui('button') }
      if (name === '@/components/ui/input') return { Input: ui('input') }
      if (name === '@/components/ui/card') return Object.fromEntries(['Card','CardContent','CardDescription','CardHeader','CardTitle'].map(name => [name, ui('div')]))
      return require(name)
    },
  })
  const root = createRoot(document.getElementById('root'))
  try {
    await act(async () => root.render(h(React.StrictMode, null, h(loaded.exports.ResetPasswordForm))))
    assert.equal(opened, 1)
    assert.equal(window.location.hash, '')
    assert.match(document.body.textContent, /Аккаунт: recipient@example.test/)
    const submit = async () => act(async () => document.querySelector('form').dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true })))
    await submit()
    assert.match(document.querySelector('[role="alert"]').textContent, /Сохранение не выполнено/)
    assert.ok(document.querySelector('form'))
    assert.equal(document.querySelector('[role="status"]'), null)
    fail = false; await submit()
    assert.equal(saved, 2)
    assert.match(document.querySelector('[role="status"]').textContent, /Пароль изменён для recipient@example.test/)
    assert.equal(document.querySelector('form'), null)
  } finally {
    await act(async () => root.unmount())
    dom.window.close()
    delete globalThis.window; delete globalThis.document; delete globalThis.IS_REACT_ACT_ENVIRONMENT
  }
})
