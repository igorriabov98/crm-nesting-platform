import assert from 'node:assert/strict'
import test from 'node:test'
import { getPasswordResetRedirectUrl } from './config'

const initialNodeEnv = process.env.NODE_ENV
const initialAppUrl = process.env.NEXT_PUBLIC_APP_URL

function withEnvironment(nodeEnv: string, appUrl: string | undefined, run: () => void) {
  Object.assign(process.env, { NODE_ENV: nodeEnv })
  if (appUrl === undefined) delete process.env.NEXT_PUBLIC_APP_URL
  else process.env.NEXT_PUBLIC_APP_URL = appUrl
  try {
    run()
  } finally {
    Object.assign(process.env, { NODE_ENV: initialNodeEnv })
    if (initialAppUrl === undefined) delete process.env.NEXT_PUBLIC_APP_URL
    else process.env.NEXT_PUBLIC_APP_URL = initialAppUrl
  }
}

test('password recovery never uses localhost in production', () => {
  withEnvironment('production', 'http://localhost:3000', () => {
    assert.equal(getPasswordResetRedirectUrl(), 'https://www.crmleda.online/reset-password')
  })
})

test('password recovery replaces the legacy Vercel production address', () => {
  withEnvironment('production', 'https://crm-nesting-platform.vercel.app', () => {
    assert.equal(getPasswordResetRedirectUrl(), 'https://www.crmleda.online/reset-password')
  })
})

test('password recovery keeps the local address during development', () => {
  withEnvironment('development', 'http://localhost:4320/', () => {
    assert.equal(getPasswordResetRedirectUrl(), 'http://localhost:4320/reset-password')
  })
})
