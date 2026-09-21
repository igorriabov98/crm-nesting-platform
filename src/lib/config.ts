// Вызывается в root layout
const requiredEnvVars = [
  'NEXT_PUBLIC_SUPABASE_URL',
  'NEXT_PUBLIC_SUPABASE_ANON_KEY',
  'SUPABASE_SERVICE_ROLE_KEY',
] as const

export function validateEnv() {
  for (const envVar of requiredEnvVars) {
    if (!process.env[envVar]) {
      throw new Error(`CRITICAL: Missing required environment variable: ${envVar}`)
    }
  }
}

export function getTelegramBotToken() {
  return process.env.TELEGRAM_BOT_TOKEN || ''
}

export function getAppUrl() {
  return process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'
}

const PRODUCTION_APP_URL = 'https://www.crmleda.online'
const LEGACY_PRODUCTION_APP_URL = 'https://crm-nesting-platform.vercel.app'

function normalizeUrl(value: string | undefined) {
  return value?.trim().replace(/\/+$/, '') || null
}

function isLocalUrl(value: string) {
  try {
    const hostname = new URL(value).hostname
    return hostname === 'localhost' || hostname === '127.0.0.1'
  } catch {
    return false
  }
}

export function getPasswordResetRedirectUrl() {
  const configured = normalizeUrl(process.env.NEXT_PUBLIC_APP_URL)
  const baseUrl = process.env.NODE_ENV === 'production'
    && (!configured || isLocalUrl(configured) || configured === LEGACY_PRODUCTION_APP_URL)
    ? PRODUCTION_APP_URL
    : configured || 'http://localhost:3000'
  return new URL('/reset-password', `${baseUrl}/`).toString()
}
